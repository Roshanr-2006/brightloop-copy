# Brightloop

Subscription Management System: products and plans, subscriptions, recurring invoices, payments and revenue reports in one place.
Built for the **Odoo x Make-A-Ton 9.0 Kochi Hackathon 2026** (virtual round).

**Team:** Sachin (auth, roles, portal) · Roshan (catalog, plans, taxes, discounts) · Swathy (subscriptions, billing, invoices) · Merryl (payments, reports, UI)

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js 22 LTS + Express (REST JSON API, port 4000) |
| Database | SQLite through Node's built-in `node:sqlite`. Runs locally and offline, no DB server |
| Frontend | React 18 + Vite + React Router (port 5173, proxies `/api` to the backend) |
| Auth | bcrypt password hashes, JWT in an httpOnly cookie, role checks on every API route |

## Getting started

Requires **Node.js 22.13 or newer** (`node -v`).

```bash
# 1. backend
cd backend
npm install
cp .env.example .env          # Windows: copy .env.example .env
npm run db:reset              # creates backend/data/brightloop.db + first admin
npm run dev                   # http://localhost:4000/api/health

# 2. frontend (second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

Default admin (from `.env`): `admin@brightloop.test` / `Admin@12345`

## Project structure

```
database/    schema.sql, seed.sql, check-schema.js       (shared)
docs/        PROJECT_STRUCTURE.md, PROJECT_GUIDE.md
backend/src/
  server.js, app.js, config.js, db/, middleware/, utils/
  modules/   auth, users, customers, portal | catalog | subscriptions, invoices, billing | payments, reports
frontend/src/
  api/client.js, context/AuthContext.jsx, routes.jsx, components/, pages/, styles/theme.css
```

See `docs/PROJECT_GUIDE.md` for owners, request/business flows, role access and the shared contracts between modules.

## Conventions

- Lists: `GET /api/<thing>?page=1&limit=20&search=` returns `{ items, total, page, pages, limit }`
- Errors: `{ error: "message", fields: { fieldName: "message" } }` with 400/401/403/404/409/422
- Every module: `<name>.routes.js` -> `<name>.controller.js` -> `<name>.service.js` (+ `<name>.validators.js`)
- Git: `git pull --rebase` before every push, commit only your own module, push at least hourly
