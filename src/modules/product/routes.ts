import { Router, type NextFunction, type Request, type Response } from 'express';
import { audit } from '../../audit.js';
import { requireAuth, requirePermission } from '../../auth.js';
import { emit } from '../../events.js';
import { bool, int, oneOf, optStr, parseBody, regex, str, uuidOrNull, type Rule } from '../../validate.js';

export const routes = Router();
routes.use(requireAuth);

const PRODUCT_RULES: Record<string, Rule> = {
  name: str(1, 200), sku: optStr(60), barcode: optStr(60), category_id: uuidOrNull,
  price_minor: int(0), currency: regex(/^[A-Z]{3}$/), tax_code: optStr(30),
  track_stock: bool, unit: str(1, 20), qty_decimals: int(0, 3), active: bool,
};
const REQUIRED = ['name', 'price_minor', 'currency'];

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch((e: { code?: string }) =>
      e.code === '23505' ? res.status(409).json({ error: 'duplicate_sku_or_barcode' })
      : e.code === '23503' ? res.status(400).json({ error: 'unknown_reference' })
      : next(e));

routes.get('/categories', requirePermission('product.view'), wrap(async (req, res) => {
  res.json((await req.db!.query('select * from product_category order by name')).rows);
}));

routes.post('/categories', requirePermission('product.manage'), wrap(async (req, res) => {
  const { values, errors } = parseBody(req.body, { name: str(1, 100), parent_id: uuidOrNull }, ['name']);
  if (errors.length) return res.status(400).json({ error: 'invalid', details: errors });
  const { rows } = await req.db!.query(
    'insert into product_category (name, parent_id) values ($1,$2) returning *',
    [values.name, values.parent_id ?? null]);
  await audit(req.db!, { actorId: req.user!.id, action: 'product.category_created', entity: 'product_category', entityId: rows[0].id });
  res.status(201).json(rows[0]);
}));

routes.get('/items', requirePermission('product.view'), wrap(async (req, res) => {
  const where: string[] = []; const params: unknown[] = [];
  if (typeof req.query.q === 'string' && req.query.q) {
    params.push(`%${req.query.q.toLowerCase()}%`);
    where.push(`(lower(name) like $${params.length} or sku = $${params.length + 1} or barcode = $${params.length + 1})`);
    params.push(req.query.q);
  }
  if (typeof req.query.category_id === 'string') { params.push(req.query.category_id); where.push(`category_id = $${params.length}`); }
  if (req.query.active !== 'all') where.push('active');
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows } = await req.db!.query(
    `select * from product ${where.length ? 'where ' + where.join(' and ') : ''}
     order by lower(name) limit ${limit} offset ${offset}`, params);
  res.json(rows);
}));

routes.get('/items/:id', requirePermission('product.view'), wrap(async (req, res) => {
  const { rows } = await req.db!.query('select * from product where id=$1', [req.params.id]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'not_found' });
}));

routes.post('/items', requirePermission('product.manage'), wrap(async (req, res) => {
  const { values, errors } = parseBody(req.body, PRODUCT_RULES, REQUIRED);
  if (errors.length) return res.status(400).json({ error: 'invalid', details: errors });
  const cols = Object.keys(values);
  const client = await req.db!.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `insert into product (${cols.join(',')}, created_by) values (${cols.map((_, i) => `$${i + 1}`).join(',')}, $${cols.length + 1}) returning *`,
      [...Object.values(values), req.user!.id]);
    const p = rows[0];
    await audit(client, { actorId: req.user!.id, action: 'product.created', entity: 'product', entityId: p.id });
    await emit(client, 'product.created', { id: p.id, name: p.name, price_minor: Number(p.price_minor), currency: p.currency });
    await client.query('commit');
    res.status(201).json(p);
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
}));

routes.patch('/items/:id', requirePermission('product.manage'), wrap(async (req, res) => {
  const { values, errors } = parseBody(req.body, PRODUCT_RULES);
  if (errors.length) return res.status(400).json({ error: 'invalid', details: errors });
  const cols = Object.keys(values);
  if (!cols.length) return res.status(400).json({ error: 'nothing_to_update' });
  const client = await req.db!.connect();
  try {
    await client.query('begin');
    const before = (await client.query('select * from product where id=$1 for update', [req.params.id])).rows[0];
    if (!before) { await client.query('rollback'); return res.status(404).json({ error: 'not_found' }); }
    const { rows } = await client.query(
      `update product set ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')}, updated_at=now() where id=$${cols.length + 1} returning *`,
      [...Object.values(values), req.params.id]);
    const after = rows[0];
    if (Number(before.price_minor) !== Number(after.price_minor) || before.currency !== after.currency) {
      const change = { id: after.id, from: { price_minor: Number(before.price_minor), currency: before.currency },
                       to: { price_minor: Number(after.price_minor), currency: after.currency } };
      await audit(client, { actorId: req.user!.id, action: 'product.price_changed', entity: 'product', entityId: after.id, data: change });
      await emit(client, 'product.price_changed', change);
    }
    await audit(client, { actorId: req.user!.id, action: 'product.updated', entity: 'product', entityId: after.id, data: values });
    await client.query('commit');
    res.json(after);
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
}));
