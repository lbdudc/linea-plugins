import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { mountGlobalPlugins } from '../../../support/mount.js';

import SyncConsole from '../../../../../../client/agents/components/consoles/sync/SyncConsole.vue';

function run(over = {}) {
  return {
    _id: 'r' + Math.random().toString(36).slice(2, 8),
    agentType: 'sync',
    status: 'done',
    createdAt: '2026-09-10T10:00:00.000Z',
    scope: { lineId: 'L1', productId: 'p1' },
    ...over,
  };
}

function montar(runs) {
  return mount(SyncConsole, {
    props: { runs },
    global: { plugins: mountGlobalPlugins() },
  });
}

describe('SyncConsole (montaje)', () => {
  it('monta sin reventar con la lista vacía', async () => {
    const w = montar([]);
    await flushPromises();
    expect(w.exists()).toBe(true);
  });

  it('monta con runs de varios estados', async () => {
    const w = montar([
      run({ status: 'running', scope: { lineId: 'L1', productId: 'p1' } }),
      run({ status: 'awaiting_approval', scope: { lineId: 'L1', productId: 'p2' } }),
      run({ status: 'failed', agentType: 'regen', scope: { lineId: 'L1', productId: 'p3' } }),
    ]);
    await flushPromises();
    expect(w.exists()).toBe(true);
    expect(w.html()).toBeTruthy();
  });

  it('un sync terminado con conflictos sin resolver no cuenta como limpio', async () => {
    const enConflicto = run({ status: 'done', result: { hasConflicts: true } });
    const limpio = run({ status: 'done', result: { hasConflicts: false } });
    const w = montar([enConflicto, limpio]);
    await flushPromises();
    expect(w.exists()).toBe(true);
  });

  it('no revienta con un run sin ámbito', async () => {
    const w = montar([run({ scope: undefined })]);
    await flushPromises();
    expect(w.exists()).toBe(true);
  });
});
