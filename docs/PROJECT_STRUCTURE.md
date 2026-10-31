Brightloop/
├── database/            SHARED  (already on main)
├── docs/                PROJECT_STRUCTURE.md, team plan
├── backend/             Node + Express, port 4000
│   ├── scripts/         reset-db.js (Sachin), seed-demo.js 5k rows (Merryl)
│   └── src/
│       ├── server.js, app.js, config.js, db/, middleware/   SACHIN
│       ├── utils/       pagination (Sachin) · money, dates, sequence (Swathy)
│       └── modules/
│           ├── auth, users, customers, portal               SACHIN
│           ├── catalog/ products, taxes, payment-terms,
│           │   plans, templates, discounts,
│           │   catalog.service.js  <- functions for Swathy  ROSHAN
│           ├── subscriptions, invoices, billing             SWATHY
│           └── payments, reports                            MERRYL
└── frontend/            React + Vite, port 5173
    └── src/
        ├── App, routes, api/client, AuthContext             SACHIN
        ├── components/layout + ui/, styles/theme.css        MERRYL
        └── pages/ auth, admin, customers, portal (Sachin) · catalog (Roshan)
                   subscriptions, invoices (Swathy) · payments, reports (Merryl)
