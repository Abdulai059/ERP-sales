import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { assertIdent } from './ident.js';
import { ensureKernelTables, runMigrations } from './migrations.js';
import { emit } from './events.js';
import type { Manifest } from './types.js';

export const KERNEL_VERSION = '0.1.0';
const MODULES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'modules');

export function validateManifest(m: Manifest): void {
  assertIdent(m.name, 'module name');
  for (const k of ['version', 'kernel', 'description'] as const)
    if (!m[k]) throw new Error(`Module ${m.name}: manifest missing "${k}"`);
  if (!Array.isArray(m.depends)) throw new Error(`Module ${m.name}: depends must be a list`);
}

export class ModuleRegistry {
  readonly modules = new Map<string, Manifest>();

  add(m: Manifest) {
    validateManifest(m);
    if (this.modules.has(m.name)) throw new Error(`Duplicate module ${m.name}`);
    this.modules.set(m.name, m);
  }

  /** Install order for `wanted` plus everything they depend on. Detects missing deps and cycles. */
  orderFor(wanted: string[]): string[] {
    const order: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (name: string, trail: string[]) => {
      const m = this.modules.get(name);
      if (!m) throw new Error(`Missing module "${name}"${trail.length ? ` (needed by ${trail.at(-1)})` : ''}`);
      if (state.get(name) === 'done') return;
      if (state.get(name) === 'visiting') throw new Error(`Dependency cycle: ${[...trail, name].join(' -> ')}`);
      state.set(name, 'visiting');
      for (const d of m.depends) visit(d, [...trail, name]);
      state.set(name, 'done');
      order.push(name);
    };
    wanted.forEach((w) => visit(w, []));
    return order;
  }

  async installedNames(db: Pool): Promise<Set<string>> {
    await ensureKernelTables(db);
    const { rows } = await db.query<{ name: string }>('select name from kernel_module where active');
    return new Set(rows.map((r) => r.name));
  }
}

export async function discoverModules(): Promise<ModuleRegistry> {
  const reg = new ModuleRegistry();
  for (const d of await readdir(MODULES_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const mod = await import(pathToFileURL(path.join(MODULES_DIR, d.name, 'manifest.ts')).href);
    reg.add(mod.default as Manifest);
  }
  return reg;
}

export const migrationsDir = (name: string) => path.join(MODULES_DIR, name, 'migrations');

/** Install modules (and their dependencies) for ONE business. Serialized per business. */
export async function installModules(reg: ModuleRegistry, db: Pool, wanted: string[]): Promise<string[]> {
  await ensureKernelTables(db);
  const lock = await db.connect();
  const installedNow: string[] = [];
  try {
    await lock.query("select pg_advisory_lock(hashtext('kernel_install'))");
    const already = await reg.installedNames(db);
    for (const name of reg.orderFor(wanted)) {
      if (already.has(name)) continue;
      const m = reg.modules.get(name)!;
      await runMigrations(db, name, migrationsDir(name));
      await syncPermissions(db, m);
      await db.query(
        `insert into kernel_module (name, version) values ($1,$2)
         on conflict (name) do update set version=excluded.version, active=true`, [name, m.version]);
      await emit(db, 'kernel.module.installed', { module: name, version: m.version });
      installedNow.push(name);
    }
  } finally {
    await lock.query("select pg_advisory_unlock(hashtext('kernel_install'))");
    lock.release();
  }
  return installedNow;
}

/** Re-run pending migrations for every installed module (upgrade). */
export async function upgradeBusiness(reg: ModuleRegistry, db: Pool): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const installed = await reg.installedNames(db);
  for (const name of reg.orderFor([...installed])) {
    const m = reg.modules.get(name)!;
    result[name] = await runMigrations(db, name, migrationsDir(name));
    await syncPermissions(db, m);
    await db.query('update kernel_module set version=$2 where name=$1', [name, m.version]);
  }
  return result;
}

async function syncPermissions(db: Pool, m: Manifest) {
  for (const [code, description] of Object.entries(m.permissions ?? {})) {
    await db.query(
      `insert into permission (code, description, module) values ($1,$2,$3)
       on conflict (code) do update set description=excluded.description`, [code, description, m.name]);
    // the owner role always receives every permission
    await db.query(
      `insert into role_permission (role_id, permission_code)
       select id, $1 from role where name='owner' on conflict do nothing`, [code]);
  }
}
