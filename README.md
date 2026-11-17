# LINEA plugins

The plugins of [LINEA](https://github.com/lbdudc/linea), the platform for software product lines. This repository is the hub for everything that extends LINEA:
the catalog (`marketplace.json`), the official plugins, and how to write your own.

| Plugin | What it is |
|---|---|
| [`analytics-plugin`](analytics-plugin) | Feature-model analysis with flamapy (figures strip, analysis panel). Runs a service of its own. |
| [`agents-plugin`](agents-plugin) | AI agents as pages of LINEA. Its service (`agents-plugin/service`) deploys apart and talks to LINEA by REST. |
| [`spl-code-editor`](spl-code-editor) | The Code tab of simple SPLs: file editor, feature↔code annotations, trial derivation. |
| [`mcp-plugin`](mcp-plugin) | MCP server: use a line of LINEA from an AI client (Claude, Cursor...) over the Model Context Protocol, as the person who connects. A service of its own (`ghcr.io/lbdudc/linea-mcp`, endpoint `/mcp/<line id>`), also as the stdio npm package `@lbdudc/linea-plugin-mcp`. |

**Use them.** The official LINEA images (`ghcr.io/lbdudc/linea-server`, `linea-client`) already carry the plugins of this catalog; an administrator
switches them on in *Configuration → Plugins*. To use your own folder of plugins, point `PLUGINS_DIR` at it. The services some plugins run as are images too:
`ghcr.io/lbdudc/linea-flamapy` (analytics; started by `docker-compose.plugins.yml` of LINEA) and `ghcr.io/lbdudc/linea-agents` (agents) and `ghcr.io/lbdudc/linea-mcp` (MCP), published by this repository's *Release* workflow.

**Work on them.** Check out this repository next to a checkout of `lbdudc/linea`, run `npm install` in `linea`, then `./install.sh` here. The plugin tests run with
LINEA's (`PLUGINS_DIR=$PWD npm test` in `linea`).

---

# LINEA plugins

LINEA is a **core** (lines, products, generation, deployments, the model editor, modules and their registry, the git hosts) and **plugins** that add optional capabilities to it. A plugin is a folder here. The **Plugins** view of the web app (`/plugins`) lists the catalog, and an administrator installs, enables and disables plugins there, **without restarting** anything.

| Plugin | What it adds | Where it runs |
|---|---|---|
| `analytics-plugin` | the analysis of the feature model with flamapy (the figures strip and the analysis panel) | in LINEA (routes + UI) and `service/` (flamapy), in a container of its own |
| `agents-plugin` | the AI agents, as pages of LINEA under the **Agents** tab (their views are ported into `client/agents/`), the proxy that lets those pages call the agents' service as the signed-in person, and the domain events the service receives | in LINEA (pages, proxy, socket relay) and `service/`: the agents' service (its code is here, own database, **no login and no web**; it knows **no git host**: it reads and writes repositories through LINEA's API), deployed apart |

What is **not** a plugin: the git hosts (`local`, GitLab, GitHub) are configuration (`gitHosts:` of `linea.config.yml`, or Settings → Git hosts), and modules, metamodels, the registry and the `project` and `modular` kinds of line are the core's. A plugin adds an optional capability; it never adds something LINEA needs to work. See [`docs/linea/architecture.md` of lbdudc/linea](https://github.com/lbdudc/linea/blob/main/docs/linea/architecture.md).

## Layout of a plugin

```
plugins/
  marketplace.json         the catalog: [{ id, path, icon?, description? }]  (the manifest wins over these defaults)
  install.sh               links plugins/node_modules to linea/server/node_modules (run once after cloning)
  compose.yml              the services of the plugins, for a laptop
  <id>/
    plugin.json            the manifest
    server/index.js        in-process, optional:  export default { register(ctx) }
    client/index.js        compiled into the web app, optional:  export default { register(ui) }
    service/               a service of its own, optional (Dockerfile, compose.yml...)
    test/server, test/client   run with the tests of linea/server and linea/client
```

`plugin.json`:

```json
{
  "id": "analytics-plugin",
  "name": { "en": "UVL analytics", "es": "Análisis UVL" },
  "version": "1.0.0",
  "description": { "en": "…" },
  "icon": "pi-chart-bar",
  "requires": { "linea": "^1.0.0" },
  "server": "server/index.js",
  "client": "client/index.js",
  "remote": {
    "baseUrl": "${FLAMAPY_API_URL:-http://localhost:8000}",
    "health": "/health",
    "web": "…", "events": "…"
  }
}
```

- `name`, `description` are a string or `{ en, es, gl }`.
- `requires.linea` is a semver range checked against LINEA's version; a plugin that does not fit cannot be installed.
- `remote` is a service the plugin lives with. `health` is polled by the Plugins view (up / down); `web` is where its own interface is (a nav entry can link to it); `events` receives the signed domain events (`X-Linea-Signature`, keyed by `EVENT_WEBHOOK_SECRET`) while the plugin is enabled. `${NAME}` and `${NAME:-default}` are taken from the server's environment.

## What a plugin may do

### Server: `register(ctx)`

Called once, when the plugin is installed (or at start, if it already is). Everything it registers answers only **while the plugin is enabled**: that is a switch the host reads on each request and event.

| `ctx` | |
|---|---|
| `ctx.router()` | an Express router served at `/api/plugins/<id>/…`. Disabled: `404 plugin_disabled` |
| `ctx.alias('/api/lines/analyze', '/analyze')` | also serve the old path of something that moved here (for callers that cannot change) |
| `ctx.events.on(name, fn)` | `domainEvents.on`, skipped while disabled |
| `ctx.settings()`, `ctx.onSettingsChange(fn)` | The plugin's settings, resolved (see "Customizing a plugin"); `fn(values, before)` runs after an admin saved them |
| `ctx.isEnabled()`, `ctx.id`, `ctx.dir` | |
| `ctx.services` | what the server lends (see `linea/server/src/plugins/index.js`): `requireAuth`, `requireAdmin`, `asyncHandler`, `rateLimit`, `handleValidationErrors`, `userRepository`, the errors (not the container) |

**How it is loaded.** Nothing a plugin registers (routes, `events.on`, `onSettingsChange`) takes effect until its `register` has finished well (it has 15 seconds); one that throws or hangs is listed with its `loadError` and can be tried again by enabling it. Uninstalling removes all of it, and installing again reads the code on disk (the Plugins view says `restartRequired` when the version on disk is not the one running). After a LINEA upgrade a plugin that no longer fits (`requires.linea`, `requires.hostApi`) is not run.

**The manifest says what it needs**: `requires: { linea, hostApi, gitHosts }`. `hostApi` is the version of this interface (`1.0.0`). `gitHosts: ["gitlab"]` means *it works only with one of these git hosts*: with none on, the plugin is off and hidden (the agents service speaks only GitLab). `id` is lowercase letters, digits and dashes, and not `enabled`, `config.yml`, `settings`, `install`, `enable`, `disable` (the host answers those paths itself).

**Service keys.** A plugin with a service of its own names the setting that is the key (`"serviceKey": "serviceKey"` in `plugin.json`): while the plugin is on, `Authorization: Service <key>` + `X-Act-As: <username>` acts as that person on what a person can do. `LINEA_SERVICE_KEYS=id:secret,id#admin:secret` adds keys of the deployment (several for one id while one is rotated; the scope `admin` lets the key act on the routes of administrators, as an administrator only). Every use is logged with the service and the person. A service never reaches another plugin's routes meant for its own service (`/relay` checks the id).

What a plugin imports that is not a relative path (`express-validator`, `@lbdudc/linea-core`, `@lbdudc/linea-git`…) is the server's own copy, through `plugins/node_modules`. It must share it: two copies of linea-core would not agree on `instanceof`.

### Client: `register(ui)`

Called after sign-in (or on the login page) for each enabled plugin, once per page load. Switching a plugin on or off reloads the page.

| `ui` | |
|---|---|
| `ui.api` | the app's axios instance (`/api`, with the session) |
| `ui.info` | `{ id, version, web }` as the server says |
| `ui.addNav({ id, icon, label, to \| href, activeFor })` | an entry in the top bar (`href`: a page outside LINEA, opened in its own tab) |
| `ui.addRoute({ path, component, props })` | a page, in the app's layout |
| `ui.addSlot(name, component, { when, order })` | a component in a slot of a page (below) |
| `ui.addI18n(messages)` | words |

Slots (`SLOTS` in `linea/client/src/plugins/registry.js`): `featureModel.strip` (the toolbar of the model editor) and `featureModel.panels` (beside the editor) get `{ lineId, uvl, uvlInvalid, readOnly, isFeatureModel, loading, requestSave }` as props.

Client code imports `vue`, `primevue`, other libraries and the app's aliases (`src/…`, `components/…`) as the app does: the build resolves them against `linea/client` (`client/plugin-deps.mjs`). Compiled into the app's bundle, so a plugin that does not compile breaks the build.

## Customizing a plugin: settings

Whatever a deployment may want to change about a plugin is declared in its `plugin.json` under `settings`, and never read from
`process.env` by the plugin itself. The Plugins view then draws a form for it (the **Configure** button) with no code in the plugin.

```json
"settings": {
  "url":    { "type": "url",    "default": "http://localhost:8000", "env": "FLAMAPY_API_URL", "label": { "en": "Service address" } },
  "mode":   { "type": "enum",   "options": ["sat", "bdd"], "default": "sat", "public": true },
  "key":    { "type": "secret", "env": "SERVICE_KEY", "required": true },
  "owners": { "type": "list" }
}
```

- **Types:** `string`, `url`, `number` (`min`, `max`), `boolean`, `enum` (`options`), `list`, `secret`.
- **Other fields:** `label` and `description` (a string or `{ en, es, gl }`), `default`, `required`, `env` (the environment variable that
  used to configure it: still honoured), `public` (also given to the browser as `ui.settings`; never for a secret), `optionsFrom` (a path
  under the plugin's own router, e.g. `settings-options/groups`, that answers `[{ value, label }]`: the form shows a select).
- **Which value wins:** `default` < `env` < what an admin saved in the Plugins view < `linea.config.yml`. A value that comes from the file is
  *locked* in the view.
- **A setting named `url`** is also where the plugin's `remote` lives (`baseUrl`, `health`, `events`), so changing it moves the health check
  and the event delivery too.
- **`required` and nobody gave it:** the plugin cannot be enabled (the card says which settings it needs).
- **Server:** `ctx.settings()` gives the values *now* (read it inside the handler, not once at `register`, so a change applies without a
  restart); `ctx.onSettingsChange((values, before) => ...)` for what has to be rebuilt.
- **Client:** `ui.settings` has the `public` ones.
- The path `/api/plugins/<id>/settings` is the host's (admin only): a plugin cannot serve its own. Secrets are never sent back: the view shows
  "set", and an empty value keeps the one saved.

The `plugin.json` of `analytics-plugin` and `agents-plugin` are examples of these settings (a URL with an environment variable, a required secret).

A deployment can also set them (and switch the plugin on) in `linea.config.yml`, which locks them in the view: see [`docs/linea/architecture.md` of lbdudc/linea](https://github.com/lbdudc/linea/blob/main/docs/linea/architecture.md),
"Deploying with a config file".

## Running it

```bash
./install.sh                                  # once
cd ../linea/server && ADMIN_USERS=dev …       # who may switch plugins (git usernames), then LINEA as usual (server/dev/README.md)
docker compose --env-file <agents env> up -d --build   # here: the analysis service (:8000) and the agents application (:3001); see compose.yml
```

LINEA in Docker: `cd linea/deploy && docker compose -f docker-compose.yml -f docker-compose.plugins.yml up -d --build`. Both images are built from the LINEA folder and take `plugins/` with them. Without the second file LINEA runs and the plugins that need a service show as down.

Environment of LINEA that plugins use: `FLAMAPY_API_URL` (analytics), `AGENTS_URL` (where LINEA's server reaches the agents' service), `AGENTS_SERVICE_KEY` (the key LINEA and the agents' service share: the service presents it to LINEA, LINEA to it) and `LINEA_SERVICE_KEYS` (`id:secret,…`, the services that may act for a signed-in person: `agents-plugin:<the same key>`), `EVENT_WEBHOOK_SECRET` (the key the events are signed with), `PLUGINS_DIR` (another folder of plugins).

### How the agents have no login

People sign in to LINEA, and only to LINEA. The agents' pages (the Agents tab) call `/api/plugins/agents-plugin/api/*` with their LINEA session; LINEA's server passes the call to the agents' service with the shared key and who the person is (`X-Act-As`). When the service needs LINEA or the git host it acts as that person the same way: `Authorization: Service <key>` + `X-Act-As: <username>` (LINEA only knows people who signed in to it) and does everything on the repositories (branches, files, commits, comparisons, merge requests, deriving a product to try it) through LINEA's API (`/api/repos/:id/*`), which uses the person's access on whatever git host is configured. The pushes to the products reach it as `git:pushed` events. What the service wants to tell a person goes to `/api/plugins/agents-plugin/relay`, and LINEA puts it on that person's socket as `agents:<event>`.

## What stays in the core, on purpose

The engine every line runs on is the core's, whatever its kind: `spl.json`, the lockfile, resolving the feature metamodel, the registry of modules and metamodels (pages, studio, publishing), the `project` and `modular` kinds, deriving products, the models and feature selection of a product. And the git hosts, because every line is a repository.

## Tests

`linea/server` and `linea/client` run the tests of the plugins with their own (`plugins/*/test/server`, `plugins/*/test/client`).
