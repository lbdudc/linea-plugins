# Pushes a los productos (eventos de git)

Harvest se lanza cuando alguien hace push directo a `main` de un producto (una personalización hecha fuera del flujo de generación). Agents **no
sabe qué host git hay detrás** (local, git host, GitHub) ni registra hooks por su cuenta: se entera por LINEA.

```
host git ──push──> LINEA ──git:pushed (firmado, X-Linea-Signature)──> agents /api/events ──> pushSubscriber ──> run de Harvest
```

1. **LINEA oye el push.** El host `local` lo emite al aceptar el push; git host y GitHub avisan por su webhook a `POST /api/webhooks/<host>` de LINEA
   (verificado con `GIT_WEBHOOK_SECRET`). En los dos casos LINEA emite `git:pushed` con `{ host, repositoryId, branch?, username }`.
2. **LINEA lo reenvía** a los plugins activos (`remote.events`), firmado con `EVENT_WEBHOOK_SECRET`.
3. **Agents lo recibe** en `/api/events` (`src/rest/routers/eventsRouter.js`) y `src/agents/triggers/pushSubscriber.js` decide:
   - una rama que no es `main` se ignora (si el push no dice la rama, se mira lo que `main` tiene más allá de la base);
   - el producto se busca como la persona que hizo el push (si entró en agents) o como `BOT_USER`; si no es un producto con seguimiento, se ignora;
   - se comparan `bigbang` y `main` a través de LINEA: si solo cambia `.linea/**` (metadato de LINEA) no hay nada que subir;
   - se respeta la configuración por línea/producto (Harvest desactivado o su disparador apagado) y que no haya ya un run activo;
   - si todo pasa, se encola un run de Harvest, que se queda en `awaiting_approval`.
   Cada decisión queda en el registro de entregas (`GET /api/agents/webhook-deliveries`).
4. **Los hooks de git host/GitHub** los pide agents a LINEA (`POST /api/repos/:id/push-hook`, como `BOT_USER`, al arrancar y cada `PUSH_HOOK_SYNC_INTERVAL_MS`);
   LINEA los registra con su provider (`linea-git`). Sin `PUBLIC_URL` y `GIT_WEBHOOK_SECRET` en LINEA no hay hook que registrar, y agents lo dice en el log.
