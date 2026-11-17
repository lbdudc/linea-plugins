# linea-agents

El servicio de agentes de IA de LINEA (el `agents-plugin`). **Base de datos propia y ni login ni interfaz propios**: la gente entra en
LINEA, y las vistas de los agentes son páginas de LINEA, bajo la pestaña **Agentes** (en el plugin: `plugins/agents-plugin/client`). Este
servicio se despliega aparte y solo lo llama el servidor de LINEA.

```
server/   API, ejecutor de runs, memoria y disparadores. Node 20 + Express + Mongo.
deploy/   Compose del servicio (Mongo, embeddings, servidor) para desplegarlo (ver deploy/README.md).
```

## Cómo se conecta con LINEA

- **Identidad.** No hay login aquí. La persona entra en LINEA; el servidor de LINEA le pasa sus llamadas a agents (`/api/plugins/agents-plugin/api/*`)
  con la clave que comparten (`X-Agents-Key`, la `AGENTS_SERVICE_KEY` de los dos) y quién es (`X-Act-As`, `X-Act-As-Admin`). Nada más entra: agents
  no se publica donde llegue un navegador. Ver `server/src/rest/common/auth.js`.
- **Hacia LINEA.** Cuando agents necesita algo de LINEA actúa *como esa persona*: `Authorization: Service <clave>` y `X-Act-As: <usuario>`
  (LINEA: `LINEA_SERVICE_KEYS=agents-plugin:<clave>`; solo conoce a quien ya entró en LINEA). Ver `server/src/linea/`.
- **Git.** Agents **no habla con ningún servidor git ni guarda su token**: ramas, árbol y ficheros de los repos, commits, comparaciones y MRs los hace LINEA
  (`/api/repos/:id/*`, `/api/repos/:id/mrs`), con el token de la persona y a través de `linea-git`; por eso agents funciona con cualquier host que
  soporte LINEA (local, GitLab, GitHub). Derivar un producto para probarlo (Playground) también se lo pide a LINEA (`POST /api/products/:id/zip`).
  Ver `server/src/linea/repo.js`.
- **Datos.** agents no toca la base de LINEA. Líneas, productos, specs, generaciones y logs se piden a la API de LINEA (`LineaClient`); en su
  propia base solo guarda lo suyo (runs, memoria, configuración, versiones de change set...).
- **Eventos hacia la persona.** No hay servidor de sockets: lo que agents quiere contar (un run avanzó) lo manda a LINEA
  (`/api/plugins/agents-plugin/relay`) y LINEA lo pone en el socket de esa persona como `agents:<evento>` (ver `server/src/linea/relay.js`).
- **Eventos desde LINEA.** LINEA avisa de las generaciones y de los pushes a los productos (`product:generated`, `git:pushed`) con un POST firmado a
  `/api/events` mientras el plugin está activo. Ver `docs/linea-origin/git-events.md`.
- **Trabajo en segundo plano** (scheduler, pushes, eventos): actúa como `BOT_USER`, un usuario de LINEA que ya entró en él.
- **linea-core.** Una sola dependencia fijada (`@lbdudc/linea-core`, versión exacta) y un único fichero que la importa:
  `server/src/linea/featureModel.js`.

## Levantarlo

```bash
cd deploy && cp .env.example .env && docker compose up -d --build     # ver deploy/README.md
```

Y en LINEA: `AGENTS_URL`, `AGENTS_SERVICE_KEY` y `LINEA_SERVICE_KEYS` (ver `plugins/README.md`), y activar el plugin en **Plugins**.

## Desarrollo

```bash
cd server && npm ci && npm run dev    # API en el puerto 3001
```

Variables: `server/.env.example`.

## Comprobaciones

Las mismas que ejecuta `.gitlab-ci.yml`:

```bash
cd server && npx vitest run              # `npm test` se queda en vigilancia
cd server && npm run check:lint-baseline
cd server && npm run check:install
```

Las pruebas de las vistas están con ellas, en `plugins/agents-plugin/test/client` (las ejecuta `linea/client`).
