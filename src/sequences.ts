import type { Pool, PoolClient } from 'pg';

/** Gap-free number per named sequence (e.g. receipt numbers per register: "receipt_reg1"). */
export async function nextNumber(db: Pick<Pool | PoolClient, 'query'>, name: string): Promise<string> {
  await db.query('insert into sequence (name) values ($1) on conflict do nothing', [name]);
  const { rows } = await db.query<{ prefix: string; n: string }>(
    'update sequence set next_value = next_value + 1 where name=$1 returning prefix, next_value - 1 as n', [name]);
  return `${rows[0]!.prefix}${rows[0]!.n}`;
}
