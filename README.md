# pushpress-expansion

PushPress Expansion Intelligence: finds upsell signals in Intercom conversations and posts them to Slack.

## What it does

Make.com sends a webhook for each Intercom conversation event (created or replied). The Node server fetches the conversation and its contact from Intercom, runs a keyword pre-screen, sends the text to a scorer (a Make scenario that calls Claude), and stores the result in SQLite. HIGH and MEDIUM results are posted to a Slack channel. A guardrail skips conversations where the customer already owns the product being asked about. The same logic is available as a CLI for scanning a time window, reviewing and reporting on signals, and managing the scoring prompt. Intended users are the PushPress expansion and RevOps team who review the Slack alerts.

## Status

- Repo is configured for a Replit deployment (`.replit`: `deploymentTarget = "cloudrun"`, port 3000, run command `npm run build && npm start`).
- Whether it is running today cannot be verified from the repo. Check the deployment and the Make scenarios directly.
- The Make scenarios that receive Intercom events and run the scorer are not in this repo.

## Layout

- `src/index.ts`: CLI entry point (commander): `scan`, `serve`, `report`, `review`, `skill`.
- `src/server.ts`: HTTP router and the webhook handler (`handleWebhook`).
- `src/commands/`: `scan.ts` (pull and score a window), `serve.ts` (HTTP server plus a daily scan timer), `report.ts`, `review.ts`, `skill.ts`.
- `src/core/`: `signals.ts` (keyword pre-screen), `scorer.ts` (calls the Make scorer and parses its reply), `guardrail.ts` (ownership skip), `prompt.ts` (loads the skill prompt).
- `src/types.ts`: shared types.
- `src/integrations/`: `intercom.ts` (Intercom REST API, version 2.11), `slack.ts` (Slack Web API).
- `src/db/schema.ts`: SQLite schema and queries (`signals` and feedback).
- `skill/SKILL.md`: the scoring prompt. `skill/pushpress-patterns.md`: reference material for it.
- `tests/fixtures/`: nine JSON conversation fixtures. No test runner uses them yet.

## HTTP endpoints (`serve`)

- `POST /webhook/conversation-created` and `POST /webhook/conversation-replied`: body `{ "conversation_id": "...", "contact_id": "..." }`.
- `GET /health`: no auth.
- `GET /signals`: optional `since` (e.g. `7d`, `24h`), `result`, `limit`.
- `GET /signals/:id`.

When `WEBHOOK_SECRET` is set, every route except `/health` requires the header `x-webhook-secret` with that value.

## Run locally

1. `npm install`. Note: `package-lock.json` is out of sync with `package.json`, so `npm ci` fails. See known gaps.
2. Create `.env` from `.env.example` and fill in the values. Do not commit it.
3. `npm run dev -- serve` runs the server from source with ts-node. Or `npm run build` then `npm start`.
4. CLI examples after `npm run build`: `node dist/index.js scan --since 24h --dry-run`, `node dist/index.js report summary`.

## Test

- There is no test script. `npx tsc --noEmit -p .` type-checks `src/` and passes on the current code.
- The fixtures in `tests/fixtures/` are not run by anything. Prompt and guardrail changes are checked by hand.

## Deploy (run by a human)

- Replit: deploy with the `.replit` configuration, which runs `npm run build && npm start`.
- Scoring prompt: `node dist/index.js skill deploy --version <tag>` pushes `skill/SKILL.md` to the Make Data Store. Without `MAKE_API_TOKEN` it skips the Make sync.
- Do a dry run first (`scan --dry-run`) before any change that writes to Slack or the database.

## Environment variables (names only)

Read by the code:

- `INTERCOM_ACCESS_TOKEN`, `INTERCOM_WORKSPACE_ID` (optional)
- `SLACK_BOT_TOKEN`, `SLACK_CHANNEL` (optional), `SLACK_MARCY_USER_ID` (optional)
- `MAKE_SCORER_WEBHOOK_URL` (optional override)
- `MAKE_API_TOKEN`, `MAKE_DATASTORE_ID`, `MAKE_DATASTORE_KEY` (used by `skill deploy` only)
- `WEBHOOK_SECRET`, `PORT`, `DATABASE_PATH`, `SKILL_PATH`, `LOG_LEVEL`

Listed in `.env.example` but not read anywhere in `src/`: `ANTHROPIC_API_KEY`, `MAKE_TEAM_ID`, `STRIPE_SECRET_KEY`, `STRIPE_ENABLED`, `STRIPE_GUARDRAIL_ENABLED`, `CLAY_WEBHOOK_URL`, `CLAY_TABLE_ID`, `CLAY_ENABLED`, `HUBSPOT_ENABLED`. Scoring goes through the Make scorer, so `ANTHROPIC_API_KEY` is not used by this code.

## Do not break

- `handleWebhook` in `src/server.ts`: Intercom read, scoring, `insertSignal`, Slack post for HIGH and MEDIUM.
- `parseClaudeResponse` in `src/core/scorer.ts`: reads `RESULT:`, `PRODUCT:`, `SIGNAL_TYPE:`, `QUOTE:`, `ACTION:` and `REASON:` lines from the scorer's reply and falls back to SKIP/Unknown/N/A when one is missing. The output format is defined by the Make scorer scenario, which is not in this repo. `skill/SKILL.md` does not define it.
- `runGuardrail` in `src/core/guardrail.ts`: the ownership skip.
- `postSignalAlert` in `src/integrations/slack.ts`: Slack alert format and channel.
- `src/db/schema.ts`: the `signals` table and feedback columns. Existing data depends on them.
- `scan` in `src/commands/scan.ts`: writes signals and Slack messages unless `--dry-run`. It skips conversations that already have a signal.
- `checkAuth` in `src/server.ts`: the webhook auth check.

## Known gaps

- Auth is off when `WEBHOOK_SECRET` is unset. `GET /signals` then returns customer names, emails and quotes to anyone who can reach the server. The secret comparison is not constant-time, and the request body has no size limit.
- The webhook path does not check for an existing signal, so a reply on a flagged conversation is scored again and can post a second Slack alert. The `scan` path does check.
- SQLite defaults to `./data/signals.db` on local disk. On a host that replaces the filesystem on deploy, signals and feedback are lost. Confirm where the database lives before relying on feedback history.
- `package-lock.json` does not match `package.json`: the lock records chalk 5.6.2 while `package.json` requires chalk 4.1.2, so `npm ci` fails. `npm install` works, but it rewrites the lock file.
- The scorer URL has a built-in default in `src/core/scorer.ts`. Set `MAKE_SCORER_WEBHOOK_URL` to override it.
- `serve` starts a daily scan timer (last 25 hours) by default. The CLI has no flag to turn it off.
- Unused variables are listed in `.env.example` (see above). Removing them has not been done.
- No automated tests.
