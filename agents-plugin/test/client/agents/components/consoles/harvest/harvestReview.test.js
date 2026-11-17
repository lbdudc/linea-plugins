import { describe, expect, it, vi } from 'vitest';

import { buildFileList, buildPatchFiles, buildReclassifyMessage, diffStats, seedChatFromSteps } from '../../../../../../client/agents/components/consoles/harvest/harvestReview.js';

describe('diffStats', () => {
  it('cuenta líneas añadidas y borradas, no las de contexto', () => {
    expect(diffStats('a\nb\nc', 'a\nx\nc')).toEqual({ added: 1, deleted: 1 });
  });

  it('sin cambios, cero y cero', () => {
    expect(diffStats('a\nb', 'a\nb')).toEqual({ added: 0, deleted: 0 });
  });

  it('fichero nuevo (old vacío) cuenta las líneas nuevas como añadidas (más el borrado de la línea vacía inicial de split)', () => {
    expect(diffStats('', 'a\nb')).toEqual({ added: 2, deleted: 1 });
  });
});

describe('buildPatchFiles', () => {
  it('sin body, lista vacía', () => {
    expect(buildPatchFiles(null)).toEqual([]);
  });

  it('el modelo de características va primero cuando hay newModelUvl', () => {
    const body = {
      newModelUvl: 'features\n  Foo',
      fmOld: 'features',
      modelPath: 'model.uvl',
      fileEdits: [{ path: 'src/foo.js', oldContent: 'a', newContent: 'b' }],
    };
    const files = buildPatchFiles(body);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ key: '__fm__', isFeatureModel: true, path: 'model.uvl', action: 'update' });
    expect(files[1]).toMatchObject({ key: 'src/foo.js', isFeatureModel: false, path: 'src/foo.js' });
  });

  it('sin newModelUvl, no hay fila de modelo', () => {
    const body = { fileEdits: [{ path: 'a.js', oldContent: '1', newContent: '2' }] };
    expect(buildPatchFiles(body).every((f) => !f.isFeatureModel)).toBe(true);
  });

  it('cada fileEdit trae su action y confidence (o "ai" por defecto)', () => {
    const body = {
      fileEdits: [
        { path: 'a.js', action: 'create', oldContent: '', newContent: 'x', confidence: 'exact' },
        { path: 'b.js', oldContent: 'x', newContent: 'y' },
      ],
    };
    const files = buildPatchFiles(body);
    expect(files[0]).toMatchObject({ action: 'create', confidence: 'exact' });
    expect(files[1]).toMatchObject({ action: 'update', confidence: 'ai' });
  });

  it('theirsContent vacío o null no cuenta como "theirs" disponible (three-way se desactiva)', () => {
    const body = {
      fileEdits: [
        { path: 'a.js', oldContent: '1', newContent: '2', theirsContent: '' },
        { path: 'b.js', oldContent: '1', newContent: '2', theirsContent: null },
        { path: 'c.js', oldContent: '1', newContent: '2', theirsContent: 'generado' },
      ],
    };
    const files = buildPatchFiles(body);
    expect(files.map((f) => f.theirs)).toEqual([null, null, 'generado']);
  });

  it('cada fila trae sus estadísticas de diff', () => {
    const body = { fileEdits: [{ path: 'a.js', oldContent: 'a\nb', newContent: 'a\nc\nd' }] };
    expect(buildPatchFiles(body)[0].stats).toEqual({ added: 2, deleted: 1 });
  });
});

describe('buildFileList', () => {
  it('sin body, lista vacía', () => {
    expect(buildFileList(null, [])).toEqual([]);
  });

  it('antepone la fila de resumen solo si hay markdown', () => {
    const patchFiles = [{ key: 'a.js' }];
    expect(buildFileList({ markdown: '# Plan' }, patchFiles)[0]).toMatchObject({ key: '__overview__', isOverview: true });
    expect(buildFileList({}, patchFiles)[0]).toBe(patchFiles[0]);
  });
});

describe('buildReclassifyMessage', () => {
  const translateDirective = (ty) => `tipo:${ty}`;
  const translateTargeting = (f) => `objetivo:${f}`;
  const translateSuffix = () => 'revisa';

  it('null cuando no se eligió ni tipo ni funcionalidad — nada que pedir', () => {
    expect(buildReclassifyMessage({ changeType: null, targetFeature: null, translateDirective, translateTargeting, translateSuffix })).toBeNull();
  });

  it('con solo tipo, compone directiva + sufijo', () => {
    expect(
      buildReclassifyMessage({ changeType: 'bugfix-to-generated', targetFeature: null, translateDirective, translateTargeting, translateSuffix }),
    ).toBe('tipo:bugfix-to-generated. revisa');
  });

  it('con tipo y funcionalidad, junta ambas partes antes del sufijo', () => {
    expect(
      buildReclassifyMessage({ changeType: 'extend-existing-feature', targetFeature: 'Alerting', translateDirective, translateTargeting, translateSuffix }),
    ).toBe('tipo:extend-existing-feature objetivo:Alerting. revisa');
  });

  it('con solo funcionalidad (sin tipo), no llama a translateDirective', () => {
    const directive = vi.fn();
    const msg = buildReclassifyMessage({ changeType: null, targetFeature: 'Alerting', translateDirective: directive, translateTargeting, translateSuffix });
    expect(directive).not.toHaveBeenCalled();
    expect(msg).toBe('objetivo:Alerting. revisa');
  });
});

describe('seedChatFromSteps', () => {
  const translateRevised = () => 'Propuesta actualizada';

  it('ignora pasos que no son "refine"', () => {
    const steps = [{ name: 'detect-changes', inputSummary: 'x' }];
    expect(seedChatFromSteps(steps, translateRevised)).toEqual([]);
  });

  it('un refine con inputSummary aporta el turno del operador', () => {
    const steps = [{ name: 'refine', inputSummary: 'usa snake_case' }];
    expect(seedChatFromSteps(steps, translateRevised)).toEqual([{ role: 'user', content: 'usa snake_case' }]);
  });

  it('outputSummary.revised añade la respuesta traducida, no la nota', () => {
    const steps = [{ name: 'refine', inputSummary: 'pide algo', outputSummary: { revised: true, note: 'ignorada' } }];
    expect(seedChatFromSteps(steps, translateRevised)).toEqual([
      { role: 'user', content: 'pide algo' },
      { role: 'assistant', content: 'Propuesta actualizada' },
    ]);
  });

  it('sin revised pero con note, usa la nota literal del agente', () => {
    const steps = [{ name: 'refine', outputSummary: { note: 'no encontré esa función' } }];
    expect(seedChatFromSteps(steps, translateRevised)).toEqual([{ role: 'assistant', content: 'no encontré esa función' }]);
  });

  it('varios refine seguidos preservan el orden', () => {
    const steps = [
      { name: 'refine', inputSummary: 'primero' },
      { name: 'refine', inputSummary: 'segundo', outputSummary: { revised: true } },
    ];
    expect(seedChatFromSteps(steps, translateRevised).map((m) => m.content)).toEqual(['primero', 'segundo', 'Propuesta actualizada']);
  });
});
