import type { Router } from 'express';
import type { Pool } from 'pg';

export interface EventContext {
  eventId: string;
  business: string;
  payload: unknown;
  db: Pool;
}
/** Handlers MUST be idempotent: the same eventId can be delivered more than once. */
export type EventHandler = (ctx: EventContext) => Promise<void>;

export interface Manifest {
  name: string;                 // [a-z][a-z0-9_]*
  version: string;              // semver
  kernel: string;               // compatible kernel range, informational for now
  description: string;
  depends: string[];
  permissions?: Record<string, string>;   // code -> description
  events?: Record<string, EventHandler>;  // event name -> handler
  routes?: Router;                        // mounted at /api/v1/<name>
}

export interface Business {
  id: string;
  slug: string;
  name: string;
  type: string;
  dbName: string;
  status: string;
}

export interface AuthUser { id: string; email: string }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { business?: Business; db?: Pool; user?: AuthUser }
  }
}
