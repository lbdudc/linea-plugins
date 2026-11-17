import { describe, expect, it } from 'vitest';

import {
  canSplitMergedRun,
  filterCandidates,
  groupHarvestRunsByColumn,
  hasReviewProposal,
  isMergeableReviewRun,
  isMergedRun,
  isSuppressingDisposition,
  launchedProductIds,
  mergeSourceCount,
  resolvedDispositions,
  riskParts,
  runChangeType,
  runProductNameParts,
  runSignature,
  suppressedSignatures,
} from '../../../../../../client/agents/components/consoles/harvest/harvestBoard.js';

describe('isSuppressingDisposition', () => {
  it('suprime dismissed y manually-harvested siempre', () => {
    expect(isSuppressingDisposition({ state: 'dismissed' })).toBe(true);
    expect(isSuppressingDisposition({ state: 'manually-harvested' })).toBe(true);
  });

  it('snoozed suprime solo mientras snoozeUntil no haya pasado', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    expect(isSuppressingDisposition({ state: 'snoozed', snoozeUntil: '2026-01-20' }, now)).toBe(true);
    expect(isSuppressingDisposition({ state: 'snoozed', snoozeUntil: '2026-01-01' }, now)).toBe(false);
  });

  it('snoozed sin fecha no suprime (dato corrupto, falla a favor de mostrar la candidata)', () => {
    expect(isSuppressingDisposition({ state: 'snoozed' })).toBe(false);
  });

  it('cualquier otro estado no suprime', () => {
    expect(isSuppressingDisposition({ state: 'restored' })).toBe(false);
    expect(isSuppressingDisposition(null)).toBe(false);
  });
});

describe('suppressedSignatures / resolvedDispositions', () => {
  const now = new Date('2026-01-10T00:00:00Z');
  const dispositions = [
    { signature: 'a', state: 'dismissed' },
    { signature: 'b', state: 'snoozed', snoozeUntil: '2026-01-01' },
    { signature: 'c', state: 'snoozed', snoozeUntil: '2026-02-01' },
  ];

  it('solo incluye las disposiciones activas ahora mismo', () => {
    expect(suppressedSignatures(dispositions, now)).toEqual(new Set(['a', 'c']));
    expect(resolvedDispositions(dispositions, now).map((d) => d.signature)).toEqual(['a', 'c']);
  });
});

describe('launchedProductIds', () => {
  it('incluye productos con un run no cancelado, excluye los cancelados', () => {
    const runs = [
      { status: 'queued', scope: { productId: 'p1' } },
      { status: 'cancelled', scope: { productId: 'p2' } },
      { status: 'done', scope: { productId: 'p3' } },
    ];
    expect(launchedProductIds(runs)).toEqual(new Set(['p1', 'p3']));
  });
});

describe('filterCandidates', () => {
  const candidates = [
    { signature: 'c1', representativeProductId: 'p1', suggestedType: 'new-optional-feature', productCount: 1 },
    { signature: 'c2', representativeProductId: 'p2', suggestedType: 'bugfix-to-generated', productCount: 3 },
    { signature: 'c3', representativeProductId: 'p3', suggestedType: 'ambiguous', productCount: 2 },
  ];

  it('sin filtros activos devuelve todo lo no lanzado/suprimido', () => {
    expect(filterCandidates({ candidates }).map((c) => c.signature)).toEqual(['c1', 'c2', 'c3']);
  });

  it('descarta candidatas cuyo producto representativo ya tiene un harvest lanzado', () => {
    const out = filterCandidates({ candidates, launchedIds: new Set(['p2']) });
    expect(out.map((c) => c.signature)).toEqual(['c1', 'c3']);
  });

  it('descarta candidatas con disposición activa (firma suprimida)', () => {
    const out = filterCandidates({ candidates, suppressedSigs: new Set(['c1']) });
    expect(out.map((c) => c.signature)).toEqual(['c2', 'c3']);
  });

  it('filtra por tipo de cambio cuando hay tipos seleccionados', () => {
    const out = filterCandidates({ candidates, filterTypes: ['bugfix-to-generated', 'ambiguous'] });
    expect(out.map((c) => c.signature)).toEqual(['c2', 'c3']);
  });

  it('exige el mínimo de corroboración', () => {
    const out = filterCandidates({ candidates, minCorroboration: 2 });
    expect(out.map((c) => c.signature)).toEqual(['c2', 'c3']);
  });

  it('combina todos los filtros a la vez (orden del original: lanzadas → suprimidas → tipo → corroboración)', () => {
    const out = filterCandidates({
      candidates,
      launchedIds: new Set(['p3']),
      suppressedSigs: new Set(['c1']),
      minCorroboration: 2,
    });
    expect(out.map((c) => c.signature)).toEqual(['c2']);
  });
});

describe('groupHarvestRunsByColumn', () => {
  it('agrupa por status en las tres columnas del pipeline', () => {
    const runs = [
      { _id: 'r1', status: 'queued' },
      { _id: 'r2', status: 'running' },
      { _id: 'r3', status: 'awaiting_approval' },
      { _id: 'r4', status: 'done' },
      { _id: 'r5', status: 'failed' },
      { _id: 'r6', status: 'cancelled' },
    ];
    const cols = groupHarvestRunsByColumn(runs);
    expect(cols.proposed.map((r) => r._id)).toEqual(['r1', 'r2']);
    expect(cols.review.map((r) => r._id)).toEqual(['r3']);
    expect(cols.merged.map((r) => r._id)).toEqual(['r4', 'r5', 'r6']);
  });

  it('un status desconocido no aparece en ninguna columna (ni se pierde el resto)', () => {
    const runs = [{ _id: 'r1', status: 'weird' }, { _id: 'r2', status: 'done' }];
    const cols = groupHarvestRunsByColumn(runs);
    expect(cols.proposed).toEqual([]);
    expect(cols.review).toEqual([]);
    expect(cols.merged.map((r) => r._id)).toEqual(['r2']);
  });
});

describe('runProductNameParts', () => {
  it('lee el nombre del último paso detect-changes con outputSummary', () => {
    const run = {
      scope: { productId: 'p1' },
      steps: [
        { name: 'detect-changes', outputSummary: { productName: 'viejo' } },
        { name: 'detect-changes', outputSummary: { productName: 'nuevo' } },
        { name: 'propose-harvest', outputSummary: { productName: 'no-cuenta' } },
      ],
    };
    expect(runProductNameParts(run)).toEqual({ productName: 'nuevo', productId: 'p1' });
  });

  it('sin paso detect-changes con outputSummary, devuelve productId para que el componente formatee el hueco', () => {
    const run = { scope: { productId: 'p9' }, steps: [] };
    expect(runProductNameParts(run)).toEqual({ productName: null, productId: 'p9' });
  });
});

describe('runChangeType', () => {
  it('prioriza result.changeType sobre propuestas y pasos', () => {
    const run = {
      result: { changeType: 'from-result' },
      proposals: [{ body: { changeType: 'from-proposal' } }],
      steps: [{ outputSummary: { changeType: 'from-step' } }],
    };
    expect(runChangeType(run)).toBe('from-result');
  });

  it('si no hay result, usa la primera propuesta con changeType', () => {
    const run = { proposals: [{ body: {} }, { body: { changeType: 'from-proposal' } }] };
    expect(runChangeType(run)).toBe('from-proposal');
  });

  it('si no hay result ni propuesta, cae al último paso con changeType', () => {
    const run = {
      steps: [
        { outputSummary: { changeType: 'first' } },
        { outputSummary: { changeType: 'last' } },
      ],
    };
    expect(runChangeType(run)).toBe('last');
  });

  it('sin ninguna fuente, null', () => {
    expect(runChangeType({})).toBeNull();
  });
});

describe('hasReviewProposal', () => {
  it('true con un fm_patch sin decidir y con fileEdits', () => {
    const run = { proposals: [{ kind: 'fm_patch', decision: null, body: { fileEdits: ['a.js'] } }] };
    expect(hasReviewProposal(run)).toBe(true);
  });

  it('true con un fm_patch sin decidir y con newModelUvl (sin fileEdits)', () => {
    const run = { proposals: [{ kind: 'fm_patch', decision: null, body: { newModelUvl: 'model' } }] };
    expect(hasReviewProposal(run)).toBe(true);
  });

  it('false si el fm_patch ya tiene decisión', () => {
    const run = { proposals: [{ kind: 'fm_patch', decision: 'approved', body: { fileEdits: ['a.js'] } }] };
    expect(hasReviewProposal(run)).toBe(false);
  });

  it('false con un fm_patch vacío (sin fileEdits ni newModelUvl) — metadatos, no propuesta revisable', () => {
    const run = { proposals: [{ kind: 'fm_patch', decision: null, body: {} }] };
    expect(hasReviewProposal(run)).toBe(false);
  });

  it('merge_resolution exige fileEdits (newModelUvl no basta)', () => {
    const run = { proposals: [{ kind: 'merge_resolution', decision: null, body: { newModelUvl: 'x' } }] };
    expect(hasReviewProposal(run)).toBe(false);
  });
});

describe('runSignature', () => {
  it('lee input.steering.signature', () => {
    expect(runSignature({ input: { steering: { signature: 'sig-1' } } })).toBe('sig-1');
  });
  it('sin steering, null', () => {
    expect(runSignature({})).toBeNull();
  });
});

describe('runs fusionados', () => {
  it('isMergedRun / mergeSourceCount / canSplitMergedRun', () => {
    const merged = { input: { merge: { sourceRunIds: ['a', 'b', 'c'] } }, status: 'awaiting_approval' };
    expect(isMergedRun(merged)).toBe(true);
    expect(mergeSourceCount(merged)).toBe(3);
    expect(canSplitMergedRun(merged)).toBe(true);

    const done = { ...merged, status: 'done' };
    expect(canSplitMergedRun(done)).toBe(false);

    const plain = { status: 'awaiting_approval' };
    expect(isMergedRun(plain)).toBe(false);
    expect(mergeSourceCount(plain)).toBe(0);
  });

  it('isMergeableReviewRun exige awaiting_approval y que no sea ya un merge', () => {
    expect(isMergeableReviewRun({ status: 'awaiting_approval' })).toBe(true);
    expect(isMergeableReviewRun({ status: 'awaiting_approval', input: { merge: { sourceRunIds: ['a'] } } })).toBe(false);
    expect(isMergeableReviewRun({ status: 'done' })).toBe(false);
  });
});

describe('riskParts', () => {
  it('sin riesgo, lista vacía', () => {
    expect(riskParts(null)).toEqual([]);
  });

  it('incluye highTouch solo si hay ficheros', () => {
    expect(riskParts({ highTouch: ['Dockerfile'] })).toEqual([{ kind: 'highTouch', files: ['Dockerfile'] }]);
    expect(riskParts({ highTouch: [] })).toEqual([]);
  });

  it('incluye sharedWith solo si es mayor que cero', () => {
    expect(riskParts({ sharedWith: 2 })).toEqual([{ kind: 'sharedWith', n: 2 }]);
    expect(riskParts({ sharedWith: 0 })).toEqual([]);
  });

  it('puede traer ambas partes a la vez, en orden highTouch → sharedWith', () => {
    expect(riskParts({ highTouch: ['a'], sharedWith: 1 })).toEqual([
      { kind: 'highTouch', files: ['a'] },
      { kind: 'sharedWith', n: 1 },
    ]);
  });
});
