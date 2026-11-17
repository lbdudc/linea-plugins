import { describe, expect, it } from 'vitest';

import {
  autoAdjustForProposedFm,
  collectFeatureNames,
  collectMandatory,
  sameSelection,
  toDisplayTree,
  withMandatory,
} from '../../../../../../client/agents/components/consoles/pruebas/fmTreeSelection.js';

const TREE = {
  name: 'Root',
  type: 'AND',
  mandatory: true,
  children: [
    { name: 'Auth', type: 'AND', mandatory: true, children: [] },
    {
      name: 'Payments',
      type: 'OR',
      mandatory: false,
      children: [
        { name: 'Card', type: 'FEATURE', mandatory: false, children: [] },
        { name: 'PayPal', type: 'FEATURE', mandatory: false, children: [] },
        { name: 'Hidden', type: 'FEATURE', mandatory: false, hidden: true, children: [] },
      ],
    },
  ],
};

describe('toDisplayNode / toDisplayTree', () => {
  it('convierte el árbol crudo a nodos de presentación, saltando los ocultos', () => {
    const [root] = toDisplayTree(TREE);
    expect(root.id).toBe('Root');
    expect(root.children.map((c) => c.id)).toEqual(['Auth', 'Payments']);
    const payments = root.children.find((c) => c.id === 'Payments');
    expect(payments.children.map((c) => c.id)).toEqual(['Card', 'PayPal']);
  });

  it('un nodo raíz oculto produce árbol vacío', () => {
    expect(toDisplayTree({ name: 'X', hidden: true })).toEqual([]);
  });

  it('sin árbol, lista vacía', () => {
    expect(toDisplayTree(null)).toEqual([]);
  });
});

describe('collectMandatory', () => {
  it('reúne los nombres obligatorios recursivamente, ignorando los ocultos', () => {
    expect(collectMandatory(TREE).sort()).toEqual(['Auth', 'Root'].sort());
  });

  it('un nodo obligatorio pero oculto no cuenta (nunca es seleccionable)', () => {
    const tree = { name: 'X', mandatory: true, hidden: true, children: [] };
    expect(collectMandatory(tree)).toEqual([]);
  });
});

describe('withMandatory / sameSelection', () => {
  it('añade las obligatorias sin duplicar', () => {
    expect(withMandatory(['Card'], ['Root', 'Auth']).sort()).toEqual(['Auth', 'Card', 'Root'].sort());
    expect(withMandatory(['Root', 'Card'], ['Root']).sort()).toEqual(['Card', 'Root'].sort());
  });

  it('compara selecciones sin importar el orden', () => {
    expect(sameSelection(['A', 'B'], ['B', 'A'])).toBe(true);
    expect(sameSelection(['A'], ['A', 'B'])).toBe(false);
  });
});

describe('collectFeatureNames', () => {
  it('reúne todos los nombres, incluidos los ocultos (recorre el árbol crudo, no el de presentación)', () => {
    const names = collectFeatureNames(TREE);
    expect(names.has('Root')).toBe(true);
    expect(names.has('Hidden')).toBe(true);
    expect(names.size).toBe(6);
  });
});

describe('autoAdjustForProposedFm', () => {
  const current = { name: 'Root', children: [{ name: 'Auth', children: [] }] };
  const proposed = {
    name: 'Root',
    children: [
      { name: 'Auth', children: [] },
      { name: 'NewFeature', children: [] },
    ],
  };

  it('sin MC propuesto, deja la selección igual', () => {
    expect(autoAdjustForProposedFm(['Auth'], current, null)).toEqual(['Auth']);
  });

  it('añade automáticamente las features nuevas del MC propuesto', () => {
    const next = autoAdjustForProposedFm(['Auth'], current, proposed);
    expect(next.sort()).toEqual(['Auth', 'NewFeature'].sort());
  });

  it('no duplica una feature ya seleccionada que también añade el propuesto', () => {
    const next = autoAdjustForProposedFm(['Auth', 'NewFeature'], current, proposed);
    expect(next.sort()).toEqual(['Auth', 'NewFeature'].sort());
  });

  it('descarta de la selección las features que el MC propuesto ya no tiene', () => {
    const shrunk = { name: 'Root', children: [] };
    const next = autoAdjustForProposedFm(['Auth', 'Old'], current, shrunk);
    expect(next).toEqual([]);
  });
});
