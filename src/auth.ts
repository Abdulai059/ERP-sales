import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

export const hashPassword = (p: string) => argon2.hash(p, { type: argon2.argon2id });
export const verifyPassword = (hash: string, p: string) => argon2.verify(hash, p);

export function signToken(userId: string, email: string, business: string): string {
  return jwt.sign({ sub: userId, email, biz: business }, config.jwtSecret,
    { expiresIn: `${config.sessionTtlMinutes}m` });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.header('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try {
    const p = jwt.verify(token, config.jwtSecret) as { sub: string; email: string; biz: string };
    if (p.biz !== req.business?.slug) return res.status(401).json({ error: 'wrong_business' });
    req.user = { id: p.sub, email: p.email };
    next();
  } catch { res.status(401).json({ error: 'unauthorized' }); }
}

export function requirePermission(code: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rowCount } = await req.db!.query(
        `select 1 from user_role ur
           join role_permission rp on rp.role_id = ur.role_id
           join app_user u on u.id = ur.user_id
          where ur.user_id=$1 and rp.permission_code=$2 and u.active limit 1`,
        [req.user!.id, code]);
      rowCount ? next() : res.status(403).json({ error: 'forbidden', permission: code });
    } catch (e) { next(e); }
  };
}
