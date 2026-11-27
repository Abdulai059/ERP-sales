import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { audit } from '../../audit.js';
import { requireAuth, requirePermission } from '../../auth.js';
import { emit } from '../../events.js';
import { nextNumber } from '../../sequences.js';
import { bool, int, oneOf, parseBody, regex, str, type Rule } from '../../validate.js';
import { lineAmounts, parseQty } from './money.js';

export const routes = Router();
routes.use(requireAuth);

class HttpError extends Error {
  constructor(public status: number, public error: string, public details?: unknown) { super(error); }
}
type Q = Pick<Pool | PoolClient, 'query'>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch((e: { code?: string }) => {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.error, details: e.details });
      if (e.code === '23505') return res.status(409).json({ error: 'conflict' });
      if (e.code === '23503') return res.status(400).json({ error: 'unknown_reference' });
      if (e.code === '22P02') return res.status(400).json({ error: 'invalid_id' });
      next(e);
    });

/** Runs fn in one transaction. Throw (e.g. HttpError) to roll everything back, including receipt numbers. */
async function tx<T>(db: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback'); throw e; }
  finally { c.release(); }
}

const can = async (db: Q, userId: string, code: string) =>
  ((await db.query(
    `select 1 from user_role ur join role_permission rp on rp.role_id=ur.role_id
      where ur.user_id=$1 and rp.permission_code=$2 limit 1`, [userId, code])).rowCount ?? 0) > 0;

/** pg returns bigint as string; convert money/quantity columns to numbers (all are safe integers). */
function norm<T extends Record<string, unknown>>(row: T): T {
  const o: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(o))
    if (/_(minor|milli|bp)$/.test(k) && v !== null && v !== undefined) o[k] = Number(v);
  return o as T;
}

const body = (req: Request, rules: Record<string, Rule>, required: string[] = []) => {
  const { values, errors } = parseBody(req.body, rules, required);
  if (errors.length) throw new HttpError(400, 'invalid', errors);
  return values;
};
const uuid: Rule<string> = (v) => (typeof v === 'string' && UUID.test(v) ? v : undefined);

// ---------------- setup data (pos.manage) ----------------
routes.post('/outlets', requirePermission('pos.manage'), wrap(async (req, res) => {
  const v = body(req, { name: str(1, 100), type: oneOf('retail', 'restaurant'),
    currency: regex(/^[A-Z]{3}$/), tax_inclusive: bool }, ['name', 'type', 'currency']);
  const { rows } = await req.db!.query(
    'insert into pos_outlet (name, type, currency, tax_inclusive) values ($1,$2,$3,$4) returning *',
    [v.name, v.type, v.currency, v.tax_inclusive ?? false]);
  await audit(req.db!, { actorId: req.user!.id, action: 'pos.outlet_created', entity: 'pos_outlet', entityId: rows[0].id });
  res.status(201).json(rows[0]);
}));
routes.get('/outlets', requirePermission('pos.view'), wrap(async (req, res) => {
  res.json((await req.db!.query('select * from pos_outlet order by name')).rows);
}));

routes.post('/registers', requirePermission('pos.manage'), wrap(async (req, res) => {
  const v = body(req, { outlet_id: uuid, name: str(1, 60), code: regex(/^[A-Z0-9]{2,8}$/) }, ['outlet_id', 'name', 'code']);
  const row = await tx(req.db!, async (c) => {
    const { rows } = await c.query('insert into pos_register (outlet_id, name, code) values ($1,$2,$3) returning *',
      [v.outlet_id, v.name, v.code]);
    await c.query('insert into sequence (name, prefix) values ($1,$2)', [`receipt_${v.code}`, `${v.code}-`]);
    await audit(c, { actorId: req.user!.id, action: 'pos.register_created', entity: 'pos_register', entityId: rows[0].id });
    return rows[0];
  });
  res.status(201).json(row);
}));
routes.get('/registers', requirePermission('pos.view'), wrap(async (req, res) => {
  res.json((await req.db!.query('select * from pos_register order by code')).rows);
}));

routes.post('/taxes', requirePermission('pos.manage'), wrap(async (req, res) => {
  const v = body(req, { code: regex(/^[A-Za-z0-9_-]{1,30}$/), name: str(1, 60), rate_bp: int(0, 10000) }, ['code', 'name', 'rate_bp']);
  const { rows } = await req.db!.query(
    `insert into pos_tax (code, name, rate_bp) values ($1,$2,$3)
     on conflict (code) do update set name=excluded.name, rate_bp=excluded.rate_bp returning *`, [v.code, v.name, v.rate_bp]);
  await audit(req.db!, { actorId: req.user!.id, action: 'pos.tax_saved', entity: 'pos_tax', entityId: v.code as string, data: v });
  res.status(201).json(rows[0]);
}));
routes.get('/taxes', requirePermission('pos.view'), wrap(async (req, res) => {
  res.json((await req.db!.query('select * from pos_tax order by code')).rows);
}));

routes.post('/payment-methods', requirePermission('pos.manage'), wrap(async (req, res) => {
  const v = body(req, { code: regex(/^[a-z0-9_]{1,30}$/), name: str(1, 60),
    type: oneOf('cash', 'card', 'mobile_money', 'other'), active: bool }, ['code', 'name', 'type']);
  const { rows } = await req.db!.query(
    'insert into pos_payment_method (code, name, type, active) values ($1,$2,$3,$4) returning *',
    [v.code, v.name, v.type, v.active ?? true]);
  res.status(201).json(rows[0]);
}));
routes.get('/payment-methods', requirePermission('pos.view'), wrap(async (req, res) => {
  res.json((await req.db!.query('select * from pos_payment_method order by code')).rows);
}));

// ---------------- sessions ----------------
async function sessionSummary(c: Q, id: string) {
  const s = (await c.query('select * from pos_session where id=$1', [id])).rows[0];
  if (!s) throw new HttpError(404, 'not_found');
  const byMethod = (await c.query(
    `select m.code, m.type, sum(p.amount_minor)::bigint as amount_minor, count(*)::int as count
       from pos_payment p join pos_payment_method m on m.id=p.method_id
      where p.session_id=$1 group by m.code, m.type order by m.code`, [id])).rows.map(norm);
  const cashNet = byMethod.filter((m) => m.type === 'cash').reduce((a, m) => a + Number(m.amount_minor), 0);
  const counts = (await c.query(
    `select count(*) filter (where state='paid')::int as paid, count(*) filter (where state='open')::int as open,
            count(*) filter (where state='refunded')::int as refunded, count(*) filter (where state='cancelled')::int as cancelled
       from pos_order where session_id=$1`, [id])).rows[0];
  return { session: norm(s), payments_by_method: byMethod, orders: counts,
    expected_cash_minor: Number(s.opening_cash_minor) + cashNet };
}

routes.post('/sessions/open', requirePermission('pos.sell'), wrap(async (req, res) => {
  const v = body(req, { register_id: uuid, opening_cash_minor: int(0) }, ['register_id', 'opening_cash_minor']);
  const s = await tx(req.db!, async (c) => {
    const reg = (await c.query('select active from pos_register where id=$1', [v.register_id])).rows[0];
    if (!reg) throw new HttpError(404, 'register_not_found');
    if (!reg.active) throw new HttpError(409, 'register_inactive');
    let row;
    try {
      row = (await c.query(
        'insert into pos_session (register_id, cashier_id, opening_cash_minor) values ($1,$2,$3) returning *',
        [v.register_id, req.user!.id, v.opening_cash_minor])).rows[0];
    } catch (e) { if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'session_already_open'); throw e; }
    await audit(c, { actorId: req.user!.id, action: 'pos.session_opened', entity: 'pos_session', entityId: row.id, data: { opening_cash_minor: v.opening_cash_minor } });
    await emit(c, 'pos.session.opened', { session_id: row.id, register_id: row.register_id, cashier_id: row.cashier_id });
    return row;
  });
  res.status(201).json(norm(s));
}));

routes.get('/sessions/current', requirePermission('pos.view'), wrap(async (req, res) => {
  const reg = String(req.query.register_id ?? '');
  if (!UUID.test(reg)) throw new HttpError(400, 'register_id_required');
  const r = (await req.db!.query("select id from pos_session where register_id=$1 and state='open'", [reg])).rows[0];
  if (!r) throw new HttpError(404, 'no_open_session');
  res.json(await sessionSummary(req.db!, r.id));
}));

routes.get('/sessions/:id', requirePermission('pos.view'), wrap(async (req, res) => {
  res.json(await sessionSummary(req.db!, String(req.params.id)));
}));

routes.post('/sessions/:id/close', requirePermission('pos.sell'), wrap(async (req, res) => {
  const v = body(req, { counted_cash_minor: int(0) }, ['counted_cash_minor']);
  const out = await tx(req.db!, async (c) => {
    const s = (await c.query('select * from pos_session where id=$1 for update', [req.params.id])).rows[0];
    if (!s) throw new HttpError(404, 'not_found');
    if (s.state !== 'open') throw new HttpError(409, 'session_not_open');
    if (s.cashier_id !== req.user!.id && !(await can(c, req.user!.id, 'pos.approve')))
      throw new HttpError(403, 'not_your_session');
    const open = (await c.query("select count(*)::int as n from pos_order where session_id=$1 and state='open'", [s.id])).rows[0].n;
    if (open > 0) throw new HttpError(409, 'open_orders_exist', { open });
    const { expected_cash_minor } = await sessionSummary(c, s.id);
    const diff = (v.counted_cash_minor as number) - expected_cash_minor;
    await c.query(
      `update pos_session set state='closed', closed_at=now(), counted_cash_minor=$2, expected_cash_minor=$3, difference_minor=$4 where id=$1`,
      [s.id, v.counted_cash_minor, expected_cash_minor, diff]);
    await audit(c, { actorId: req.user!.id, action: 'pos.session_closed', entity: 'pos_session', entityId: s.id,
      data: { counted: v.counted_cash_minor, expected: expected_cash_minor, difference: diff } });
    await emit(c, 'pos.session.closed', { session_id: s.id, register_id: s.register_id, expected_cash_minor, counted_cash_minor: v.counted_cash_minor, difference_minor: diff });
    return sessionSummary(c, s.id);
  });
  res.json(out);
}));

// ---------------- orders ----------------
async function fullOrder(c: Q, id: string) {
  const o = (await c.query('select * from pos_order where id=$1', [id])).rows[0];
  if (!o) throw new HttpError(404, 'not_found');
  const lines = (await c.query('select * from pos_order_line where order_id=$1 order by created_at, id', [id])).rows.map(norm);
  const payments = (await c.query(
    `select p.*, m.code as method_code, m.type as method_type from pos_payment p
       join pos_payment_method m on m.id=p.method_id where p.order_id=$1 order by p.created_at, p.id`, [id])).rows.map(norm);
  return { ...norm(o), lines, payments };
}
async function loadOrder(c: Q, id: string) {
  const r = (await c.query(
    `select o.*, s.cashier_id, s.state as session_state from pos_order o
       join pos_session s on s.id=o.session_id where o.id=$1 for update of o`, [id])).rows[0];
  if (!r) throw new HttpError(404, 'not_found');
  return r;
}
async function ownOrApprover(c: Q, req: Request, cashierId: string) {
  if (cashierId !== req.user!.id && !(await can(c, req.user!.id, 'pos.approve'))) throw new HttpError(403, 'not_your_order');
}
async function recompute(c: Q, orderId: string) {
  await c.query(
    `update pos_order o set subtotal_minor = t.net, tax_minor = t.tax, total_minor = t.total
       from (select coalesce(sum(net_minor),0) net, coalesce(sum(tax_minor),0) tax, coalesce(sum(total_minor),0) total
               from pos_order_line where order_id=$1) t where o.id=$1`, [orderId]);
}

routes.post('/orders', requirePermission('pos.sell'), wrap(async (req, res) => {
  const v = body(req, { session_id: uuid, id: uuid }, ['session_id']);
  const out = await tx(req.db!, async (c) => {
    if (v.id) {   // idempotent create: the client may retry with the same id
      const ex = (await c.query('select session_id from pos_order where id=$1', [v.id])).rows[0];
      if (ex) { if (ex.session_id !== v.session_id) throw new HttpError(409, 'id_in_use'); return { order: await fullOrder(c, v.id as string), created: false }; }
    }
    const s = (await c.query(
      `select s.*, o.currency, o.tax_inclusive from pos_session s join pos_register r on r.id=s.register_id
         join pos_outlet o on o.id=r.outlet_id where s.id=$1`, [v.session_id])).rows[0];
    if (!s) throw new HttpError(404, 'session_not_found');
    if (s.state !== 'open') throw new HttpError(409, 'session_not_open');
    if (s.cashier_id !== req.user!.id) throw new HttpError(403, 'not_your_session');
    const { rows } = await c.query(
      `insert into pos_order (id, session_id, register_id, currency, tax_inclusive, created_by)
       values (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6) returning id`,
      [v.id ?? null, s.id, s.register_id, s.currency, s.tax_inclusive, req.user!.id]);
    return { order: await fullOrder(c, rows[0].id), created: true };
  });
  res.status(out.created ? 201 : 200).json(out.order);
}));

routes.get('/orders/:id', requirePermission('pos.view'), wrap(async (req, res) => {
  res.json(await fullOrder(req.db!, String(req.params.id)));
}));

routes.post('/orders/:id/lines', requirePermission('pos.sell'), wrap(async (req, res) => {
  const v = body(req, { product_id: uuid }, ['product_id']);
  const out = await tx(req.db!, async (c) => {
    const o = await loadOrder(c, String(req.params.id));
    if (o.state !== 'open') throw new HttpError(409, 'order_not_open');
    if (o.session_state !== 'open') throw new HttpError(409, 'session_not_open');
    await ownOrApprover(c, req, o.cashier_id);
    const p = (await c.query('select * from product where id=$1', [v.product_id])).rows[0];
    if (!p || !p.active) throw new HttpError(400, 'unknown_or_inactive_product');
    if (p.currency.trim() !== o.currency.trim()) throw new HttpError(400, 'currency_mismatch', { product: p.currency, outlet: o.currency });
    const qty = parseQty((req.body as Record<string, unknown>).qty, p.qty_decimals);
    if (qty === undefined) throw new HttpError(400, 'invalid_qty', { allowed_decimals: p.qty_decimals });
    let rate = 0;
    if (p.tax_code) {
      const t = (await c.query('select rate_bp from pos_tax where code=$1', [p.tax_code])).rows[0];
      if (!t) throw new HttpError(400, 'unknown_tax_code', { tax_code: p.tax_code });
      rate = t.rate_bp;
    }
    const a = lineAmounts(Number(p.price_minor), qty, rate, o.tax_inclusive);
    await c.query(
      `insert into pos_order_line (order_id, product_id, name, qty_milli, unit_price_minor, tax_code, tax_rate_bp, net_minor, tax_minor, total_minor)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [o.id, p.id, p.name, qty, p.price_minor, p.tax_code, rate, a.net, a.tax, a.total]);
    await recompute(c, o.id);
    return fullOrder(c, o.id);
  });
  res.status(201).json(out);
}));

routes.delete('/orders/:id/lines/:lineId', requirePermission('pos.sell'), wrap(async (req, res) => {
  const out = await tx(req.db!, async (c) => {
    const o = await loadOrder(c, String(req.params.id));
    if (o.state !== 'open') throw new HttpError(409, 'order_not_open');
    await ownOrApprover(c, req, o.cashier_id);
    const d = await c.query('delete from pos_order_line where id=$1 and order_id=$2', [req.params.lineId, o.id]);
    if (!d.rowCount) throw new HttpError(404, 'line_not_found');
    await recompute(c, o.id);
    return fullOrder(c, o.id);
  });
  res.json(out);
}));

routes.post('/orders/:id/pay', requirePermission('pos.sell'), wrap(async (req, res) => {
  const raw = (req.body as { payments?: unknown }).payments;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) throw new HttpError(400, 'payments_required');
  const pays = raw.map((p, i) => {
    const r = parseBody(p, { method_id: uuid, amount_minor: int(1), tendered_minor: int(1) }, ['method_id', 'amount_minor']);
    if (r.errors.length) throw new HttpError(400, 'invalid_payment', { index: i, errors: r.errors });
    return r.values as { method_id: string; amount_minor: number; tendered_minor?: number };
  });
  const out = await tx(req.db!, async (c) => {
    const o = await loadOrder(c, String(req.params.id));
    if (o.state === 'paid') return { order: await fullOrder(c, o.id), already_paid: true };   // safe to retry
    if (o.state !== 'open') throw new HttpError(409, 'order_not_open');
    if (o.session_state !== 'open') throw new HttpError(409, 'session_not_open');
    await ownOrApprover(c, req, o.cashier_id);
    const total = Number(o.total_minor);
    if (total <= 0) throw new HttpError(400, 'empty_order');
    if (pays.reduce((a, p) => a + p.amount_minor, 0) !== total)
      throw new HttpError(400, 'amounts_must_equal_total', { total_minor: total });

    // The receipt number is taken inside this transaction: if anything below fails it is rolled back, so there are no gaps.
    const reg = (await c.query('select code from pos_register where id=$1', [o.register_id])).rows[0];
    const receipt = await nextNumber(c, `receipt_${reg.code}`);

    const ids = pays.map((p) => p.method_id);
    const methods = (await c.query('select id, type, active from pos_payment_method where id = any($1::uuid[])', [ids])).rows;
    for (const p of pays) {
      const m = methods.find((x) => x.id === p.method_id);
      if (!m) throw new HttpError(400, 'unknown_payment_method', { method_id: p.method_id });
      if (!m.active) throw new HttpError(400, 'payment_method_inactive', { method_id: p.method_id });
      let tendered = p.amount_minor, change = 0;
      if (m.type === 'cash') {
        tendered = p.tendered_minor ?? p.amount_minor;
        if (tendered < p.amount_minor) throw new HttpError(400, 'tendered_less_than_amount');
        change = tendered - p.amount_minor;
      } else if (p.tendered_minor !== undefined && p.tendered_minor !== p.amount_minor) {
        throw new HttpError(400, 'non_cash_cannot_overpay');
      }
      await c.query(
        `insert into pos_payment (order_id, session_id, method_id, kind, amount_minor, tendered_minor, change_minor, created_by)
         values ($1,$2,$3,'payment',$4,$5,$6,$7)`, [o.id, o.session_id, p.method_id, p.amount_minor, tendered, change, req.user!.id]);
    }
    await c.query("update pos_order set state='paid', receipt_no=$2, paid_at=now() where id=$1", [o.id, receipt]);
    const full = await fullOrder(c, o.id);
    await audit(c, { actorId: req.user!.id, action: 'pos.order_paid', entity: 'pos_order', entityId: o.id, data: { receipt_no: receipt, total_minor: total } });
    await emit(c, 'pos.order.paid', {
      order_id: o.id, receipt_no: receipt, register_id: o.register_id, session_id: o.session_id,
      currency: o.currency.trim(), subtotal_minor: Number(o.subtotal_minor), tax_minor: Number(o.tax_minor), total_minor: total,
      lines: full.lines.map((l: Record<string, unknown>) => ({ product_id: l.product_id, qty_milli: l.qty_milli, total_minor: l.total_minor })),
      payments: full.payments.map((p: Record<string, unknown>) => ({ method_code: p.method_code, method_type: p.method_type, amount_minor: p.amount_minor })),
    });
    return { order: full, already_paid: false };
  });
  res.json({ ...out.order, already_paid: out.already_paid });
}));

routes.post('/orders/:id/cancel', requirePermission('pos.sell'), wrap(async (req, res) => {
  const v = body(req, { reason: str(3, 300) }, ['reason']);
  const out = await tx(req.db!, async (c) => {
    const o = await loadOrder(c, String(req.params.id));
    if (o.state !== 'open') throw new HttpError(409, 'only_open_orders_can_be_cancelled');
    await ownOrApprover(c, req, o.cashier_id);
    await c.query("update pos_order set state='cancelled' where id=$1", [o.id]);
    await c.query("insert into pos_order_adjustment (order_id, kind, reason, actor_id) values ($1,'cancel',$2,$3)", [o.id, v.reason, req.user!.id]);
    await audit(c, { actorId: req.user!.id, action: 'pos.order_cancelled', entity: 'pos_order', entityId: o.id, reason: v.reason as string });
    return fullOrder(c, o.id);
  });
  res.json(out);
}));

/** Full refund of a paid order. Needs manager approval (pos.approve). Money moves in the session given. */
routes.post('/orders/:id/refund', requirePermission('pos.approve'), wrap(async (req, res) => {
  const v = body(req, { reason: str(3, 300), session_id: uuid }, ['reason', 'session_id']);
  const out = await tx(req.db!, async (c) => {
    const o = await loadOrder(c, String(req.params.id));
    if (o.state !== 'paid') throw new HttpError(409, 'only_paid_orders_can_be_refunded');
    const s = (await c.query('select state from pos_session where id=$1', [v.session_id])).rows[0];
    if (!s) throw new HttpError(404, 'session_not_found');
    if (s.state !== 'open') throw new HttpError(409, 'session_not_open');
    const orig = (await c.query("select method_id, amount_minor from pos_payment where order_id=$1 and kind='payment'", [o.id])).rows;
    for (const p of orig)
      await c.query(
        `insert into pos_payment (order_id, session_id, method_id, kind, amount_minor, created_by) values ($1,$2,$3,'refund',$4,$5)`,
        [o.id, v.session_id, p.method_id, -Number(p.amount_minor), req.user!.id]);
    await c.query("update pos_order set state='refunded' where id=$1", [o.id]);
    await c.query("insert into pos_order_adjustment (order_id, kind, reason, actor_id) values ($1,'refund',$2,$3)", [o.id, v.reason, req.user!.id]);
    await audit(c, { actorId: req.user!.id, action: 'pos.order_refunded', entity: 'pos_order', entityId: o.id, reason: v.reason as string, data: { total_minor: Number(o.total_minor) } });
    await emit(c, 'pos.order.refunded', { order_id: o.id, receipt_no: o.receipt_no, total_minor: Number(o.total_minor), session_id: v.session_id, approver_id: req.user!.id });
    return fullOrder(c, o.id);
  });
  res.json(out);
}));
