import express, { type NextFunction, type Request, type Response } from 'express';
import { bootstrapControl } from './db.js';
import { discoverModules, type ModuleRegistry } from './loader.js';
import { tenancy } from './tenancy.js';

export async function createApp(): Promise<{ app: express.Express; reg: ModuleRegistry }> {
  await bootstrapControl();
  const reg = await discoverModules();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(tenancy);
  // A module's routes exist for a business only if the module is installed there.
  for (const m of reg.modules.values()) {
    if (!m.routes) continue;
    const router = m.routes;
    api.use(`/${m.name}`, async (req: Request, res: Response, next: NextFunction) => {
      try {
        (await reg.installedNames(req.db!)).has(m.name)
          ? router(req, res, next)
          : res.status(404).json({ error: 'module_not_installed' });
      } catch (e) { next(e); }
    });
  }
  app.use('/api/v1', api);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });
  return { app, reg };
}
