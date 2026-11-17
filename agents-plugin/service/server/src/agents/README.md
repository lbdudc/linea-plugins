# `server/src/agents` — the LINEA agent subsystem

This folder is the **entire** agent ecosystem. It runs **in-process** inside the
existing LINEA Express server, but it is a self-contained module so you can always
tell what is "LINEA proper" from what is "the new agent part".

See `docs/mcp/ideas/agent-ecosystem-plan.md` for the full plan.

## The boundary rule

> `agents/` **may import** from `model/services`, `model/connectors`, and
> `model/entities` (to read the SPL and run the deterministic cores).
> The existing server code **must never import** from `agents/`.

The existing server touches agents at exactly one seam today — the composition
root, `server/index.js`, which:

1. imports `{ initAgents, agentRouter }` from `./src/agents/index.js`,
2. mounts the router with `app.use('/api/agents', agentRouter)`, and
3. calls `initAgents({ io })` once after the DB connects (wires Socket.IO + runs
   the boot recovery sweep).

The `rest/` and `model/` layers contain **no** imports of `agents/`. A future seam
arrives in Phase 1+, when `ProductService` will emit a domain event that enqueues a
run — until then the services are untouched.

Delete this folder and remove the `index.js` seam and LINEA runs exactly as before.

## Layout

```
agents/
├── core/          runner, approval gate, registry, shared LLM loop, socket events
├── definitions/   one file per agent (the "what" — declarative step lists)
├── tools/         the agents' callable tools (the "how" — wrap services + LINEA's git API)
├── models/        Mongoose schemas + repositories owned by this module
├── triggers/      webhook + scheduler intake
├── rest/          agentController + agentRouter
├── sync/          sync-specific LLM resolution loop + refinement service
├── harvest/       harvest-specific LLM proposal loop + refinement service
├── knowledge/     multi-turn conversational Q&A service (not a registered agent)
├── memory/        per-scope durable memory service
└── playground/    sandbox test + zip-download service for proposal review
```

System prompts are inline `SYSTEM_PROMPT` constants inside each definition file —
there is no separate `prompts/` directory.

## The one discipline

Every agent names a **deterministic core** (`completeFeatureSelection`,
`generateActions`, branch-SHA compare, the `Log` i18n keys) and re-validates anything
the LLM proposes against it. Claude explains and proposes; `spl-js-engine` and git host
decide.

## Registered agents (7 total)

| Agent | Scope | Kind | Description |
|-------|-------|------|-------------|
| `line-health` | line | LLM + git host | Unified health report: product validity, FM anomalies, 1-wise/2-wise coverage, git host anti-patterns. Scheduler-capable. |
| `sync` | product | LLM + git host | Diagnose sync conflict; propose + commit resolution |
| `harvest` | product | LLM + git host | Detect product customizations; propose SPL uplift MR |
| `evolution` | line | LLM | Scan products against FM; propose spec patches (migration) or preview impact |
| `fm-constraint-advisor` | line | LLM + git host | Propose validated UVL constraints for coupling smells; opens line MR |
| `feature-location` | line | LLM + git host | Locate a feature's platform footprint; optionally propose `@feature` annotations |
| `variant-miner` | line | LLM | Cluster product divergences by shared generator-owned files; rank candidate harvests. Scheduler-capable. |

`line-health` consolidates the former `spl-health-snapshot`, `steward`, `fm-health`,
and `coverage-analysis` agents. The scheduler (triggers/scheduler.js) now enqueues
`line-health` and is configured via `HEALTH_INTERVAL_MS`.

---

## Scheduled bot setup

The scheduler (`triggers/scheduler.js`) fires `line-health` automatically for every
enrolled line. It is disabled by default and opt-in via env vars.

### Environment variables

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `HEALTH_INTERVAL_MS` | Yes (to enable) | `604800000` | Run interval in ms. `604800000` = weekly. Not set → scheduler is disabled. |
| `BOT_USER` | No | `linea-bot` | A LINEA username (one that has signed in to LINEA at least once). Falls back to each line's owner when not set. |

### How the bot user works

Background work (the scheduler, pushes, the reconcile sweep) has no person at the keyboard, so it acts as a **LINEA user**: agents calls LINEA's API
as that user (`Authorization: Service <key>` + `X-Act-As: <username>`) and LINEA reads and writes the repositories with *their* access, on whatever git
host it is configured with. Agents never sees a git token.

- **`BOT_USER` is set** → all scheduled and push-triggered runs are attributed to that user.
- **`BOT_USER` is not set** → each run falls back to the line's owner. If a line has no owner the run is skipped with a warning.

### Creating a bot user

1. **Create an account** for the bot (e.g. `linea-bot`) on the git host LINEA uses, with at least *Reporter* access on the lines and *Maintainer*
   on the products (it asks LINEA to register their push hooks).
2. **Sign in to LINEA once** as that account so LINEA knows it.
3. **Set the env vars** in `server/.env`:
   ```env
   HEALTH_INTERVAL_MS=604800000
   BOT_USER=linea-bot
   ```
4. **Restart the server** (or the Docker container):
   ```bash
   docker compose up -d --force-recreate server
   ```

On startup you will see:
```
[agents] scheduler enabled: line-health every 604800000ms (BOT_USER=linea-bot)
```
