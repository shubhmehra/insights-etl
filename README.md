# creator-insights-etl

> A hands-on demo of Temporal.io patterns for reliable ETL — built around a real-world problem: syncing Instagram creator data at scale.

---

## The story behind this

I was building an Instagram analytics platform. Every 15 minutes, a background job fetches posts and insights for each connected creator, transforms the data, and stores it.

Simple enough — until one day a creator with years of content triggered a backfill. The workflow started, processed thousands of posts, and then just... stopped. No error. No alert. Silently dead.

The reason: Temporal records every step a workflow takes. Run enough steps in a single execution and you hit the history limit. The workflow gets terminated. Quietly.

This repo shows that failure — and how to fix it.

---

## What you'll see

Three demos, each teaching one thing:

**1. The failure** — run the naive workflow, watch it die in the Temporal UI with a clear error message. Understand the math behind why it happens.

**2. The fix** — run the correct workflow with `continueAsNew`. Watch it chain executions, carry the cursor forward, and process all 200 posts without breaking a sweat.

**3. The bonus patterns** — a token refresh workflow that sleeps for days without a cron job, and a nightly validation pass that finds and recovers silently missing data.

---

## Get it running

You need Docker and Node.js 20+. That's it.

```bash
# Start everything (Temporal server, database, mock Instagram API)
docker compose up -d

# Install and migrate
cd temporal-service && npm install
cd ../mock-api && npm install
cd ../temporal-service && npm run db:migrate

# Copy the env file
cp .env.example .env

# Start the worker — keep this running in a separate terminal
npm run start:worker
```

Open **[http://localhost:8080](http://localhost:8080)** — this is the Temporal UI. You'll watch workflows run here.

---

## The demos

### 1. Watch the naive workflow fail

```bash
npm run start:naive
```

Go to the Temporal UI and find the workflow. It will fail with:

> *"History limit reached (50 events). In production this happens silently at ~50,000 events."*

That's the problem made visible.

### 2. Run the correct ETL

```bash
npm run start:workflows
```

Watch three workflows run — one per creator. Each one will reach the history threshold and call `continueAsNew`, creating a fresh execution that picks up exactly where it left off. The cursor carries forward. No data lost.

### 3. Query a live workflow's internal state

```bash
npm run query:progress
```

This prints the current cursor and processed count for each running ETL workflow — without touching the database and without stopping the workflow. That's `defineQuery` in action. You can't do this with Bull or a cron job.

### 4. Simulate data loss and recover it

```bash
npm run corrupt:data      # silently deletes 5 random posts
npm run start:validation  # finds them, recovers them, reports back
```

Watch the validation workflow in the Temporal UI. It fetches what the API has, compares it against what's stored, and re-processes anything that's missing.

---

## Running the tests

```bash
# Needs the app database running (docker compose up -d app-db)
cd temporal-service && npm test
```

The workflow tests use `@temporalio/testing` — an in-process Temporal server. No Docker needed for that part. The 55-day token refresh sleep? It completes in milliseconds in tests.

---

## If you want to read the code

Start here, in this order:

| File | What to look for |
|---|---|
| `src/shared/types.ts` | Why `ETLCheckpoint` uses ISO strings instead of `Date` objects |
| `src/workflows/naive.ts` | The broken version — read the math in the comments |
| `src/workflows/creatorInsightsETL.workflow.ts` | The fix — spot the two lines that change everything |
| `src/workflows/tokenRefresh.workflow.ts` | A workflow designed to run forever, tested in milliseconds |
| `src/activities/db.activity.ts` | Why every DB write is an upsert, not an insert |

---

## Why Temporal and not just a cron job?

Honest answer: for simple tasks, a cron job is fine. Temporal earns its complexity when:

- A job needs to resume mid-run after a crash — not restart from scratch
- You want to inspect what a running job is doing right now, without polling the DB
- You need to process an unknown amount of data that could be 100 records or 100,000
- You want a workflow to sleep for weeks and survive server restarts in between

The mock Instagram API in this repo intentionally rate-limits every 3rd request with a 429. Watch the Temporal UI — activities retry automatically, with backoff, and the workflow doesn't even notice.

---

## What the mock API simulates

The fake API mirrors Instagram's Graph API structure closely enough to be realistic.

| Endpoint | What it does |
|---|---|
| `GET /v1/:creatorId/media` | Returns paginated posts with cursor-based pagination |
| `GET /v1/:mediaId/insights` | Returns metrics for a single post |
| `GET /v1/oauth/token/refresh` | Issues a refreshed token |

Every 3rd media request returns a 429. Pass `?simulate_error=token_expired` to get a 401. Both failures are deterministic so the behaviour is the same every time you run it.
