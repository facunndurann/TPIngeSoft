# Deploy the platform (Supabase + Vercel)

This is a first-time guide. You do **not** need a Supabase account yet. Follow the parts in order. After the first deploy, skip to [Part 7 — Pushing updates](#part-7--pushing-updates).

Local development (`pnpm supabase start`) stays on your machine. Cloud deploy is a **separate** environment: a hosted database + three public websites.

---

## What you are deploying

This repo is **not** a single website. It is four hosted pieces:

```
Phones / browsers
        │
        ├── apps/customer  ──►  Vercel site A   (QR links, e.g. https://mesa.vercel.app/m/...)
        ├── apps/admin     ──►  Vercel site B   (administration)
        └── apps/pos       ──►  Vercel site C   (employee operations)
                    │
                    └── all talk to ──►  Supabase Cloud
                                            ├── Postgres + RLS
                                            ├── Auth (admins + global employee accounts + anonymous diners)
                                            ├── Realtime
                                            ├── Storage (product photos)
                                            └── Edge Functions: submit-order, employee-accounts, mobile-payment
```

| Piece | Who hosts it | Why |
|-------|----------------|-----|
| Database, Auth, Realtime, Storage, Edge Functions | **Supabase** (free plan is enough for a demo) | This is the backend. The plan chose Supabase over Firebase. Functions: `submit-order`, `employee-accounts`, `mobile-payment`. |
| App del comensal (`apps/customer`) | **Vercel** (static Vite build) | Supabase does not host React apps. QR codes must point at a public HTTPS URL. |
| Panel (`apps/admin`) | **Vercel** (second project) | Administrative accounts only. |
| POS (`apps/pos`) | **Vercel** (third project, same repo) | Employee login, independent deployment and Auth storage. |

You will **not** deploy Docker, and you will **not** run `seed.sql` in the cloud. Demo users (`admin@esquina.demo`) exist only in local Docker. In the cloud you register a real account and create the restaurant from the admin onboarding screen.

El pago electrónico usa un simulador controlado para la demo. No procesa dinero real ni requiere una cuenta de Mercado Pago.

---

## Accounts and tools you need

Create them in this order. All three have a free plan.

1. **GitHub** — the code already lives at the repo remote (`origin`). You need access to that repo so Vercel can pull it.
2. **Supabase** — [https://supabase.com](https://supabase.com) → *Start your project*.
3. **Vercel** — [https://vercel.com](https://vercel.com) → sign up **with GitHub** (so it can see the repo).

On your laptop you already have the repo. You still need:

- Node 22+ and pnpm 10+ (same as local setup)
- The CLI that ships with the monorepo (`pnpm supabase ...`) — no extra global install
- Docker is **not** required for cloud deploy

Keep a notes file. You will copy:

- Project ref (looks like `abcdefghijklmnop`)
- Project URL (`https://<ref>.supabase.co`)
- `anon` / publishable key (public, goes in the frontend)
- Database password (private — you choose it when creating the project)
- Customer site URL (after Vercel)
- Admin site URL (after Vercel)
- POS site URL (after Vercel)
- `EMPLOYEE_EMAIL_DOMAIN` (must match `VITE_EMPLOYEE_EMAIL_DOMAIN` on the POS project)

Never put the **service_role** key in a frontend `.env`, in Vercel, or in git. RLS is what protects the data; the anon key is meant to be public. Supabase injects `SUPABASE_SERVICE_ROLE_KEY` only into Edge Functions.

---

## Part 1 — Create a Supabase account and project

1. Open [https://supabase.com](https://supabase.com) and click **Start your project**.
2. Sign up with GitHub (simplest) or email.
3. Create an **Organization** if prompted (any name, e.g. `HCI` or your team name).
4. Click **New project** and fill:

   | Field | What to put |
   |-------|-------------|
   | Name | e.g. `restaurant-platform` |
   | Database password | Generate a strong one and **save it**. `db push` will ask for it. You cannot see it again. |
   | Region | Closest to Argentina: **South America (São Paulo)** if listed, otherwise the default. |
   | Plan | **Free** |

5. Wait until the project is **Active** (1–2 minutes). You land on the project dashboard.

6. Copy the **project ref** from the URL:

   `https://supabase.com/dashboard/project/abcdefghijklmnop`

   The `abcdefghijklmnop` part is the ref.

7. Open **Project Settings → Data API** (older dashboards: **Settings → API**). Copy:

   - **Project URL** → `https://<ref>.supabase.co` — this host only, **without** `/rest/v1`
   - **anon public** / **publishable** key → long JWT starting with `eyJ...`

   Do **not** paste the Data API / REST URL (`https://<ref>.supabase.co/rest/v1`) into `VITE_SUPABASE_URL`. The JS client appends `/auth/v1` and `/rest/v1` itself. A REST base sends login to PostgREST (`PGRST125`: *Invalid path specified in request URL*).

   Do **not** copy **service_role** anywhere. The Edge runtime injects it into `employee-accounts` and `mobile-payment`; you never paste it into Vercel or a frontend `.env`.

Free-plan notes: 2 projects max, ~500 MB database, the project **pauses after 7 days of inactivity**. Unpause from the dashboard if a demo goes stale.

---

## Part 2 — Log the CLI in and link this repo

In a terminal, from the **repo root** (`.../HCI/TP`):

```bash
pnpm supabase login
```

A browser window opens. Approve access. The CLI stores a token on your machine (not in git).

Then link this folder to the cloud project:

```bash
pnpm supabase link --project-ref <paste-the-ref>
```

Current CLI versions often **do not** ask for the database password here. That is normal: `login` already gave the CLI an access token, which is enough to attach this folder to the project. Keep the password anyway — `pnpm supabase db push` (Part 3) may still ask for it when it opens a Postgres connection.

After a successful link, `supabase/.temp/` (gitignored) stores the project ref. If the command printed something like “Finished supabase link” (or just returned with no error), you are linked.

Check:

```bash
pnpm supabase projects list
```

You should see your project. `pnpm supabase status` is only for **local** Docker; it will fail if local is not running. That is expected.

---

## Part 3 — Push the database schema

This applies every file in `supabase/migrations/` to the cloud Postgres (tables, RLS, RPCs, Realtime publication, Storage bucket `product-images`).

```bash
pnpm supabase db push
```

Confirm when asked. Apply all pending migrations in timestamp order, including the employee roles, accounts, operations, provisioning and read-scope migrations. Preserve the existing database and historical audit.

Optional check: dashboard → **Table Editor**. You should see `restaurants`, `branches`, `tables`, `products`, `orders`, etc.

Do **not** run `pnpm supabase db reset` against the cloud (that wipes data). Do **not** run `seed.sql` in the cloud (it inserts fake `auth.users` rows meant only for local Docker).

---

## Part 4 — Deploy the Edge Functions

The three functions live under `supabase/functions/`. Browsers never write orders, create Auth employees, or confirm payments directly: each app calls the matching function with the user's JWT.

| Function | Called by | What it does |
|----------|-----------|----------------|
| `submit-order` | Customer (`apps/customer`) | Validates the diner JWT and runs `submit_order` (menu snapshot, persistence, internal POS accept) in one transaction. |
| `employee-accounts` | Admin (`apps/admin`) | Creates / updates employee Auth users and memberships. Uses the Auth Admin API (`service_role`) **after** authorizing the caller. |
| `mobile-payment` | Customer (`apps/customer`) | Creates a pending mobile payment as the diner. With the sandbox flag on, also resolves approve/reject for the demo. |

Set secrets **before** the first deploy of the functions that read them:

```bash
pnpm supabase secrets set EMPLOYEE_EMAIL_DOMAIN=employees.your-controlled-domain.com
pnpm supabase secrets set PAYMENT_SANDBOX_ENABLED=true
```

Use a **controlled subdomain you own**, with no real mailboxes. The POS env var `VITE_EMPLOYEE_EMAIL_DOMAIN` must be **exactly** the same string. `PAYMENT_SANDBOX_ENABLED=true` is for the academic demo only; turn it off before wiring a real provider (create still works; confirm then returns `PAYMENT_PROVIDER_UNAVAILABLE` until a webhook replaces the simulator).

Then deploy all three:

```bash
pnpm supabase functions deploy submit-order
pnpm supabase functions deploy employee-accounts
pnpm supabase functions deploy mobile-payment
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the Edge runtime. Do **not** copy them to Vercel or any frontend `.env`. Only `employee-accounts` and `mobile-payment` use `service_role` (Auth Admin and sandbox payment resolve). `submit-order` talks to Postgres with the diner JWT.

JWT at the gateway (`supabase/config.toml`):

| Function | `verify_jwt` | Why |
|----------|--------------|-----|
| `submit-order` | `true` | Gateway rejects calls without a valid JWT before the handler. |
| `mobile-payment` | `true` | Same; the handler then requires an **anonymous** diner. |
| `employee-accounts` | `false` | The handler calls `Auth.getUser` itself (needed for signing-key projects). Unauthenticated calls still get `401`. |

Confirm: dashboard → **Edge Functions** → all three names listed. Dashboard → **Edge Functions → Secrets** (or `pnpm supabase secrets list`) → `EMPLOYEE_EMAIL_DOMAIN` and `PAYMENT_SANDBOX_ENABLED`.

---

## Part 5 — Auth settings (required or the apps look “broken”)

Local Docker already has these in `config.toml`. Cloud projects do **not**. Change them in the dashboard.

### 5.1 Allow anonymous diners (QR flow)

The customer app signs in anonymously when someone scans a table QR. Without this, `/m/<token>` fails.

1. **Authentication → Sign In / Providers** (or **Sign In / Up**)
2. Enable **Allow anonymous sign-ins**

### 5.2 Turn off “Confirm email” for this academic demo

Cloud default is often **Confirm email = on**. The admin `LoginPage` signs up and then expects an immediate session. If confirmation is required, signup appears to succeed but you stay on `/login` with no session.

1. **Authentication → Providers → Email**
2. Disable **Confirm email**

Use a real inbox only if you later turn confirmation back on. Shared Supabase SMTP on the free plan is also rate-limited, so confirmation emails often never arrive during a classroom demo.

### 5.3 Site URL and redirects

Do this **after** you have the two Vercel URLs (Part 6). Until then you can leave the defaults.

Then set:

| Setting | Value |
|---------|--------|
| **Site URL** | Admin production URL, e.g. `https://admin-xxx.vercel.app` |
| **Redirect URLs** | Admin URL, customer URL, and `http://localhost:5173/**`, `http://localhost:5174/**` if you still develop locally against cloud |

Path: **Authentication → URL Configuration**.

---

## Part 6 — Host the two frontends on Vercel

Vite bakes `VITE_*` variables **at build time**. If you change a URL later, you must **redeploy**, not only edit the dashboard.

Each app is its own Vercel project, both pointing at the **same GitHub repository**.

### 6.1 Commit the SPA rewrite files (if not already on `main`)

`apps/customer/vercel.json` and `apps/admin/vercel.json` rewrite unknown paths to `index.html`. Without that, opening a QR link like `/m/abc123` returns 404 on refresh.

Commit and push those files (and this doc) before the first Vercel import if they are not on the remote yet.

### 6.2 Deploy the customer app first

You need its public URL before building the admin app (QR codes use `VITE_CUSTOMER_APP_URL`).

1. Go to [https://vercel.com](https://vercel.com) and log in with GitHub.
2. **Add New… → Project** → import the GitHub repo.
3. Configure:

   | Setting | Value |
   |---------|--------|
   | Project name | e.g. `restaurant-customer` |
   | Framework Preset | **Vite** |
   | Root Directory | `apps/customer` (click Edit) |
   | Include files outside Root Directory | **On** (needed for `packages/shared`) |
   | Build Command | `pnpm build` (default inside that app is fine) |
   | Output Directory | `dist` |
   | Node.js Version | **22.x** (Settings → General, if the import screen does not show it) |

4. **Environment Variables** (Production + Preview):

   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```

5. Deploy. Copy the URL, e.g. `https://restaurant-customer.vercel.app`.

Open it: you should see the landing (“Escaneá el QR…”). There is no restaurant until you create tables in admin.

### 6.3 Deploy the admin app

1. **Add New… → Project** again, **same repo**.
2. Configure:

   | Setting | Value |
   |---------|--------|
   | Project name | e.g. `restaurant-admin` |
   | Framework Preset | **Vite** |
   | Root Directory | `apps/admin` |
   | Include files outside Root Directory | **On** |
   | Output Directory | `dist` |
   | Node.js Version | **22.x** |

3. Environment variables:

   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   VITE_CUSTOMER_APP_URL=https://restaurant-customer.vercel.app
   ```

   Use the **customer** URL from 6.2, **no trailing slash**.

4. Deploy. Copy the admin URL, e.g. `https://restaurant-admin.vercel.app`.

5. Go back to Supabase and finish [5.3](#53-site-url-and-redirects).

### 6.4 First restaurant (cloud has no seed)

1. Open the **admin** URL → **¿No tenés cuenta? Registrate** with a real email and password (min 8 characters, as the form requires).
2. Complete **Creá tu restaurante** (name, optional description, branch).
3. **Productos / Categorías / Modificadores**: load a small menu (photos go to the `product-images` bucket created by the migration).
4. **Mesas**: create a table. Open/copy/print the QR. The link must look like:

   `https://<customer-host>/m/<qr_token>`

5. On a phone (or a private window), open that URL. You should see the menu with **no login form**.
6. Add something to the cart → **Confirmar y enviar**.
7. On admin → **POS**: the ticket should appear in Realtime. Advance **Preparar → Listo → Entregar**. Close the session from **Mesas activas** if you want.

If signup “does nothing”, Confirm email is still on (Part 5.2). If the diner page errors on join, anonymous sign-ins are still off (Part 5.1). If submit, employee create/reset, or mobile pay fails with a functions error, Part 4 was skipped or that function was not deployed.

---

## Part 7 — Pushing updates

There are **three** kinds of change. A git push only updates the frontends.

### A. Frontend only (UI, React, Tailwind)

```bash
git add ...
git commit -m "..."
git push origin main
```

Vercel rebuilds the three projects. A shared-code change can rebuild customer, admin and POS.

If you changed a `VITE_*` value in the Vercel dashboard, click **Redeploy** on that project. A new git commit is not enough if only env vars changed.

### B. Database schema (new file in `supabase/migrations/`)

1. Develop against **local** Docker first:

   ```bash
   pnpm supabase start          # if not running
   pnpm supabase migration up --local
   pnpm db:types                # refresh packages/shared/src/database.types.ts
   ```

2. Commit the new `.sql` (and generated types if they changed).
3. Push schema to cloud:

   ```bash
   pnpm supabase db push
   ```

4. `git push` so Vercel ships any TypeScript that depends on the new columns.

Never edit tables only in the cloud dashboard if you also use migrations — the next `db push` can disagree with Studio clicks. Change schema in SQL files.

### C. Edge Functions (`supabase/functions/<name>` or `_shared`)

Redeploy **each function whose code changed**. Vercel does not host these. A frontend-only `git push` will not update them.

```bash
pnpm supabase functions deploy submit-order
pnpm supabase functions deploy employee-accounts
pnpm supabase functions deploy mobile-payment
git add ... && git commit && git push   # keep GitHub in sync
```

- Changing `_shared/` (used by `submit-order`) → redeploy `submit-order`.
- Changing `packages/shared` schemas imported by a function → redeploy that function.
- Changing `EMPLOYEE_EMAIL_DOMAIN` or `PAYMENT_SANDBOX_ENABLED` → `pnpm supabase secrets set …` and **redeploy** the function that reads the secret (`employee-accounts` / `mobile-payment`).

### Typical “I shipped a feature” checklist

1. Works on local Docker (`pnpm supabase start`, `pnpm dev:admin`, `pnpm dev:customer`, `pnpm dev:functions`).
2. Commit + `git push` → Vercel.
3. If migrations changed → `pnpm supabase db push`.
4. If functions changed → deploy every changed name from Part 4 (`submit-order`, `employee-accounts`, `mobile-payment`).
5. Smoke-test the **production** admin URL (including Empleados if that function changed), a real QR on the **production** customer URL, and POS login if `EMPLOYEE_EMAIL_DOMAIN` changed.

---

## Local vs cloud at a glance

| | Local | Cloud |
|--|--------|--------|
| Backend | Docker via `pnpm supabase start` | This Supabase project |
| Apps | `localhost:5173` / `5174` / `5175` | Three Vercel URLs |
| `.env` | `apps/*/.env` (gitignored) | Vercel Environment Variables |
| Demo users | `admin@esquina.demo` / `demo1234` from `seed.sql` | Register yourself |
| Demo QR | `/m/demo-burger-mesa-1` | Tokens you create under **Mesas** |
| Anonymous auth | On (`config.toml`) | You enable it in the dashboard |
| Email confirm | Off | You turn it off for the demo |
| Edge Functions | `pnpm dev:functions` (all three, via `.env.example`) | `functions deploy` per name (Part 4) |

You can point **local** Vite apps at the **cloud** project by putting the cloud URL/anon key in `apps/admin/.env` and `apps/customer/.env`. Restart Vite after editing. Keep `VITE_CUSTOMER_APP_URL=http://localhost:5173` while testing QRs on your machine.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Admin: “Faltan las variables VITE_SUPABASE_…” | Env vars missing on that Vercel project, or added after the last build → Redeploy. |
| POS login: “usuario o contraseña incorrectos” but Network shows `PGRST125` / `…/rest/v1/auth/v1/token` | `VITE_SUPABASE_URL` on the POS Vercel project is the Data API URL. Set it to `https://<ref>.supabase.co` and **Redeploy**. |
| Signup succeeds but you never enter the app | **Confirm email** still enabled. |
| Diner QR: cannot join session / auth error | Anonymous sign-ins off. |
| Direct QR URL is 404, home page works | `vercel.json` rewrite missing or not on the branch Vercel built. |
| QR opens localhost | Admin was built with `VITE_CUSTOMER_APP_URL=http://localhost:5173`. Set the customer Vercel URL and redeploy **admin**. |
| Order confirm fails, menu works | `submit-order` not deployed, or JWT verification failed (anon auth). |
| Admin: create / update / reset employee fails | `employee-accounts` not deployed, or `EMPLOYEE_EMAIL_DOMAIN` missing. Check Edge Function logs. |
| POS login works locally but not in cloud with the same username | `VITE_EMPLOYEE_EMAIL_DOMAIN` on the POS Vercel project does not match `EMPLOYEE_EMAIL_DOMAIN`. |
| Customer: pay from phone create works, approve/reject fails | `mobile-payment` not deployed, or `PAYMENT_SANDBOX_ENABLED` is not `true`. |
| Photos do not upload | Migration not pushed (bucket `product-images` missing). Check **Storage** in the dashboard. |
| POS does not update live | Realtime publication missing (migration 1). Dashboard → **Database → Publications** / **Realtime**. |
| `db push` asks for password | Use the database password from project creation. Reset it under **Project Settings → Database** if lost. |
| `link` / `login` fails | Run from repo root; complete the browser login. |
| Free project “unavailable” | Paused after inactivity → **Restore** on the project home. |
| Vercel cannot resolve `@restaurant-platform/shared` | Root Directory wrong, or “include files outside root” off. Root must be `apps/customer` or `apps/admin`. |
| Build uses npm and dies on `workspace:*` | Vercel did not detect pnpm. Confirm `pnpm-lock.yaml` is in the repo and Framework/Install uses pnpm. |

---

## What we are not deploying yet

- **Phase 6** `recommend` (LLM) — not in the repo.
- A **real** Mercado Pago (or other) provider and webhooks — not in the repo. The demo uses `mobile-payment` with `PAYMENT_SANDBOX_ENABLED=true`.
- Custom domains — optional later in Vercel (Domains) and then update `VITE_CUSTOMER_APP_URL` + Auth Site URL + redeploy admin.
- Running `seed.sql` in production — do not.

## Independent POS deployment

Create a third Vercel project with root directory `apps/pos`, build `pnpm build`, output `dist`. Its `vercel.json` handles SPA routes. Configure:

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: the same **Project URL** (`https://<ref>.supabase.co`, no `/rest/v1`) and anon/publishable key as admin.
- `VITE_EMPLOYEE_EMAIL_DOMAIN`: exactly the backend's `EMPLOYEE_EMAIL_DOMAIN`.

Use a controlled subdomain for internal Auth identifiers. The backend uses confirmed Auth creation and administrative password resets. Before rollout, confirm that SMTP and password-change notifications do not deliver mail to internal employee addresses; POS has no email recovery flow. No service key belongs in any frontend.

Create employee accounts from admin and assign roles/branches before switching operators to the new POS domain. Legacy PIN endpoints are retired by the migrations; preserve legacy records and audit. The admin session cannot operate POS. See [rollout and permission matrix](pos-accounts.md).
