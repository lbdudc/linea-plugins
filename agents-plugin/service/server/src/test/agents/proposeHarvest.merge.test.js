/**
 * Unit tests for the Harvest merge synthesis path in proposeHarvest.js.
 * The tool loop is stubbed, so no git host or LLM calls are made.
 */
import { describe, it, expect } from 'vitest';
import { buildMergeMessage, runHarvestProposal } from '../../agents/harvest/proposeHarvest.js';

const model = { type: 'UVL', content: 'features\n    Root\n        mandatory\n            Core' };

const sources = [
  {
    title: 'Harvest: add optional feature Alerting',
    plan: {
      changeType: 'new-optional-feature',
      featureName: 'Alerting',
      newModelUvl: 'features\n    Root\n        optional\n            Alerting',
      fileEdits: [{ path: 'src/platform/alerts.js', action: 'create', newContent: 'export const alert = () => {};' }],
      reasoning: 'new capability',
    },
  },
  {
    title: 'Harvest: extend feature Api',
    plan: {
      changeType: 'extend-existing-feature',
      featureName: 'Api',
      fileEdits: [{ path: 'src/platform/api.js', action: 'create', newContent: 'export const retry = () => {};' }],
      reasoning: 'extends api',
    },
  },
];

describe('buildMergeMessage', () => {
  const msg = buildMergeMessage({ model, sources, directive: 'Fold both into one feature named Observability.' });

  it('includes the operator merge directive verbatim', () => {
    expect(msg).toContain('## Operator merge directive');
    expect(msg).toContain('Fold both into one feature named Observability.');
  });

  it('includes the current line feature model', () => {
    expect(msg).toContain(model.content);
  });

  it('lists every source proposal and its file edits', () => {
    expect(msg).toContain('## Source proposal 1: Harvest: add optional feature Alerting');
    expect(msg).toContain('## Source proposal 2: Harvest: extend feature Api');
    expect(msg).toContain('src/platform/alerts.js');
    expect(msg).toContain('src/platform/api.js');
  });

  it('falls back to guidance text when no directive is given', () => {
    const bare = buildMergeMessage({ model, sources, directive: '' });
    expect(bare).toContain('use your best judgement');
  });
});

describe('runHarvestProposal merge mode', () => {
  it('synthesizes one unified plan from the merge message and backfills oldContent', async () => {
    let seen = null;
    const loopRunner = async ({ messages, executeTool }) => {
      seen = messages[0].content;
      await executeTool('propose_harvest', {
        harvestable: true,
        changeType: 'new-optional-feature',
        featureName: 'Observability',
        newModelUvl: 'features\n    Root\n        optional\n            Observability',
        fileEdits: [
          { path: 'src/platform/observability.js', action: 'create', newContent: 'export const obs = () => {};' },
        ],
        reasoning: 'merged alerting + api',
      });
    };

    const result = await runHarvestProposal({
      token: 't',
      lineProjectId: 'p',
      detect: { model },
      merge: { sources, directive: 'Fold both into one feature named Observability.' },
      loopRunner,
    });

    // The loop received the merge message (not the single-product message).
    expect(seen).toContain('## Merge task');
    expect(seen).toContain('Observability');

    expect(result.harvestable).toBe(true);
    expect(result.featureName).toBe('Observability');
    expect(result.fileEdits).toHaveLength(1);
    // 'create' edits get an empty oldContent without any repo read.
    expect(result.fileEdits[0].oldContent).toBe('');
  });
});
