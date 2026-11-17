import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { mountGlobalPlugins } from '../../support/mount.js';

import QuickLaunchDialog from '../../../../../client/agents/components/common/QuickLaunchDialog.vue';

const AGENTES = [
  { type: 'harvest', name: 'Harvest' },
  { type: 'sync', name: 'Sync' },
];

function montar(props = {}) {
  return mount(QuickLaunchDialog, {
    props: { modelValue: true, agents: AGENTES, createRun: vi.fn(), ...props },
    global: { plugins: mountGlobalPlugins() },
  });
}

describe('QuickLaunchDialog (montaje)', () => {
  it('abierto, monta y pinta el diálogo', async () => {
    const w = montar();
    await flushPromises();
    expect(w.exists()).toBe(true);
    const dialogo = w.findComponent({ name: 'Dialog' });
    expect(dialogo.exists()).toBe(true);
    expect(dialogo.props('visible')).toBe(true);
    w.unmount();
  });

  it('al cerrarse, el diálogo deja de estar visible', async () => {
    const w = montar();
    await flushPromises();
    expect(w.findComponent({ name: 'Dialog' }).props('visible')).toBe(true);

    await w.setProps({ modelValue: false });
    await flushPromises();
    expect(w.findComponent({ name: 'Dialog' }).props('visible')).toBe(false);
    w.unmount();
  });

  it('cerrar emite update:modelValue en false', async () => {
    const w = montar();
    await flushPromises();
    const dialogo = w.findComponent({ name: 'Dialog' });
    await dialogo.vm.$emit('update:visible', false);
    const emitido = w.emitted('update:modelValue');
    expect(emitido).toBeTruthy();
    expect(emitido.at(-1)).toEqual([false]);
    w.unmount();
  });

  it('createRun es obligatorio: sin él el componente no debe montarse en silencio', () => {
    expect(QuickLaunchDialog.props.createRun.required).toBe(true);
  });
});
