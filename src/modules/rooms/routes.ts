import { Router } from 'express';
import { audit } from '../../audit.js';
import { requireAuth, requirePermission } from '../../auth.js';

export const routes = Router();

const TYPES = ['single', 'double', 'suite'];
const STATUSES = ['available', 'occupied', 'cleaning', 'maintenance'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

routes.get('/', requireAuth, requirePermission('rooms.view'), async (req, res, next) => {
  try {
    const { rows } = await req.db!.query('select * from room order by number');
    res.json(rows);
  } catch (e) { next(e); }
});

routes.post('/', requireAuth, requirePermission('rooms.manage'), async (req, res, next) => {
  try {
    const { number, type, rate_cents } = req.body ?? {};
    if (typeof number !== 'string' || !number.trim())
      return res.status(400).json({ error: 'number_required' });
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'invalid_type' });
    if (!Number.isInteger(rate_cents) || rate_cents < 0)
      return res.status(400).json({ error: 'rate_cents_must_be_non_negative_integer' });
    try {
      const { rows } = await req.db!.query(
        'insert into room (number, type, rate_cents) values ($1,$2,$3) returning *',
        [number.trim(), type, rate_cents]);
      await audit(req.db!, { actorId: req.user!.id, action: 'room.created', entity: 'room',
        entityId: rows[0].id, data: { number: rows[0].number, type, rate_cents } });
      res.status(201).json(rows[0]);
    } catch (e: any) {
      if (e.code === '23505') return res.status(409).json({ error: 'room_number_exists' });
      throw e;
    }
  } catch (e) { next(e); }
});

routes.patch('/:id/status', requireAuth, requirePermission('rooms.manage'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const { status } = req.body ?? {};
    if (!UUID.test(id)) return res.status(400).json({ error: 'invalid_id' });
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_status' });
    const { rows } = await req.db!.query(
      'update room set status=$2 where id=$1 returning *', [id, status]);
    if (!rows[0]) return res.status(404).json({ error: 'room_not_found' });
    await audit(req.db!, { actorId: req.user!.id, action: 'room.status_changed', entity: 'room',
      entityId: id, data: { status } });
    res.json(rows[0]);
  } catch (e) { next(e); }
});
