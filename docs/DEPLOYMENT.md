# Disposable demo deployment

## Public deployment

The public demo is available at
[slot-allocation-model.pages.dev](https://slot-allocation-model.pages.dev).
The static Next.js frontend is hosted on Cloudflare Pages and the NestJS API is
hosted on Render at `https://slot-allocation-api.onrender.com`.

Cloudflare Pages builds the repository with:

```text
Build command: pnpm --filter @slot/web build
Build output:  apps/web/out
```

Set this Pages environment variable for production (and preview deployments if
you want them to call the public demo API):

```text
NEXT_PUBLIC_API_URL=https://slot-allocation-api.onrender.com
```

Set this Render API environment variable. The value must be the browser origin
without a trailing slash; the API also normalizes a trailing slash defensively.

```text
WEB_ORIGIN=https://slot-allocation-model.pages.dev
```

Render also needs its PostgreSQL `DATABASE_URL`. Its start command runs the
migrations and seeds the database before starting the API, so the public demo is
resettable through the visible seeded-scenario reset action.

The included Compose setup packages the API, web app, and PostgreSQL for a **demo-only** environment. It seeds the six scenarios on an empty database. Custom proposals, their approved sailings, and related bookings survive restarts for up to 24 hours; an hourly cleanup removes them afterward. The API accepts at most 100 stored proposals and 500 active demo sessions at a time. Use `pnpm --filter @slot/api db:seed` only when intentionally wiping the demo database.

```bash
cp .env.example .env
# Edit the password and URLs in .env.
docker compose -f compose.demo.yml up --build -d
```

For a public host, place the web and API behind HTTPS, set `DEMO_PUBLIC_API_URL` to the API's public HTTPS origin, and `DEMO_WEB_ORIGIN` to the web origin. The API URL is baked into the web build, so rebuild after changing it. Compose binds web and API ports to the host loopback address and keeps PostgreSQL private. Set `DEMO_TRUST_PROXY_HOPS=1` only when one trusted reverse proxy overwrites `X-Forwarded-For`; the API uses the resulting client IP for per-visitor throttles (20 role selections per two hours and 5 proposals per day). Apply edge rate limits as well before exposing the demo. Configure `CRM_WEBHOOK_URL` and `CRM_WEBHOOK_SECRET` only for a test CRM receiver chosen for this demo. Do not use real payments, personal data, or customer accounts: the role selector intentionally lets every visitor become an administrator in this disposable demo.

The app includes a visible “Reset current scenario” action for seeded examples. Old custom proposals and their approved sailings are removed automatically. A full reset is `pnpm --filter @slot/api db:seed` inside the API container; it removes custom demo proposals and bookings. Back up anything you want to keep before that command. The live URL is documented in the [README](../README.md); the recording script is in [WALKTHROUGH.md](WALKTHROUGH.md).

Run `pnpm verify` before publishing. The API and web need a long-running Node process and a PostgreSQL database; static hosting alone cannot run the booking lifecycle.
