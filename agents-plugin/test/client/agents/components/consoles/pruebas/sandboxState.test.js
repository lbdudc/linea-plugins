import { describe, expect, it } from 'vitest';

import {
  anyEditDirty,
  buildCommitPayload,
  displayFiles,
  editStatusOf,
  isEditDirty,
  isPathDirty,
  isPendingCreate,
  isSandboxComplete,
  normalizeNewPath,
  pendingCreates,
} from '../../../../../../client/agents/components/consoles/pruebas/sandboxState.js';

describe('isEditDirty', () => {
  it('un delete siempre es dirty', () => {
    expect(isEditDirty({ action: 'delete' })).toBe(true);
  });

  it('un create es dirty solo si tiene contenido', () => {
    expect(isEditDirty({ action: 'create', newContent: '' })).toBe(false);
    expect(isEditDirty({ action: 'create', newContent: 'x' })).toBe(true);
  });

  it('un update es dirty solo si el contenido cambió respecto al original', () => {
    expect(isEditDirty({ action: 'update', newContent: 'a', _originalContent: 'a' })).toBe(false);
    expect(isEditDirty({ action: 'update', newContent: 'b', _originalContent: 'a' })).toBe(true);
  });

  it('sin edición, no es dirty', () => {
    expect(isEditDirty(null)).toBe(false);
  });
});

describe('anyEditDirty', () => {
  it('true si al menos una edición es dirty', () => {
    expect(anyEditDirty([{ action: 'update', newContent: 'a', _originalContent: 'a' }, { action: 'create', newContent: 'x' }])).toBe(true);
  });
  it('false si ninguna lo es', () => {
    expect(anyEditDirty([{ action: 'update', newContent: 'a', _originalContent: 'a' }])).toBe(false);
  });
});

describe('normalizeNewPath', () => {
  it('una ruta relativa suelta va a src/platform/code/', () => {
    expect(normalizeNewPath('calculator.js')).toBe('src/platform/code/calculator.js');
    expect(normalizeNewPath('test/x.test.js')).toBe('src/platform/code/test/x.test.js');
  });

  it('una ruta que ya empieza por src/ se deja igual', () => {
    expect(normalizeNewPath('src/platform/config.json')).toBe('src/platform/config.json');
  });

  it('una ruta que empieza por platform/ se prefija con src/', () => {
    expect(normalizeNewPath('platform/extra.js')).toBe('src/platform/extra.js');
  });

  it('quita barras iniciales y recorta espacios', () => {
    expect(normalizeNewPath('  /calculator.js  ')).toBe('src/platform/code/calculator.js');
  });

  it('vacío devuelve vacío', () => {
    expect(normalizeNewPath('')).toBe('');
    expect(normalizeNewPath('   ')).toBe('');
  });
});

describe('pendingCreates / displayFiles / isPendingCreate', () => {
  const edits = [
    { path: 'src/platform/code/new.js', action: 'create', newContent: 'x' },
    { path: 'src/platform/code/existing.js', action: 'update', newContent: 'y', _originalContent: 'y' },
  ];

  it('pendingCreates solo lista los "create"', () => {
    expect(pendingCreates(edits)).toEqual(['src/platform/code/new.js']);
  });

  it('displayFiles añade los "create" que no están ya en la rama', () => {
    expect(displayFiles(['src/platform/code/existing.js'], edits)).toEqual([
      'src/platform/code/existing.js',
      'src/platform/code/new.js',
    ]);
  });

  it('displayFiles no duplica un "create" que YA está en la rama (recargado tras commit)', () => {
    expect(displayFiles(['src/platform/code/new.js'], edits)).toEqual(['src/platform/code/new.js']);
  });

  it('isPendingCreate refleja pendingCreates', () => {
    expect(isPendingCreate('src/platform/code/new.js', edits)).toBe(true);
    expect(isPendingCreate('src/platform/code/existing.js', edits)).toBe(false);
  });
});

describe('editStatusOf / isPathDirty', () => {
  it('sin edición en cola, editStatusOf es null y no está dirty', () => {
    expect(editStatusOf('a.js', [])).toBeNull();
    expect(isPathDirty('a.js', [])).toBe(false);
  });

  it('abrir un fichero (update no-dirty) no enciende el badge de editado', () => {
    const edits = [{ path: 'a.js', action: 'update', newContent: 'same', _originalContent: 'same' }];
    expect(editStatusOf('a.js', edits)).toEqual({ idx: 0, edit: edits[0] });
    expect(isPathDirty('a.js', edits)).toBe(false);
  });

  it('una edición real sí enciende el badge', () => {
    const edits = [{ path: 'a.js', action: 'update', newContent: 'changed', _originalContent: 'same' }];
    expect(isPathDirty('a.js', edits)).toBe(true);
  });
});

describe('isSandboxComplete', () => {
  it('el flag del servidor manda por encima de los pasos del run', () => {
    expect(isSandboxComplete({ steps: [] }, true)).toBe(true);
  });

  it('done o skipped en el paso "sandbox" cuenta como completo', () => {
    expect(isSandboxComplete({ steps: [{ name: 'sandbox', status: 'done' }] }, false)).toBe(true);
    expect(isSandboxComplete({ steps: [{ name: 'sandbox', status: 'skipped' }] }, false)).toBe(true);
  });

  it('running/awaiting_approval no cuenta como completo', () => {
    expect(isSandboxComplete({ steps: [{ name: 'sandbox', status: 'awaiting_approval' }] }, false)).toBe(false);
  });

  it('sin paso "sandbox" en el run, no está completo', () => {
    expect(isSandboxComplete({ steps: [] }, false)).toBe(false);
    expect(isSandboxComplete(null, false)).toBe(false);
  });
});

describe('buildCommitPayload', () => {
  it('incluye el MC solo si cambió', () => {
    const noChange = buildCommitPayload({ fmContent: 'a', initialFm: 'a', fileEdits: [] });
    expect(noChange.newModelUvl).toBeUndefined();

    const changed = buildCommitPayload({ fmContent: 'b', initialFm: 'a', fileEdits: [] });
    expect(changed.newModelUvl).toBe('b');
  });

  it('solo manda las ediciones dirty, sin _originalContent', () => {
    const payload = buildCommitPayload({
      fmContent: 'a',
      initialFm: 'a',
      fileEdits: [
        { path: 'x.js', action: 'update', newContent: 'v2', _originalContent: 'v1' },
        { path: 'y.js', action: 'update', newContent: 'same', _originalContent: 'same' },
      ],
    });
    expect(payload.fileEdits).toEqual([{ path: 'x.js', action: 'update', newContent: 'v2' }]);
  });

  it('sin ninguna edición dirty, fileEdits es undefined (no manda un array vacío)', () => {
    const payload = buildCommitPayload({ fmContent: 'a', initialFm: 'a', fileEdits: [] });
    expect(payload.fileEdits).toBeUndefined();
  });
});
