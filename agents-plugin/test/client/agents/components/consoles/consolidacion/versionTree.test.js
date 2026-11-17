import { describe, expect, it } from 'vitest';

import {
  BULLET_X,
  buildConnectors,
  buildPositions,
  buildRows,
  hasChildrenOf,
  isVersionLocked,
  lockedVersionIds,
} from '../../../../../../client/agents/components/consoles/consolidacion/versionTree.js';

const v = (id, epoch, minor, parentVersionId = null, status = 'draft') => ({
  _id: id,
  epoch,
  minor,
  parentVersionId,
  status,
});

describe('hasChildrenOf', () => {
  it('sin hijos, false', () => {
    expect(hasChildrenOf([v('a', 1, 1)], 'a')).toBe(false);
  });

  it('con al menos un hijo, true', () => {
    expect(hasChildrenOf([v('a', 1, 1), v('b', 1, 2, 'a')], 'a')).toBe(true);
  });
});

describe('lockedVersionIds', () => {
  it('sin ninguna fusionada en la época, nada bloqueado', () => {
    const versions = [v('a', 1, 1), v('b', 1, 2, 'a')];
    expect(lockedVersionIds(versions)).toEqual(new Set());
  });

  it('una fusionada bloquea a las demás de la MISMA época', () => {
    const versions = [v('a', 1, 1, null, 'merged'), v('b', 1, 2, null, 'draft'), v('c', 1, 3, null, 'sandbox')];
    expect(lockedVersionIds(versions)).toEqual(new Set(['b', 'c']));
  });

  it('las archivadas no se bloquean', () => {
    const versions = [v('a', 1, 1, null, 'merged'), v('b', 1, 2, null, 'archived')];
    expect(lockedVersionIds(versions)).toEqual(new Set());
  });

  it('épocas posteriores no se ven afectadas', () => {
    const versions = [v('a', 1, 1, null, 'merged'), v('b', 2, 1, null, 'draft')];
    expect(lockedVersionIds(versions)).toEqual(new Set());
  });
});

describe('isVersionLocked', () => {
  const versions = [v('a', 1, 1, null, 'merged'), v('b', 1, 2, null, 'draft')];

  it('coincide con lockedVersionIds para una versión bloqueada', () => {
    expect(isVersionLocked(versions, v('b', 1, 2, null, 'draft'))).toBe(true);
  });

  it('la propia versión fusionada nunca está "bloqueada" — está cerrada, no en espera', () => {
    expect(isVersionLocked(versions, v('a', 1, 1, null, 'merged'))).toBe(false);
  });

  it('sin versión seleccionada, false', () => {
    expect(isVersionLocked(versions, null)).toBe(false);
  });
});

describe('buildRows', () => {
  it('épocas más recientes primero', () => {
    const versions = [v('a', 1, 1), v('b', 2, 1)];
    const rows = buildRows(versions, new Set());
    expect(rows.filter((r) => r.kind === 'header').map((r) => r.epoch)).toEqual([2, 1]);
  });

  it('dentro de una época, profundidad primero — el hijo sigue justo a su padre', () => {
    const versions = [v('a', 1, 1), v('b', 1, 2, 'a'), v('c', 1, 3)];
    const rows = buildRows(versions, new Set());
    const nodeIds = rows.filter((r) => r.kind === 'node').map((r) => r.version._id);
    expect(nodeIds).toEqual(['a', 'b', 'c']);
    expect(rows.find((r) => r.kind === 'node' && r.version._id === 'b').depth).toBe(1);
  });

  it('ordena hermanos por minor', () => {
    const versions = [v('b', 1, 2), v('a', 1, 1)];
    const rows = buildRows(versions, new Set());
    expect(rows.filter((r) => r.kind === 'node').map((r) => r.version._id)).toEqual(['a', 'b']);
  });

  it('un padre colapsado oculta a toda su subrama', () => {
    const versions = [v('a', 1, 1), v('b', 1, 2, 'a'), v('c', 1, 3, 'b')];
    const rows = buildRows(versions, new Set(['a']));
    const nodeIds = rows.filter((r) => r.kind === 'node').map((r) => r.version._id);
    expect(nodeIds).toEqual(['a']);
    expect(rows.find((r) => r.version?._id === 'a').collapsed).toBe(true);
  });

  it('un parentVersionId que apunta fuera de esta época se trata como raíz (fork entre épocas)', () => {
    const versions = [v('a', 1, 1), v('b', 2, 1, 'a')];
    const rows = buildRows(versions, new Set());
    const nodeB = rows.find((r) => r.kind === 'node' && r.version._id === 'b');
    expect(nodeB.depth).toBe(0);
  });
});

describe('buildPositions + buildConnectors', () => {
  it('cada nodo visible tiene una posición, indentada según su profundidad', () => {
    const versions = [v('a', 1, 1), v('b', 1, 2, 'a')];
    const rows = buildRows(versions, new Set());
    const positions = buildPositions(rows);
    expect(positions.get('a').x).toBe(BULLET_X);
    expect(positions.get('b').x).toBeGreaterThan(positions.get('a').x);
  });

  it('genera un conector por cada arista padre-hijo visible', () => {
    const versions = [v('a', 1, 1), v('b', 1, 2, 'a'), v('c', 1, 3, 'a')];
    const rows = buildRows(versions, new Set());
    const positions = buildPositions(rows);
    const connectors = buildConnectors(rows, positions);
    expect(connectors).toHaveLength(2);
    expect(connectors.map((c) => c.key).sort()).toEqual(['a->b', 'a->c']);
  });

  it('no genera conector hacia un padre oculto por colapso', () => {
    const versions = [v('a', 1, 1), v('b', 1, 2, 'a'), v('c', 1, 3, 'b')];
    const rows = buildRows(versions, new Set(['a']));
    const positions = buildPositions(rows);
    expect(buildConnectors(rows, positions)).toEqual([]);
  });
});
