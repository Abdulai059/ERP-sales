import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { findBusiness, tenantPool } from './db.js';

/** Resolve which business a request is for. Production: subdomain. Dev: x-business header. */
export function resolveSlug(host: string | undefined, header: string | undefined): string | null {
  const h = (host ?? '').split(':')[0] ?? '';
  const suffix = '.' + config.baseDomain;
  if (h.endsWith(suffix)) return h.slice(0, -suffix.length) || null;
  if (!config.isProd && header) return header;
  return null;
}

export async function tenancy(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = resolveSlug(req.headers.host, req.header('x-business'));
    if (!slug) return res.status(400).json({ error: 'unknown_business' });
    const business = await findBusiness(slug);
    if (!business || business.status !== 'active') return res.status(404).json({ error: 'unknown_business' });
    req.business = business;
    req.db = tenantPool(business.dbName);
    next();
  } catch (e) { next(e); }
}
