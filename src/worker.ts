import { listActiveBusinesses, tenantPool } from './db.js';
import type { ModuleRegistry } from './loader.js';
import type { Manifest } from './types.js';

const MAX_ATTEMPTS = 5;
type Pending = { id: string; event: string; payload: unknown; attempts: number };

/** Delivers outbox events with retries. After MAX_ATTEMPTS an event is marked failed (exception list). */
export async function deliverOnce(reg: ModuleRegistry, slug: string, dbName: string): Promise<number> {
  const db = tenantPool(dbName);
  const installed = await reg.installedNames(db);
  const client = await db.connect();
  let delivered = 0;
  try {
    await client.query('begin');
    const { rows } = await client.query<Pending>(
      `select id, event, payload, attempts from outbox
       where delivered_at is null and not failed
       order by created_at limit 20 for update skip locked`);
    for (const ev of rows) {
      const handlers: Array<[Manifest, NonNullable<Manifest['events']>[string]]> = [];
      for (const m of reg.modules.values()) {
        const h = m.events?.[ev.event];
        if (h && installed.has(m.name)) handlers.push([m, h]);
      }
      try {
        for (const [, h] of handlers) await h({ eventId: ev.id, business: slug, payload: ev.payload, db });
        await client.query('update outbox set delivered_at=now() where id=$1', [ev.id]);
        delivered++;
      } catch (e) {
        const attempts = ev.attempts + 1;
        await client.query(
          'update outbox set attempts=$2, last_error=$3, failed=$4 where id=$1',
          [ev.id, attempts, (e as Error).message, attempts >= MAX_ATTEMPTS]);
      }
    }
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; }
  finally { client.release(); }
  return delivered;
}

export function startWorker(reg: ModuleRegistry, intervalMs = 2000): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      for (const b of await listActiveBusinesses()) await deliverOnce(reg, b.slug, b.dbName);
    } catch (e) { console.error('[worker]', (e as Error).message); }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
  return () => { stopped = true; };
}
