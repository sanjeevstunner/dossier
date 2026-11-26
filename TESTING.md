# Testing

Four kinds of test. Details of the design live in [DEVELOPMENT.md](DEVELOPMENT.md#tests-and-checks).

| Kind | Files | Runs in | Needs |
|---|---|---|---|
| Node | `src/**/*.test.ts`, `prisma/**/*.test.ts` | Node | nothing |
| DOM | `src/**/*.test.tsx` | jsdom + Testing Library | nothing |
| Database | `*.db.test.ts` | Node, real Postgres | `TEST_DATABASE_URL` (or `DATABASE_URL`) |
| End-to-end | `e2e/*.spec.ts` | Playwright, headless Chromium | Postgres + a production build |
| Live (optional) | `*.live.test.ts` | Node | Real AI / job services; skipped by default |

Put tests next to the code they cover. Run commands with `yarn …` on the host, or `docker/bin/yarn …` inside the app container.

## Quick start

```sh
# 1. Throwaway Postgres on localhost:5433 (in RAM, nothing persists)
docker compose -f compose.test.yml up -d --wait

# 2. Point the database and e2e tests at it
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/dossier_test
export E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/dossier_e2e

# 3. Run
yarn test

# 4. Clean up
docker compose -f compose.test.yml down
```

Vitest doesn't load `.env`, so without `TEST_DATABASE_URL` or `DATABASE_URL` the database project fails with
`Database tests need DATABASE_URL or TEST_DATABASE_URL`. If you set only `DATABASE_URL`, the tests use the same
database with `_test` added to its name (`dossier` → `dossier_test`).

## Unit, DOM and database tests (Vitest)

```sh
yarn test              # everything once (node + db + dom projects)
yarn test:watch        # re-run on change
yarn test:coverage     # once, with coverage; report in coverage/index.html

yarn vitest run --project node   # only one project: node | db | dom
yarn vitest run src/lib/foo.test.ts          # one file
yarn vitest run -t "part of a test name"     # by name
```

- **Node / DOM** tests need no setup. Use a project filter to run them without a database.
- **Database** tests run one file at a time against a real Postgres. At the start of each run the database is created and migrated (`prisma migrate deploy`). Each test empties it with `resetDatabase()` from `src/test/db.ts`. They refuse any database whose name doesn't end in `_test`, so development data is safe.
- **Coverage thresholds** (`vitest.config.mts`) ratchet: CI fails if coverage drops below them. Raise them when you add tests. Coverage runs all projects, so it needs the database too.

## End-to-end tests (Playwright)

Runs the production build, so build first:

```sh
yarn build && yarn test:e2e

yarn test:e2e e2e/dashboard.spec.ts   # one spec
yarn test:e2e --headed                # watch the browser
yarn test:e2e --ui                    # Playwright UI mode
```

- Needs `DATABASE_URL` or `E2E_DATABASE_URL`. The database must end in `_e2e` (`dossier` → `dossier_e2e`); it's created, migrated and reset to demo data by the run.
- Starts its own app on port 3100 and fakes on ports 3999 (AI), 3998 (job sources) and 3997 (Google). Free those ports first. Your dev server and data aren't touched.
- First time only: `yarn playwright install chromium`.
- Failures keep a trace (`test-results/`); open one with `yarn playwright show-trace <trace.zip>`. In CI the HTML report is uploaded as an artifact.
- `e2e/accessibility.spec.ts` runs axe on every screen (no serious or critical WCAG 2.2 AA violations).

## Live tests (optional)

Skipped unless enabled. They call real services; some spend your plan's quota.

```sh
# AI providers and prompts: AI_LIVE=ollama | mistral | lmstudio
AI_LIVE=ollama yarn vitest run src/lib/ai/providers.live.test.ts src/lib/ai/tasks/tasks.live.test.ts

# Job sources: JOBS_LIVE=jsearch | adzuna | arbeitsagentur (the last is free)
JOBS_LIVE=arbeitsagentur yarn vitest run src/lib/job-search/sources.live.test.ts
JOBS_LIVE=jsearch JSEARCH_TEST_KEY=… yarn vitest run src/lib/job-search/jsearch.live.test.ts
JOBS_LIVE=adzuna ADZUNA_TEST_APP_ID=… ADZUNA_TEST_KEY=… yarn vitest run src/lib/job-search/sources.live.test.ts
```

Keys and model overrides (`DOSSIER_AI_KEY`, `DOSSIER_AI_MODEL`, `DOSSIER_AI_URL`) are covered in DEVELOPMENT.md. Inside Docker, prefix with `docker compose exec -e VAR=… app`.

## Other checks

```sh
yarn lint
yarn typecheck
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck and `test:coverage` (with a Postgres service) on every pull request and push to `main`, and e2e in a separate job.
