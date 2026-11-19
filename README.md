# CSPC Feedback & Suggestion System

A School Feedback/Suggestion System built for **Camarines Sur Polytechnic Colleges (CSPC)**.

Stack: **Node.js + Express + EJS + SQLite (better-sqlite3)**, styled with a **glassmorphism** UI (sharp corners, max 2px border-radius) and **jQuery / jQuery UI** for interactivity.

## Features

**Public**
- Submit feedback, suggestions, complaints, or commendations
- Optional anonymous submission
- Category, college/department, and 1–5 star rating
- Track submission status anytime using a generated ticket number (e.g. `CSPC-2026-0001`)
- Admin responses/notes are visible on the tracking page

**Admin panel** (`/admin/login`)
- Secure login (bcrypt-hashed password, session-based auth)
- Dashboard with totals, status breakdown, average rating, and bar charts by category/college
- Full feedback list with search + filters (status, category, type)
- Detail view: update status (Pending → In Review → Resolved → Closed), add response notes, delete entries
- jQuery UI dialog for delete confirmation

## Getting Started

```bash
npm install
npm start
```

The app runs at **http://localhost:3000**.

On first run, the SQLite database (`database/cspc_feedback.db`) is created automatically and seeded with a default admin account:

```
Username: admin
Password: cspc-admin2026
```

**Change this password** (or edit `database/db.js` seed logic / add a user-management screen) before deploying publicly.

## Project Structure

```
cspc-feedback-system/
├── server.js              # Express app & all routes
├── database/
│   └── db.js               # SQLite schema, seed admin, ticket number generator
├── views/                  # EJS templates
│   ├── index.ejs            # Public feedback form
│   ├── track.ejs            # Ticket status tracker
│   ├── success.ejs
│   ├── admin/                # Admin login, dashboard, list, detail views
│   └── partials/             # Shared head/header/footer/flash/admin-nav
├── public/
│   ├── css/style.css        # Glassmorphism theme (2px max radius)
│   └── js/main.js           # jQuery / jQuery UI interactions
└── package.json
```

## Configuration

Environment variables (optional, via `.env`):
- `PORT` — server port (default `3000`)
- `SESSION_SECRET` — session signing secret (set a strong random value in production)
- `PUBLIC_URL` / `ADMIN_URL` — enable split portals (see below)
- `NODE_ENV` — set to `production` when deployed

## Notes

- `better-sqlite3` is a native module — if `npm install` fails to fetch a prebuilt binary for your OS/architecture, make sure you have build tools installed (`build-essential` on Linux, Xcode CLI tools on macOS, or `windows-build-tools` on Windows).
- Session data is stored in `database/sessions.db` (via `connect-sqlite3`), separate from the feedback data.

## Split portals (separate public and admin URLs)

One app and one database can be served on two hostnames:

| Hostname | Who | What it serves |
| --- | --- | --- |
| `feedback.cspc.edu.ph` | Students / public | Submit form, success page, tracking. No login. `/admin/*` returns 404. |
| `admin-feedback.cspc.edu.ph` | Staff only | `/admin/*` only. Sees every submission from the public portal. |

Enable it in `.env`:

```
PUBLIC_URL=https://feedback.cspc.edu.ph
ADMIN_URL=https://admin-feedback.cspc.edu.ph
NODE_ENV=production
```

Then put nginx in front of the Node app (example: `deploy/nginx.conf.example`).
The password-reset email links point to `ADMIN_URL`. With both variables blank
the app runs in single-host mode on `http://localhost:3000` for development.

Hiding the admin URL is not security by itself. Restrict the admin server block
to the campus network / VPN in nginx, keep HTTPS on, and change the default
admin password.

---
## Deployment notes (MySQL version)
- Database: MySQL (`mysql2`). Tables are in `database/schema.sql`; the app also creates them on startup. `npm run db:setup` does it without starting the server.
- Sessions are stored in MySQL (`sessions` table), so redeploying does not log anyone out.
- Required production variables: `NODE_ENV=production`, `SESSION_SECRET`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DEFAULT_ADMIN_PASSWORD` (first run only), `APP_URL`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `FEEDBACK_RECEIVER`. `PORT` comes from the host.
- Build command: `npm install` (or `npm ci`)  |  Start command: `npm start`
- The MySQL pool uses TLS in production and `connectionLimit: 5`.
