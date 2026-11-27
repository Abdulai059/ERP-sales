import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import pg from 'pg';

process.env.JWT_SECRET = 'integration-test-secret-123456';
const { config } = await import('../src/config.js');
const { closeAll, createBusiness, tenantPool } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { installModules } = await import('../src/loader.js');
const { hashPassword } = await import('../src/auth.js');
const { lineAmounts, parseQty } = await import('../src/modules/pos_core/money.js');

// ---------- pure money tests ----------
test('money: tax exclusive, inclusive, half-up rounding, weighed quantity', () => {
  assert.deepEqual(lineAmounts(250, 2000, 1500, false), { net: 500, tax: 75, total: 575 });
  assert.deepEqual(lineAmounts(1150, 1000, 1500, true), { net: 1000, tax: 150, total: 1150 });
  assert.equal(lineAmounts(105, 1000, 1000, false).tax, 11);        // 10.5 rounds up
  assert.equal(lineAmounts(333, 500, 0, false).total, 167);         // 166.5 rounds up
  assert.equal(lineAmounts(1250, 500, 0, false).total, 625);        // 0.5 kg
});
test('money: quantity must respect product decimals', () => {
  assert.equal(parseQty(2, 0), 2000);
  assert.equal(parseQty(1.5, 0), undefined);
  assert.equal(parseQty(0.5, 3), 500);
  assert.equal(parseQty(0.5555, 3), undefined);
  assert.equal(parseQty(0, 0), undefined);
  assert.equal(parseQty(-1, 0), undefined);
  assert.equal(parseQty('0.25', 2), 250);
});

// ---------- integration ----------
const slug = `pos-${Date.now().toString(36)}`;
let dbName = '', base = '', server: import('node:http').Server;
let db: ReturnType<typeof tenantPool>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const T: any = {};            // tokens
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ID: any = {};           // ids

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + '/api/v1/pos_core' + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-business': slug, ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null };
}
const prod = async (body: object) => {
  const r = await fetch(base + '/api/v1/product/items', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-business': slug, authorization: `Bearer ${T.owner}` }, body: JSON.stringify(body) });
  return (await r.json()) as { id: string };
};
async function user(email: string, role: string) {
  const u = await db.query('insert into app_user (email,name,password_hash) values ($1,$1,$2) returning id', [email, await hashPassword('LongPassword123')]);
  await db.query('insert into user_role (user_id, role_id) select $1, id from role where name=$2', [u.rows[0].id, role]);
  const r = await fetch(base + '/api/v1/core_base/auth/login', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-business': slug }, body: JSON.stringify({ email, password: 'LongPassword123' }) });
  return ((await r.json()) as { token: string }).token;
}
const pay = (orderId: string, token: string, payments: object[]) =>
  api(`/orders/${orderId}/pay`, { method: 'POST', token, body: { payments } });

before(async () => {
  const { app, reg } = await createApp();
  server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  dbName = (await createBusiness(slug, slug, 'blank')).dbName; db = tenantPool(dbName);
  await installModules(reg, db, ['pos_core']);
  await db.query("insert into role (name) values ('cashier')");
  await db.query("insert into role_permission select id, p from role, unnest(array['pos.sell','pos.view']) p where name='cashier'");
  T.owner = await user('owner@x.test', 'owner'); T.c1 = await user('c1@x.test', 'cashier'); T.c2 = await user('c2@x.test', 'cashier');

  ID.outlet = (await api('/outlets', { method: 'POST', token: T.owner, body: { name: 'Shop', type: 'retail', currency: 'USD' } })).json.id;
  ID.main = (await api('/registers', { method: 'POST', token: T.owner, body: { outlet_id: ID.outlet, name: 'Till 1', code: 'MAIN' } })).json.id;
  ID.bar = (await api('/registers', { method: 'POST', token: T.owner, body: { outlet_id: ID.outlet, name: 'Till 2', code: 'BAR' } })).json.id;
  await api('/taxes', { method: 'POST', token: T.owner, body: { code: 'VAT', name: 'VAT 15%', rate_bp: 1500 } });
  ID.card = (await api('/payment-methods', { method: 'POST', token: T.owner, body: { code: 'card', name: 'Card', type: 'card' } })).json.id;
  ID.cash = (await api('/payment-methods', { token: T.owner })).json.find((m: { code: string }) => m.code === 'cash').id;
  ID.coffee = (await prod({ name: 'Coffee', price_minor: 250, currency: 'USD', tax_code: 'VAT' })).id;
  ID.rice = (await prod({ name: 'Rice', price_minor: 1250, currency: 'USD', qty_decimals: 3, unit: 'kg' })).id;
  ID.euro = (await prod({ name: 'Euro item', price_minor: 100, currency: 'EUR' })).id;
});

after(async () => {
  server.close(); await closeAll();
  const a = new pg.Client(config.controlUrl); await a.connect();
  await a.query(`drop database if exists ${dbName} with (force)`); await a.query('delete from business where slug=$1', [slug]); await a.end();
});

test('only one open session per register; cashier-only role cannot configure', async () => {
  const s1 = await api('/sessions/open', { method: 'POST', token: T.c1, body: { register_id: ID.main, opening_cash_minor: 10000 } });
  assert.equal(s1.status, 201); ID.s1 = s1.json.id;
  const dup = await api('/sessions/open', { method: 'POST', token: T.c2, body: { register_id: ID.main, opening_cash_minor: 0 } });
  assert.equal(dup.status, 409); assert.equal(dup.json.error, 'session_already_open');
  assert.equal((await api('/outlets', { method: 'POST', token: T.c1, body: { name: 'X', type: 'retail', currency: 'USD' } })).status, 403);
});

test('lines: tax computed on the server; decimals and currency enforced', async () => {
  ID.o1 = (await api('/orders', { method: 'POST', token: T.c1, body: { session_id: ID.s1 } })).json.id;
  const add = (pid: string, qty: unknown, token = T.c1) => api(`/orders/${ID.o1}/lines`, { method: 'POST', token, body: { product_id: pid, qty } });
  assert.equal((await add(ID.coffee, 1.5)).status, 400);        // coffee allows 0 decimals
  assert.equal((await add(ID.rice, 0.5555)).status, 400);
  assert.equal((await add(ID.euro, 1)).json.error, 'currency_mismatch');
  const r = await add(ID.coffee, 2);
  assert.equal(r.status, 201); assert.deepEqual([r.json.subtotal_minor, r.json.tax_minor, r.json.total_minor], [500, 75, 575]);
  assert.equal((await add(ID.coffee, 1, T.c2)).status, 403);     // another cashier cannot touch it
});

test('pay: amounts must match, a failed attempt burns no receipt number, success gives MAIN-1', async () => {
  assert.equal((await pay(ID.o1, T.c1, [{ method_id: ID.cash, amount_minor: 500 }])).json.error, 'amounts_must_equal_total');
  const bad = await pay(ID.o1, T.c1, [{ method_id: '00000000-0000-4000-8000-000000000000', amount_minor: 575 }]);
  assert.equal(bad.json.error, 'unknown_payment_method');
  assert.equal((await api(`/orders/${ID.o1}`, { token: T.c1 })).json.receipt_no, null);
  const ok = await pay(ID.o1, T.c1, [{ method_id: ID.cash, amount_minor: 575, tendered_minor: 1000 }]);
  assert.equal(ok.status, 200); assert.equal(ok.json.receipt_no, 'MAIN-1'); assert.equal(ok.json.state, 'paid');
  assert.equal(ok.json.payments[0].change_minor, 425);
});

test('pay is idempotent: a retry returns the same receipt and emits one event', async () => {
  const again = await pay(ID.o1, T.c1, [{ method_id: ID.cash, amount_minor: 575 }]);
  assert.equal(again.status, 200); assert.equal(again.json.already_paid, true); assert.equal(again.json.receipt_no, 'MAIN-1');
  const n = await db.query("select count(*)::int n from outbox where event='pos.order.paid' and payload->>'order_id'=$1", [ID.o1]);
  assert.equal(n.rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int n from pos_payment where order_id=$1', [ID.o1])).rows[0].n, 1);
});

test('second order: split payment, next receipt is MAIN-2 (no gap), weighed item', async () => {
  const c = await api('/orders', { method: 'POST', token: T.c1, body: { session_id: ID.s1 } });
  ID.o2 = c.json.id;
  const l = await api(`/orders/${ID.o2}/lines`, { method: 'POST', token: T.c1, body: { product_id: ID.rice, qty: 0.5 } });
  assert.equal(l.json.total_minor, 625);
  const nonCashOver = await pay(ID.o2, T.c1, [{ method_id: ID.card, amount_minor: 300, tendered_minor: 400 }, { method_id: ID.cash, amount_minor: 325 }]);
  assert.equal(nonCashOver.json.error, 'non_cash_cannot_overpay');
  const ok = await pay(ID.o2, T.c1, [{ method_id: ID.card, amount_minor: 300 }, { method_id: ID.cash, amount_minor: 325 }]);
  assert.equal(ok.json.receipt_no, 'MAIN-2');
});

test('each register has its own receipt sequence', async () => {
  const s = await api('/sessions/open', { method: 'POST', token: T.c2, body: { register_id: ID.bar, opening_cash_minor: 0 } });
  ID.s2 = s.json.id;
  const o = (await api('/orders', { method: 'POST', token: T.c2, body: { session_id: ID.s2 } })).json.id;
  await api(`/orders/${o}/lines`, { method: 'POST', token: T.c2, body: { product_id: ID.coffee, qty: 1 } });
  assert.equal((await pay(o, T.c2, [{ method_id: ID.cash, amount_minor: 288 }])).json.receipt_no, 'BAR-1');   // 250 + 38 (37.5 rounds up)
});

test('paid orders are immutable: no new lines, no SQL edits, no deletes', async () => {
  assert.equal((await api(`/orders/${ID.o1}/lines`, { method: 'POST', token: T.c1, body: { product_id: ID.coffee, qty: 1 } })).status, 409);
  await assert.rejects(db.query('update pos_order set total_minor=1 where id=$1', [ID.o1]), /cannot change/);
  await assert.rejects(db.query('delete from pos_order where id=$1', [ID.o1]), /cannot be deleted/);
  await assert.rejects(db.query('update pos_payment set amount_minor=1 where order_id=$1', [ID.o1]), /append-only/);
  await assert.rejects(db.query('delete from pos_payment where order_id=$1', [ID.o1]), /append-only/);
  await assert.rejects(db.query('delete from pos_order_line where order_id=$1', [ID.o1]), /cannot change/);
});

test('refund needs approval, reverses the payments, and reduces expected cash', async () => {
  const body = { reason: 'Customer returned item', session_id: ID.s1 };
  assert.equal((await api(`/orders/${ID.o1}/refund`, { method: 'POST', token: T.c1, body })).status, 403);
  const r = await api(`/orders/${ID.o1}/refund`, { method: 'POST', token: T.owner, body });
  assert.equal(r.status, 200); assert.equal(r.json.state, 'refunded');
  assert.deepEqual(r.json.payments.map((p: { amount_minor: number }) => p.amount_minor), [575, -575]);
  assert.equal((await api(`/orders/${ID.o1}/refund`, { method: 'POST', token: T.owner, body })).status, 409);   // not refunded twice
  assert.equal((await db.query("select count(*)::int n from pos_order_adjustment where order_id=$1 and kind='refund'", [ID.o1])).rows[0].n, 1);
});

test('close: open orders block it; expected cash = opening + cash in - cash refunded', async () => {
  const open = (await api('/orders', { method: 'POST', token: T.c1, body: { session_id: ID.s1 } })).json.id;
  assert.equal((await api(`/sessions/${ID.s1}/close`, { method: 'POST', token: T.c1, body: { counted_cash_minor: 10325 } })).json.error, 'open_orders_exist');
  await api(`/orders/${open}/cancel`, { method: 'POST', token: T.c1, body: { reason: 'Customer left' } });
  assert.equal((await api(`/sessions/${ID.s1}/close`, { method: 'POST', token: T.c2, body: { counted_cash_minor: 1 } })).status, 403);   // not their session
  const c = await api(`/sessions/${ID.s1}/close`, { method: 'POST', token: T.c1, body: { counted_cash_minor: 10300 } });
  assert.equal(c.status, 200);
  assert.equal(c.json.session.expected_cash_minor, 10325);       // 10000 + 575 + 325 - 575
  assert.equal(c.json.session.difference_minor, -25);
  assert.equal(c.json.session.state, 'closed');
  assert.equal((await api('/sessions/open', { method: 'POST', token: T.c1, body: { register_id: ID.main, opening_cash_minor: 0 } })).status, 201);   // register is free again
});

test('every sale, refund and close is in the audit log and outbox', async () => {
  const ev = (await db.query("select event, count(*)::int n from outbox where event like 'pos.%' group by event")).rows;
  const get = (e: string) => ev.find((x) => x.event === e)?.n ?? 0;
  assert.equal(get('pos.order.paid'), 3); assert.equal(get('pos.order.refunded'), 1); assert.equal(get('pos.session.closed'), 1);
  const au = (await db.query("select count(*)::int n from audit_log where action in ('pos.order_paid','pos.order_refunded','pos.session_closed','pos.order_cancelled')")).rows[0].n;
  assert.equal(au, 6);
});
