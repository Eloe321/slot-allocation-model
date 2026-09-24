# Contributing

## Setup

Install Node 24.10.0 (`.nvmrc`), pnpm 10.20.0, and Docker with Compose.

```bash
pnpm install --frozen-lockfile
pnpm bootstrap
pnpm dev
```

The API runs on port 4001, the web app on port 3000, and PostgreSQL on port
55432. `pnpm bootstrap` starts PostgreSQL, provisions the separate test
database, applies migrations, and seeds the demo database.

## Before opening a pull request

```bash
pnpm verify
```

This starts PostgreSQL and waits for health, provisions and migrates the test
database, then runs lint, TypeScript checks, engine and PostgreSQL-backed API
tests, and the production API and web builds. It is the same command used by CI.

For a narrower check after setup:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

API integration tests truncate **only** `slot_allocation_test`. Do not point
`TEST_DATABASE_URL` at a database with data you need to keep. Its database name
must end in `_test` for provisioning to accept it.
