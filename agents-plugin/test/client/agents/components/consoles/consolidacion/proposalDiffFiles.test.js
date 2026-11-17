import { describe, expect, it } from 'vitest';

import { buildProposalDiffFiles } from '../../../../../../client/agents/components/consoles/consolidacion/proposalDiffFiles.js';

describe('buildProposalDiffFiles', () => {
  it('sin newModelUvl ni fileEdits, lista vacía', () => {
    expect(buildProposalDiffFiles({})).toEqual([]);
  });

  it('el modelo de características va primero, con el "antes" que se le pase', () => {
    const files = buildProposalDiffFiles({
      newModelUvl: 'features\n  Foo',
      fmLabel: 'Modelo de características',
      fmPath: 'model.uvl',
      fmOld: 'features',
      fileEdits: [{ path: 'src/a.js', oldContent: '1', newContent: '2' }],
    });
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ key: '__fm__', old: 'features', new: 'features\n  Foo', path: 'model.uvl' });
    expect(files[1]).toMatchObject({ key: 'src/a.js', path: 'src/a.js' });
  });

  it('sin fmOld explícito, el "antes" del modelo es cadena vacía (caso VersionChatPanel)', () => {
    const files = buildProposalDiffFiles({ newModelUvl: 'features', fmLabel: 'MC' });
    expect(files[0].old).toBe('');
  });

  it('sin newModelUvl, no hay fila de modelo', () => {
    const files = buildProposalDiffFiles({ fileEdits: [{ path: 'a.js', oldContent: '1', newContent: '2' }] });
    expect(files.every((f) => f.key !== '__fm__')).toBe(true);
  });

  it('cada fileEdit trae su action (o "update" por defecto)', () => {
    const files = buildProposalDiffFiles({
      fileEdits: [
        { path: 'a.js', action: 'create', oldContent: '', newContent: 'x' },
        { path: 'b.js', oldContent: 'x', newContent: 'y' },
      ],
    });
    expect(files[0].action).toBe('create');
    expect(files[1].action).toBe('update');
  });
});
