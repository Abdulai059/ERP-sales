import pg from 'pg';
import { config } from './config.js';
import { assertIdent, SLUG } from './ident.js';
import type { Business } from './types.js';

const { Pool } = pg;

export const control = new Pool({ connectionString: config.controlUrl, max: 5 });

export async function bootstrapControl(): Promise<void> {
  await control.query(`
    create table if not exists business (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      name text not null,
      type text not null default 'blank',
      db_name text not null unique,
      status text not null default 'active',
      created_at timestamptz not null default now()
    )`);
}

type Row = { id: string; slug: string; name: string; type: string; db_name: string; status: string };
const toBusiness = (r: Row): Business =>
  ({ id: r.id, slug: r.slug, name: r.name, type: r.type, dbName: r.db_name, status: r.status });

export async function findBusiness(slug: string): Promise<Business | null> {
  const { rows } = await control.query<Row>('select * from business where slug = $1', [slug]);
  return rows[0] ? toBusiness(rows[0]) : null;
}

export async function listActiveBusinesses(): Promise<Business[]> {
  const { rows } = await control.query<Row>("select * from business where status = 'active'");
  return rows.map(toBusiness);
}

// ---- tenant pools: ALL business data access starts here ----
const pools = new Map<string, pg.Pool>();

export function tenantPool(dbName: string): pg.Pool {
  assertIdent(dbName, 'database name');
  let p = pools.get(dbName);
  if (!p) {
    p = new Pool({ connectionString: config.tenantUrlTemplate.replace('{db}', dbName), max: 5 });
    pools.set(dbName, p);
  }
  return p;
}

export async function createBusiness(slug: string, name: string, type: string): Promise<Business> {
  if (!SLUG.test(slug)) throw new Error('slug: lowercase letters, digits, hyphen');
  if (await findBusiness(slug)) throw new Error(`Business "${slug}" already exists`);
  const dbName = assertIdent('biz_' + slug.replace(/-/g, '_'), 'database name');
  await control.query(`create database ${dbName}`);   // identifier validated above
  const { rows } = await control.query<Row>(
    'insert into business (slug, name, type, db_name) values ($1,$2,$3,$4) returning *',
    [slug, name, type, dbName],
  );
  return toBusiness(rows[0]!);
}

export async function closeAll(): Promise<void> {
  await Promise.all([...pools.values()].map((p) => p.end()));
  await control.end();
}
