# GitLab Webhooks

LINEA uses GitLab push webhooks to auto-trigger the **Harvest Agent** when someone commits directly to a product's `main` branch. Without this, the harvest trigger must be done manually from the ProductDetail page.

---

## How It Works

```
Developer pushes to product's main branch
        │
        ▼  (GitLab fires webhook)
POST /api/webhooks/gitlab
        │
        ├── Verify X-Gitlab-Token header === GITLAB_WEBHOOK_SECRET
        ├── Ignore if not a push event
        ├── Ignore if not the 'main' branch
        ├── Look up product by GitLab project ID
        ├── Resolve user (push author → LINEA account → fallback to line.ownerId)
        ├── Guard: skip if a harvest run is already active for this product
        └── Enqueue Harvest Agent run
```

The endpoint is at **`/api/webhooks/gitlab`** — it is **not** behind `requireAuth` (GitLab can't send a JWT), so it is secured purely by the shared `GITLAB_WEBHOOK_SECRET` token.

---

## Prerequisites

### 1. Set `GITLAB_WEBHOOK_SECRET` in your server env

**`server/.env`** (local dev):
```
GITLAB_WEBHOOK_SECRET=linea-local-dev-secret
```

**`server/.env.production`** (production):
```
GITLAB_WEBHOOK_SECRET=linea-prod-webhook-secret
```

> Use a long random string in production — something like `openssl rand -hex 32`.

After changing the env file in a running Docker deployment, recreate the server container to pick it up:
```bash
docker compose -f deploy/docker-compose.yml up -d --force-recreate server
```

### 2. Ensure the server is reachable from GitLab

- **Production:** `https://linea.example.com` is the configured `REDIRECT_URI`. The webhook URL would be `https://linea.example.com/api/webhooks/gitlab`
- **Local dev:** GitLab must be able to reach your machine. Use a tunnel (e.g. `ngrok`) if GitLab is a remote instance

---

## Configuring the Webhook in GitLab

This must be done **per product repository** in GitLab. There is no line-level webhook — each product has its own repo and its own webhook entry.

### Steps

1. Go to the product's GitLab repository
2. Navigate to **Settings → Webhooks**
3. Click **Add new webhook**
4. Fill in:

   | Field | Value |
   |-------|-------|
   | URL | `https://linea.example.com/api/webhooks/gitlab` (prod) or `http://<your-ip>:3000/api/webhooks/gitlab` (dev) |
   | Secret token | The exact value of `GITLAB_WEBHOOK_SECRET` in your server env |
   | Trigger | ✅ Push events |
   | Branch filter | `main` (optional but recommended to avoid noise) |
   | SSL verification | Enabled (prod) / Disabled (dev with self-signed cert) |

5. Click **Add webhook**
6. Click **Test → Push events** to verify — the server should return `202 harvest_enqueued` or `202 already_active`

### Expected responses

| Response | Meaning |
|----------|---------|
| `202 { status: 'harvest_enqueued' }` | Harvest run successfully started |
| `202 { status: 'already_active' }` | A harvest for this product is already running — skipped |
| `202 { status: 'no_user' }` | Push author not in LINEA and line has no `ownerId` — run skipped |
| `204` | Not a push to `main`, or project not tracked — ignored |
| `401` | Secret token missing or incorrect |
| `500` | Server error — check logs |

---

## No-op Pushes

Generation's own `bigbang → main` merge also pushes to `main`, which fires a webhook. The Harvest Agent handles this gracefully: the `detect-changes` step compares `bigbang → main` and finds no direct changes — the run completes immediately as a no-op.

---

## User Attribution

The run is attributed to the LINEA user whose GitLab username matches `event.user_username` (the push author). If no such user exists:

1. Look up `line.ownerId`
2. If found → attribute the run to the line owner (with a log warning)
3. If not found → skip (return `202 no_user`)

The attributed user's `gitlabAccessToken` is used for all GitLab reads/writes in the run. If the line has no `ownerId` (lines created before that field was added), runs triggered by unknown GitLab users will be skipped. Fix by re-creating the line or patching `ownerId` directly in MongoDB.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Webhook returns 401 | `GITLAB_WEBHOOK_SECRET` not set or wrong | Check env var and GitLab secret token match exactly |
| Webhook returns 401 and secret is set | Container env is stale | `docker compose up -d --force-recreate server` |
| 204 on push to main | `branch` filter wrong, or product not in DB | Check `event.ref` stripping; verify product exists by GitLab project ID |
| 202 `no_user` | Push author not in LINEA, line has no owner | Add user to LINEA or set `line.ownerId` |
| Harvest fires but finds nothing | Correct — bigbang→main merge triggered it | No action needed |
| Harvest fires twice | Active guard should prevent this — check logs for `already_active` | If two separate runs appear, a prior run may have been left mid-flight by a server restart |
