import type { Pool, PoolClient } from 'pg';

export interface AuditEntry {
  actorId?: string | null; action: string; entity?: string; entityId?: string;
  reason?: string; data?: unknown;
}

/** Writes an immutable audit row (a database trigger blocks any update or delete). */
export async function audit(db: Pick<Pool | PoolClient, 'query'>, e: AuditEntry): Promise<void> {
  await db.query(
    'insert into audit_log (actor_id, action, entity, entity_id, reason, data) values ($1,$2,$3,$4,$5,$6)',
    [e.actorId ?? null, e.action, e.entity ?? null, e.entityId ?? null, e.reason ?? null,
     e.data === undefined ? null : JSON.stringify(e.data)]);
}
