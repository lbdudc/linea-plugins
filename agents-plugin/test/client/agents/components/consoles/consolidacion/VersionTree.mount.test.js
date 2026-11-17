import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { mountGlobalPlugins } from '../../../support/mount.js';

import VersionTree from '../../../../../../client/agents/components/consoles/consolidacion/VersionTree.vue';

const VERSIONES = [
  { _id: 'v1', label: '1.0.0', title: 'Primera', status: 'draft', createdAt: '2026-09-01T10:00:00.000Z' },
  { _id: 'v2', label: '1.1.0', title: 'Segunda', status: 'sandbox', parentId: 'v1', createdAt: '2026-09-02T10:00:00.000Z' },
];

function montar(props = {}) {
  return mount(VersionTree, {
    props: { versions: VERSIONES, ...props },
    global: { plugins: mountGlobalPlugins() },
  });
}

describe('VersionTree (montaje)', () => {
  it('monta sin reventar y pinta una fila por versión', () => {
    const w = montar();
    expect(w.exists()).toBe(true);
    expect(w.text()).toContain('Primera');
    expect(w.text()).toContain('Segunda');
  });

  it('registra un menú por nodo, no uno compartido', () => {
    const w = montar();
    const menus = w.findAllComponents({ name: 'Menu' });
    expect(menus.length).toBe(VERSIONES.length);
  });

  it('no pinta menús abiertos de partida', () => {
    const w = montar();
    const abiertos = w.findAllComponents({ name: 'Menu' }).filter((m) => m.vm.overlayVisible);
    expect(abiertos.length).toBe(0);
  });

  it('con la lista vacía no revienta', () => {
    const w = mount(VersionTree, {
      props: { versions: [] },
      global: { plugins: mountGlobalPlugins() },
    });
    expect(w.exists()).toBe(true);
    expect(w.findAllComponents({ name: 'Menu' }).length).toBe(0);
  });
});
