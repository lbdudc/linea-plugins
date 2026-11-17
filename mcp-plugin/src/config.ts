import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// (the values that only the stdio server needs are read when used: the HTTP server has none of them, each request brings its own)
export const config = {
  SPLALM_BASE_URL: process.env['SPLALM_BASE_URL'] ?? 'http://localhost:3000',
  // a session of LINEA (what the web app gives at login), or the git token of an account of the host (SPLALM_GIT_TOKEN, and SPLALM_GIT_HOST
  // when it is not the primary host's): a LINEA that keeps its repositories itself has accounts with a token and no OAuth
  get SPLALM_JWT(): string { return process.env['SPLALM_GIT_TOKEN'] ? (process.env['SPLALM_JWT'] ?? '') : required('SPLALM_JWT'); },
  SPLALM_GIT_TOKEN: process.env['SPLALM_GIT_TOKEN'] ?? '',
  SPLALM_GIT_HOST: process.env['SPLALM_GIT_HOST'] ?? '',
  get SPL_LINE_ID(): string { return required('SPL_LINE_ID'); },
  MCP_READ_ONLY: process.env['MCP_READ_ONLY'] === 'true',
  MCP_LOG_LEVEL: process.env['MCP_LOG_LEVEL'] ?? 'info',
  /** Directory where playground zip downloads are saved. Defaults to OS temp dir. */
  MCP_DOWNLOAD_DIR: process.env['MCP_DOWNLOAD_DIR'] ?? '',
};
