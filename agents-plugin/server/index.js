/**
 * The AI agents, as a part of LINEA. Their service (own database, own runs) is deployed apart and has no login, no web and no socket:
 *
 *   - people sign in to LINEA and use the agents in LINEA's own pages; this plugin passes their calls on (`/api/*`) to the service with
 *     who they are, under the key LINEA and the service share (AGENTS_SERVICE_KEY);
 *   - what the service wants to tell a person (a run moved on) reaches `/relay`, and goes out on that person's socket.
 */
import path from 'node:path';

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RAW_BODY_BYTES = 10 * 1024 * 1024;

// a body that is not JSON (an upload) is passed on as it came; the host's JSON parser leaves it unread
const readRaw = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_RAW_BODY_BYTES) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});


export default {
  register(ctx) {
    const { requireAuth, asyncHandler } = ctx.services;
    const router = ctx.router();
    const base = () => ctx.settings().url.replace(/\/+$/, '');

    // the service tells a person something: it acts as that person (LINEA's service auth), and only THIS plugin's service may do it
    // (another service with a key of its own must not push events to people's sockets)
    router.post('/relay', requireAuth, (req, res) => {
      if (req.serviceId !== ctx.id) return res.status(403).json({ error: 'error_messages.permission_error' });
      const { event, payload } = req.body ?? {};
      if (typeof event !== 'string' || !event) return res.status(400).json({ error: 'error_messages.internal_error' });
      req.app.get('io')?.to(String(req.userId)).emit(`agents:${event}`, payload ?? {});
      return res.status(204).end();
    });

    // everything the agents' pages ask: /api/plugins/agents-plugin/api/agents/… → the service's /api/agents/…
    router.use('/api', requireAuth, asyncHandler(async (req, res) => {
      if (req.serviceId) return res.status(403).json({ error: 'error_messages.permission_error' });
      const key = ctx.settings().serviceKey;
      if (!key) return res.status(503).json({ error: 'error_messages.agents_unavailable', detail: 'the serviceKey setting is not set' });

      const person = await ctx.services.userRepository.findById(req.userId);
      // (an account that is gone, with a session that is still open: nobody to act as)
      if (!person) return res.status(403).json({ error: 'error_messages.permission_error' });

      // /api/plugins/agents-plugin/api/agents/… → the service's /api/agents/…: only under /api, and with no way out of it by `..`
      const url = new URL(req.originalUrl.replace(/^\/api\/plugins\/agents-plugin/, ''), 'http://service.invalid');
      let requested;
      try { requested = decodeURIComponent(url.pathname); } catch { return res.status(400).json({ error: 'error_messages.internal_error' }); }
      const normalized = path.posix.normalize(requested);
      if (normalized.split('/').includes('..') || !normalized.startsWith('/api/') || /%2e/i.test(url.pathname)) return res.status(400).json({ error: 'error_messages.internal_error' });
      const target = `${base()}${normalized}${url.search}`;

      const carriesBody = !['GET', 'HEAD'].includes(req.method);
      const isJson = Boolean(req.is('json'));
      let body;
      let contentType;
      if (carriesBody && isJson) {
        const has = req.body !== undefined && Object.keys(req.body).length > 0;
        body = has ? JSON.stringify(req.body) : undefined;
        contentType = has ? 'application/json' : undefined;
      } else if (carriesBody && Number(req.headers['content-length']) > 0) {
        try { body = await readRaw(req); } catch (error) { return res.status(error.status ?? 400).json({ error: 'error_messages.internal_error', detail: error.message }); }
        contentType = req.headers['content-type'];
      }

      let answer;
      try {
        answer = await fetch(target, {
          method: req.method,
          headers: {
            'X-Agents-Key': key,
            'X-Act-As': person.username,
            'X-Act-As-Admin': person.admin ? '1' : '0',
            ...(person.avatarUrl ? { 'X-Act-As-Avatar': person.avatarUrl } : {}),
            ...(contentType ? { 'Content-Type': contentType } : {}),
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        return res.status(503).json({ error: 'error_messages.agents_unavailable', detail: error?.message });
      }

      res.status(answer.status);
      const type = answer.headers.get('content-type');
      if (type) res.set('Content-Type', type);
      return res.send(Buffer.from(await answer.arrayBuffer()));
    }));
  },
};
