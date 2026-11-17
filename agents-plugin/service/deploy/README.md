# Despliegue del servicio de agentes

El servicio de linea-agents (el `agents-plugin` de LINEA) se despliega **por separado de LINEA**: tiene su propia base de datos, **ni login ni
interfaz propios**, y solo lo llama el servidor de LINEA. La gente usa los agentes en LINEA (pestaña **Agentes**).

```
 navegador ──> LINEA (client + server)  ── /api/plugins/agents-plugin/api/*, con la clave compartida y quién es ──> agents-server
                                       <── REST de LINEA, "Service <clave>" + X-Act-As ─────────────────────────────┤
                                       <── /api/plugins/agents-plugin/relay (lo que la persona ve en vivo) ─────────┘
 LINEA ── eventos firmados (generaciones, pushes a los productos) ───────────────────────────────────────────────> /api/events
```

## Antes de levantarlo

1. **Una clave compartida** (`AGENTS_SERVICE_KEY`): cualquier cadena larga y aleatoria. En LINEA: `AGENTS_SERVICE_KEY=<ella>` y
   `LINEA_SERVICE_KEYS=agents-plugin:<ella>`. Quien la tiene puede actuar como cualquiera que haya entrado en LINEA: no sale de esos dos servidores.
2. **Que LINEA llegue al servicio** (`AGENTS_URL` en LINEA, p. ej. `http://agents-server:3001`) **y el servicio a LINEA** (`LINEA_API_URL`).
3. **Un usuario para el trabajo en segundo plano** (`BOT_USER`): un usuario de LINEA que haya entrado en él una vez y que sea maintainer de los productos.

## Levantarlo

```bash
cd deploy
cp .env.example .env     # rellena AGENTS_SERVICE_KEY, LINEA_API_URL, EVENT_WEBHOOK_SECRET y BOT_USER
docker compose up -d --build
curl localhost:3001/api/agents/health      # 200 {"status":"ok",...}
```

## Conectarlo con LINEA

- En LINEA, activa **Agentes** en la vista **Plugins**: aparece la pestaña y las páginas llaman a este servicio a través del servidor de LINEA.
- **Eventos** (una generación con conflictos lanza el resolutor de sync): LINEA los manda a `AGENTS_URL/api/events` mientras el plugin está
  activo, firmados con `EVENT_WEBHOOK_SECRET` (el mismo aquí). Sin esto agents sigue funcionando; el barrido de reconciliación
  (`SYNC_RECONCILE_INTERVAL_MS`) recoge los conflictos que no llegaron.
- **Pushes** (Harvest al hacer push directo a `main` de un producto): llegan como el evento `git:pushed` de LINEA, la misma vía que las generaciones.
  Para el host `local` LINEA los oye solo; para GitLab o GitHub LINEA necesita su propio `PUBLIC_URL` y `GIT_WEBHOOK_SECRET`, y agents le pide, como `BOT_USER`,
  que registre el hook de cada producto (al arrancar y cada `PUSH_HOOK_SYNC_INTERVAL_MS`, 6 h). Agents no sabe qué host hay detrás.

## Puertos y contenedores

| Servicio | Contenedor | Puerto |
|---|---|---|
| servidor | `agents-server` | `AGENTS_PORT` (3001) |
| mongo | `agents-mongo` | 27017 (interno) |
| embeddings | `agents-embeddings` | 80 (interno) |
