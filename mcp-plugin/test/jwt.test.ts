import { test } from 'node:test';
import assert from 'node:assert/strict';

// a session of LINEA: the bearer is the JWT
process.env['SPLALM_JWT'] = 'the-jwt';
process.env['SPL_LINE_ID'] = 'line-1';
delete process.env['SPLALM_GIT_TOKEN'];

const { authHeaders } = await import('../src/client.js');

test('with a JWT the requests carry it as a bearer, and no git host header', () => {
  assert.deepEqual(authHeaders(), { 'Content-Type': 'application/json', Authorization: 'Bearer the-jwt' });
});
