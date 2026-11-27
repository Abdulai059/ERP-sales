import { Router } from 'express';
import { audit } from '../../audit.js';
import { hashPassword, requireAuth, requirePermission, signToken, verifyPassword } from '../../auth.js';

export const routes = Router();

routes.post('/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'email_and_password_required' });
    const { rows } = await req.db!.query(
      'select id, email, password_hash from app_user where email=$1 and active', [email.toLowerCase()]);
    const u = rows[0];
    if (!u || !(await verifyPassword(u.password_hash, password))) {
      await audit(req.db!, { action: 'login.failed', entity: 'app_user', data: { email } });
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    await audit(req.db!, { actorId: u.id, action: 'login.ok', entity: 'app_user', entityId: u.id });
    res.json({ token: signToken(u.id, u.email, req.business!.slug) });
  } catch (e) { next(e); }
});

routes.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await req.db!.query(
      `select p.code from user_role ur join role_permission rp on rp.role_id=ur.role_id
         join permission p on p.code=rp.permission_code where ur.user_id=$1 order by p.code`, [req.user!.id]);
    res.json({ user: req.user, business: req.business!.slug, permissions: rows.map((r) => r.code) });
  } catch (e) { next(e); }
});

routes.post('/users', requireAuth, requirePermission('users.manage'), async (req, res, next) => {
  try {
    const { email, name, password, role } = req.body ?? {};
    if (![email, name, password, role].every((v) => typeof v === 'string' && v))
      return res.status(400).json({ error: 'email_name_password_role_required' });
    if (password.length < 10) return res.status(400).json({ error: 'password_too_short' });
    const client = await req.db!.connect();
    try {
      await client.query('begin');
      const r = await client.query('select id from role where name=$1', [role]);
      if (!r.rows[0]) { await client.query('rollback'); return res.status(400).json({ error: 'unknown_role' }); }
      const u = await client.query(
        'insert into app_user (email, name, password_hash) values ($1,$2,$3) returning id, email, name',
        [email.toLowerCase(), name, await hashPassword(password)]);
      await client.query('insert into user_role (user_id, role_id) values ($1,$2)', [u.rows[0].id, r.rows[0].id]);
      await audit(client, { actorId: req.user!.id, action: 'user.created', entity: 'app_user',
        entityId: u.rows[0].id, data: { email, role } });
      await client.query('commit');
      res.status(201).json(u.rows[0]);
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  } catch (e) { next(e); }
});

routes.get('/audit', requireAuth, requirePermission('audit.view'), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await req.db!.query('select * from audit_log order by at desc limit $1', [limit]);
    res.json(rows);
  } catch (e) { next(e); }
});
