
import express from 'express';
import bodyParser from 'body-parser';
import logger from 'morgan';
import cors from 'cors';
import http from 'http';
import process from 'process';
import { exec } from 'child_process';
import { Container } from 'typedi';
import fs from 'fs';
import dotenv from 'dotenv';

import DataSource from './src/model/connectors/DataSource.js';
import { lineaIo } from './src/linea/relay.js';
import { onError } from './src/rest/common/onError.js';

import { agentRouter } from './src/agents/index.js';
import eventsRouter from './src/rest/routers/eventsRouter.js';
import lineasRouter from './rutas/lineasRouter.js';
import lineaRouter from './rutas/lineaRouter.js';
import productosRouter from './rutas/productosRouter.js';
import despliegueRouter from './rutas/despliegueRouter.js';
import { setIo } from './src/agents/core/events.js';
import AgentRunner from './src/agents/core/AgentRunner.js';
import { wireDomainSubscribers } from './src/agents/triggers/domainSubscriber.js';
import { startScheduler } from './src/agents/triggers/scheduler.js';
import { runReconcileSweep, startReconcileSweep } from './src/agents/triggers/reconcileSync.js';
import { renameLegacyKinds } from './src/agents/models/legacyKinds.js';
import { wirePushSubscriber } from './src/agents/triggers/pushSubscriber.js';
import { startPushHookSync } from './src/agents/triggers/pushHooks.js';

dotenv.config();

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  if (init.signal) return nativeFetch(input, init);
  return nativeFetch(input, { ...init, signal: AbortSignal.timeout(30000) });
};

process.on('SIGINT', () => exec('rm -rf tmp', () => process.exit(130)));
process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] unhandledRejection — this would have crashed the process silently:', reason);
  console.error('[server] promise:', promise);
});

const directoryPath = 'tmp';

if (!fs.existsSync(directoryPath)) {
  fs.mkdirSync(directoryPath, { recursive: true });
  console.log(`Created ${directoryPath} directory.`);
} else {
  console.log(`Directory ${directoryPath} already created.`);
}

const port = process.env.PORT || 3001;
const mongoUrl = process.env.mongoUrl;

const backgroundTriggersOn = (process.env.AGENTS_BACKGROUND_TRIGGERS ?? 'off').trim().toLowerCase() === 'on';

export const app = express();
app.set('trust proxy', 1);

const httpSrv = http.createServer(app);
export let server;

app.use(cors());
app.use(logger('dev'));
app.use(bodyParser.json({ limit: '512kb', verify: (req, res, buf) => { req.rawBody = buf; } }));

app.get('/api/agents/health', (req, res) => {
  res.status(200).json({ status: 'ok', backgroundTriggers: backgroundTriggersOn ? 'on' : 'off' });
});

app.use('/api/events', eventsRouter);
app.use('/api/agents', lineasRouter);
app.use('/api/agents', lineaRouter);
app.use('/api/agents', productosRouter);
app.use('/api/agents', despliegueRouter);
app.use('/api/agents', agentRouter);

app.use(onError);

const dataSource = Container.get(DataSource);

dataSource
  .connect({ url: mongoUrl })
  .then(async () => {
    setIo(lineaIo);
    await renameLegacyKinds().then((n) => n && console.log(`[agents] renamed ${n} record(s) made before agents left GitLab`)).catch((e) => console.warn('[agents] could not rename old records:', e?.message ?? e));
    if (backgroundTriggersOn) {
      wireDomainSubscribers();
      wirePushSubscriber();
      startScheduler();
      await Container.get(AgentRunner).recover();
      await runReconcileSweep();
      startReconcileSweep();
      startPushHookSync();
      console.log('[agents] initialized');
    } else {
      console.log('[agents] background triggers disabled (AGENTS_BACKGROUND_TRIGGERS!=on) — the relay to LINEA is wired, nothing else started. See index.js.');
    }

    server = httpSrv.listen(port, '0.0.0.0');
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Is another instance of the server running?`);
      } else {
        console.error('Server error:', error.message);
      }
      process.exit(1);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error.message);
  });
