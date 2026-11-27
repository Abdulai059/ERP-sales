# Kernel ERP (working name) — early preview, not for production

Modular business system for hotels, restaurants and shops. One database per business; apps are modules.

## Quick start
```bash
docker compose up -d                 # PostgreSQL
cp .env.example .env                 # set JWT_SECRET
npm install
npm test
npm run kernel -- create-business hotel-d --name "Hotel D" --type hotel
npm run kernel -- create-user --business hotel-d --email owner@example.com --name Owner --password 'a-long-password' --role owner
npm start
```
Try it (dev mode uses the `x-business` header; production uses `<slug>.BASE_DOMAIN`):
```bash
curl -s localhost:3000/api/v1/core_base/auth/login -H 'x-business: hotel-d' -H 'content-type: application/json' \
  -d '{"email":"owner@example.com","password":"a-long-password"}'
curl -s localhost:3000/api/v1/core_base/me -H 'x-business: hotel-d' -H "authorization: Bearer <token>"
```

## What exists
- Control database + one database per business, resolved per request (`src/tenancy.ts`, `src/db.ts`)
- Module loader: manifests, dependency order, cycle/missing detection, per-business install, numbered SQL migrations (`src/loader.ts`, `src/migrations.ts`)
- `core_base` module: users, roles, permissions, append-only audit log, outbox, sequences, login (argon2 + JWT)
- Outbox events with retries and a failed-event list (`src/events.ts`, `src/worker.ts`)
- CLI: create-business, install, modules, upgrade, create-user

## Next
`product`, `core_contacts`, then `pos_core`. See docs.



docker compose up -d                 
cp .env.example .env                 
npm install