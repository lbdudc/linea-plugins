import { test, expect, describe, beforeAll, afterEach, afterAll } from 'vitest';
import { setup, clear, teardown } from '../setup.js';
import { createUser, setupFakeLinea, resetFakeLinea, teardownFakeLinea, fakeLinea } from '../support/world.js';
import { lineaIo } from '../../linea/relay.js';
import { emitToUser } from '../../agents/core/events.js';
import { setIo } from '../../agents/core/events.js';

beforeAll(setup);
beforeAll(setupFakeLinea);
afterEach(clear);
afterEach(resetFakeLinea);
afterAll(teardown);
afterAll(teardownFakeLinea);

const settle = async (until) => { for (let i = 0; i < 50 && !until(); i++) await new Promise((r) => setTimeout(r, 10)); };

describe('what agents has instead of a socket server', () => {
  test('an event for a person goes to LINEA, as that person, to be put on their socket', async () => {
    const user = await createUser('rl');
    setIo(lineaIo);

    emitToUser(String(user._id), 'agent-run', { run: { _id: 'r1', status: 'running' } });
    await settle(() => fakeLinea().state.relayed.length > 0);

    expect(fakeLinea().state.relayed).toHaveLength(1);
    expect(fakeLinea().state.relayed[0]).toMatchObject({ username: user.username, event: 'agent-run', payload: { run: { _id: 'r1' } } });
  });

  test('a LINEA that cannot be reached does not break the run that emitted', async () => {
    const user = await createUser('rl');
    setIo(lineaIo);
    const previous = process.env.LINEA_API_URL;
    process.env.LINEA_API_URL = 'http://127.0.0.1:9';

    expect(() => emitToUser(String(user._id), 'agent-step', {})).not.toThrow();
    await new Promise((r) => setTimeout(r, 100));
    process.env.LINEA_API_URL = previous;
  });
});
