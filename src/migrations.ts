import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

export async function ensureKernelTables(db: Pool): Promise<void> {
  await db.query(`
    create table if not exists kernel_migration (
      module text not null, file text not null, applied_at timestamptz not null default now(),
      primary key (module, file));
    create table if not exists kernel_module (
      name text primary key, version text not null,
      installed_at timestamptz not null default now(), active boolean not null default true);`);
}

/** Runs pending numbered .sql files for one module; each file in its own transaction. */
export async function runMigrations(db: Pool, module: string, dir: string): Promise<string[]> {
  let files: string[] = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort(); } catch { return []; }
  const done = new Set(
    (await db.query<{ file: string }>('select file from kernel_migration where module=$1', [module]))
      .rows.map((r) => r.file));
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into kernel_migration (module, file) values ($1,$2)', [module, file]);
      await client.query('commit');
      applied.push(file);
    } catch (e) {
      await client.query('rollback');
      throw new Error(`Migration ${module}/${file} failed and was rolled back: ${(e as Error).message}`);
    } finally { client.release(); }
  }
  return applied;
}
