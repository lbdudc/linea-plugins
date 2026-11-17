import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import childProcess from 'node:child_process';
import { afterAll } from 'vitest';

const events = [];

const spawns = [];

const isLoopback = (host) =>
  !host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.');

const callSite = () => {
  const lines = (new Error().stack ?? '').split('\n').slice(1);
  return lines
    .filter((line) => !line.includes('netProbe.setup.js') && !line.includes('node:internal') && !line.includes('node:'))
    .slice(0, 5)
    .map((line) => line.trim())
    .join('\n      ');
};

const record = (kind, target) => {
  events.push({ kind, target: String(target), stack: callSite() });
};

for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
  const original = dns[fn];
  if (typeof original !== 'function') continue;
  dns[fn] = function (hostname, ...rest) {
    if (!isLoopback(hostname)) record(`dns.${fn}`, hostname);
    return original.call(this, hostname, ...rest);
  };
}
if (dns.promises) {
  const originalLookup = dns.promises.lookup;
  dns.promises.lookup = function (hostname, ...rest) {
    if (!isLoopback(hostname)) record('dns.promises.lookup', hostname);
    return originalLookup.call(this, hostname, ...rest);
  };
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const opts = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
  const host = opts?.host ?? opts?.path ?? '';
  if (!isLoopback(host)) record('net.connect', `${host}:${opts?.port ?? '?'}`);
  return originalConnect.apply(this, args);
};

const originalTlsConnect = tls.connect;
tls.connect = function (...args) {
  const opts = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
  const host = opts?.servername ?? opts?.host ?? '';
  if (!isLoopback(host)) record('tls.connect', host);
  return originalTlsConnect.apply(this, args);
};

for (const [name, mod] of [['http', http], ['https', https]]) {
  for (const fn of ['request', 'get']) {
    const original = mod[fn];
    mod[fn] = function (...args) {
      const first = args[0];
      let host = '';
      try {
        host = typeof first === 'string' ? new URL(first).hostname : (first?.hostname ?? first?.host ?? '');
      } catch { /* unparseable target: treat as not-external below */ }
      if (!isLoopback(host)) record(`${name}.${fn}`, host);
      return original.apply(this, args);
    };
  }
}

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input, ...rest) {
    try {
      const url = typeof input === 'string' ? input : input?.url;
      const host = url ? new URL(url).hostname : '';
      if (!isLoopback(host)) record('fetch', url);
    } catch { /* unparseable URL: not external network */ }
    return originalFetch.call(this, input, ...rest);
  };
}

const externalLog = process.env.NETPROBE_LOG;
const appendToExternalLog = (event) => {
  if (!externalLog) return;
  try {
    fs.appendFileSync(externalLog, `${JSON.stringify(event)}\n`);
  } catch { /* best-effort only */ }
};

for (const fn of ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync']) {
  const original = childProcess[fn];
  if (typeof original !== 'function') continue;
  childProcess[fn] = function (command, ...rest) {
    spawns.push({ fn, command: String(command).slice(0, 160) });
    return original.call(this, command, ...rest);
  };
}

afterAll(() => {
  for (const event of events) appendToExternalLog(event);
  if (events.length === 0) return;

  const summary = events
    .map((e, i) => `  ${i + 1}. [${e.kind}] -> ${e.target}\n      ${e.stack || '(no call site captured)'}`)
    .join('\n\n');

  const spawnNote = spawns.length === 0
    ? ''
    : `\nAdemás se lanzaron ${spawns.length} subproceso(s), cuyo tráfico de red esta sonda NO puede ver:\n` +
      spawns.map((s, i) => `  ${i + 1}. ${s.fn}: ${s.command}`).join('\n') + '\n';

  throw new Error(
    `netProbe: ${events.length} non-loopback network event(s) reached the real network in this test file. ` +
    `The the git host double and MongoMemoryReplSet (127.0.0.1) are legitimate; anything else is an unmocked seam:\n\n${summary}\n${spawnNote}`
  );
});
