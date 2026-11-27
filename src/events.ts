import type { Pool, PoolClient } from 'pg';

type Q = Pick<Pool | PoolClient, 'query'>;

/**
 * Outbox: call this with the SAME client/transaction that makes the business change,
 * so the change and its event are committed (or rolled back) together.
 */
export async function emit(db: Q, event: string, payload: unknown): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'insert into outbox (event, payload) values ($1,$2) returning id', [event, JSON.stringify(payload)]);
  return rows[0]!.id;
}
