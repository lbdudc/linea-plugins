/**
 * Unit tests for the agent subsystem's deterministic cores.
 * No DB, no git host, no LLM — pure function coverage only.
 */
import { describe, it, expect } from 'vitest';

// ─── fmAnalysis ──────────────────────────────────────────────────────────────
import {
  extractFeaturesFromModel,
  computeMandatoryFeatures,
  findCouplingSmells,
  computePortfolioAnomalies,
  computePairCoverage,
} from '../../agents/tools/fmAnalysis.js';
import { parseFeatureModel } from '../../linea/featureModel.js';

// ─── sync ────────────────────────────────────────────────────────────────────
import { classifyLogs, classifyFiles } from '../../agents/tools/sync.js';

// ─── AgentPolicy.mergePolicy ──────────────────────────────────────────────────
import { mergePolicy, POLICY_DEFAULTS } from '../../agents/models/AgentPolicy.js';
import { mergeConfig, CONFIG_DEFAULTS } from '../../agents/models/AgentConfig.js';
import { cosineSimilarity } from '../../agents/memory/EmbeddingService.js';

// ─── proposalVersions ────────────────────────────────────────────────────────
import { withRecordedVersion, restoredBody } from '../../agents/core/proposalVersions.js';

// ═════════════════════════════════════════════════════════════════════════════
// extractFeaturesFromModel
// ═════════════════════════════════════════════════════════════════════════════
describe('extractFeaturesFromModel', () => {
  it('extracts identifiers from a UVL model, skipping keywords', () => {
    const modelStr = `
namespace MyLine
features
  Root {abstract}
    mandatory
      Auth
    optional
      Analytics
`;
    const features = extractFeaturesFromModel({ modelStr, type: 'UVL' });
    expect(features).toContain('Root');
    expect(features).toContain('Auth');
    expect(features).toContain('Analytics');
    expect(features).not.toContain('features');
    expect(features).not.toContain('mandatory');
    expect(features).not.toContain('optional');
    expect(features).not.toContain('namespace');
  });

  it('extracts names from an XML model', () => {
    const modelStr = `<FeatureModel>
  <Feature name="Root">
    <Feature name="Auth"/>
    <Feature name="DarkMode"/>
  </Feature>
</FeatureModel>`;
    const features = extractFeaturesFromModel({ modelStr, type: 'XML' });
    expect(features).toContain('Root');
    expect(features).toContain('Auth');
    expect(features).toContain('DarkMode');
  });

  it('defaults to UVL parsing when type is omitted', () => {
    const modelStr = 'features\n  Root\n    optional\n      Beta';
    const features = extractFeaturesFromModel({ modelStr });
    expect(features).toContain('Root');
    expect(features).toContain('Beta');
    expect(features).not.toContain('features');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// findCouplingSmells
// ═════════════════════════════════════════════════════════════════════════════
describe('computeMandatoryFeatures', () => {
  it('devuelve las features implicadas por una selección vacía', () => {
    const model = parseFeatureModel({
      content: `namespace MandatoryLine
features
  Root {abstract}
    mandatory
      Auth
    optional
      Analytics
`,
      type: 'UVL',
    });

    const { voidModel, mandatory } = computeMandatoryFeatures({ model });

    expect(voidModel).toBe(false);
    expect(mandatory).toContain('Root');
    expect(mandatory).toContain('Auth');
    expect(mandatory).not.toContain('Analytics');
  });

  it('marca voidModel cuando el modelo no admite ninguna configuración válida', () => {
    const model = parseFeatureModel({
      content: `namespace VoidLine
features
  Root {abstract}
    alternative
      A
      B
constraints
  A & B
`,
      type: 'UVL',
    });

    const { voidModel, mandatory } = computeMandatoryFeatures({ model });

    expect(voidModel).toBe(true);
    expect(mandatory).toEqual([]);
  });
});

describe('findCouplingSmells', () => {
  it('returns a pair that is always co-selected', () => {
    const verdicts = [
      { features: ['Auth', 'Analytics'] },
      { features: ['Auth', 'Analytics', 'DarkMode'] },
    ];
    const smells = findCouplingSmells(['Auth', 'Analytics', 'DarkMode'], verdicts);
    expect(smells).toContainEqual(['Auth', 'Analytics']);
  });

  it('does not flag a pair that appears separately', () => {
    const verdicts = [
      { features: ['Auth'] },
      { features: ['Analytics'] },
      { features: ['Auth', 'Analytics'] },
    ];
    const smells = findCouplingSmells(['Auth', 'Analytics'], verdicts);
    expect(smells).toHaveLength(0);
  });

  it('returns empty list when there are no products', () => {
    expect(findCouplingSmells(['Auth', 'Analytics'], [])).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// computePortfolioAnomalies
// ═════════════════════════════════════════════════════════════════════════════
describe('computePortfolioAnomalies', () => {
  const allFmFeatures = ['Root', 'Auth', 'Analytics', 'DarkMode', 'Beta'];
  const mandatory = ['Root'];

  it('identifies stranded features (in FM but no product selects)', () => {
    const validVerdicts = [
      { features: ['Root', 'Auth'] },
      { features: ['Root', 'Analytics'] },
    ];
    const { stranded } = computePortfolioAnomalies({ allFmFeatures, validVerdicts, mandatory });
    expect(stranded).toContain('DarkMode');
    expect(stranded).toContain('Beta');
    expect(stranded).not.toContain('Root');
    expect(stranded).not.toContain('Auth');
  });

  it('identifies zombie optionals (optional in FM, every valid product selects)', () => {
    const validVerdicts = [
      { features: ['Root', 'Auth', 'Analytics'] },
      { features: ['Root', 'Auth', 'Analytics', 'DarkMode'] },
    ];
    const { zombieOptionals } = computePortfolioAnomalies({ allFmFeatures, validVerdicts, mandatory });
    expect(zombieOptionals).toContain('Auth');
    expect(zombieOptionals).toContain('Analytics');
    expect(zombieOptionals).not.toContain('Root');
    expect(zombieOptionals).not.toContain('DarkMode');
  });

  it('returns selectedFeatures as a Set of all features used by valid products', () => {
    const validVerdicts = [{ features: ['Root', 'Auth'] }];
    const { selectedFeatures } = computePortfolioAnomalies({ allFmFeatures, validVerdicts, mandatory });
    expect(selectedFeatures.has('Root')).toBe(true);
    expect(selectedFeatures.has('Auth')).toBe(true);
    expect(selectedFeatures.has('Beta')).toBe(false);
  });

  it('returns empty stranded and zombieOptionals when there are no valid products', () => {
    const { stranded, zombieOptionals } = computePortfolioAnomalies({
      allFmFeatures,
      validVerdicts: [],
      mandatory,
    });
    expect(stranded).toHaveLength(allFmFeatures.length - mandatory.length);
    expect(zombieOptionals).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// computePairCoverage
// ═════════════════════════════════════════════════════════════════════════════
describe('computePairCoverage', () => {
  it('counts all unique pairs from a single product', () => {
    const sets = [new Set(['A', 'B', 'C'])];
    const { coveredPairs, totalPairs } = computePairCoverage(['A', 'B', 'C'], sets);
    // 3 features → 3 pairs: A-B, A-C, B-C
    expect(totalPairs).toBe(3);
    expect(coveredPairs.size).toBe(3);
  });

  it('merges pairs across multiple products without double-counting', () => {
    const sets = [new Set(['A', 'B']), new Set(['B', 'C'])];
    const { coveredPairs, totalPairs } = computePairCoverage(['A', 'B', 'C'], sets);
    expect(totalPairs).toBe(3);
    expect(coveredPairs.size).toBe(2); // A-B and B-C; A-C not covered
    expect(coveredPairs.has(['A', 'C'].sort().join('\x00'))).toBe(false);
  });

  it('returns 0 covered pairs for an empty product set', () => {
    const { coveredPairs } = computePairCoverage(['A', 'B'], []);
    expect(coveredPairs.size).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// classifyLogs
// ═════════════════════════════════════════════════════════════════════════════
describe('classifyLogs', () => {
  it('returns unknown when logs are empty', () => {
    expect(classifyLogs([])).toMatchObject({ status: 'unknown' });
    expect(classifyLogs(null)).toMatchObject({ status: 'unknown' });
  });

  it('returns ok when the last log is a success', () => {
    const logs = [
      { type: 'info', message: 'sync.start' },
      { type: 'success', message: 'sync.success' },
    ];
    expect(classifyLogs(logs)).toMatchObject({ status: 'ok' });
  });

  it('classifies a conflicts_merge_request key correctly', () => {
    const logs = [
      { type: 'info', message: 'sync.start' },
      {
        type: 'warning',
        message: 'error_messages.conflicts_merge_request',
        params: ['generation/1', 'main'],
        link: 'https://git.example.com/mr/1',
      },
    ];
    const result = classifyLogs(logs);
    expect(result.status).toBe('issue');
    expect(result.key).toBe('conflicts_merge_request');
    expect(result.mrUrl).toBe('https://git.example.com/mr/1');
  });

  it('classifies a missing_function_error', () => {
    const logs = [
      { type: 'error', message: 'error_messages.missing_function_error' },
    ];
    const result = classifyLogs(logs);
    expect(result.status).toBe('issue');
    expect(result.key).toBe('missing_function_error');
    expect(result.diagnosis.severity).toBe('error');
  });

  it('falls back to unknown when all logs are info', () => {
    const logs = [{ type: 'info', message: 'sync.start' }];
    expect(classifyLogs(logs)).toMatchObject({ status: 'unknown' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// classifyFiles
// ═════════════════════════════════════════════════════════════════════════════
describe('classifyFiles', () => {
  it('marks generator-owned files as theirs', () => {
    const { files, unambiguous } = classifyFiles([
      { path: 'src/components/MyWidget.vue' },
      { path: 'src/services/MyService.js' },
    ]);
    expect(files.every((f) => f.resolution === 'theirs')).toBe(true);
    expect(unambiguous).toBe(true);
  });

  it('marks README.md as ours (customization point)', () => {
    const { files, unambiguous } = classifyFiles([
      { path: 'README.md' },
    ]);
    expect(files[0].resolution).toBe('ours');
    expect(unambiguous).toBe(false);
  });

  it('marks .env as ours', () => {
    const { files } = classifyFiles([{ path: '.env' }]);
    expect(files[0].resolution).toBe('ours');
  });

  it('marks docker-compose.yml as ours', () => {
    const { files } = classifyFiles([{ path: 'docker-compose.yml' }]);
    expect(files[0].resolution).toBe('ours');
  });

  it('downgrades to ambiguous when even one customization is present', () => {
    const { unambiguous } = classifyFiles([
      { path: 'src/App.vue' },
      { path: 'README.md' },
    ]);
    expect(unambiguous).toBe(false);
  });

  it('returns unambiguous:false for an empty file list', () => {
    const { unambiguous } = classifyFiles([]);
    expect(unambiguous).toBe(false);
  });

  it('excludes .linea/** files from the classification entirely — not ours, not theirs', () => {
    const { files, unambiguous } = classifyFiles([
      { path: 'src/components/MyWidget.vue' },
      { path: '.linea/spec.json' },
    ]);
    expect(files.map((f) => f.path)).toEqual(['src/components/MyWidget.vue']);
    expect(files.some((f) => f.path === '.linea/spec.json')).toBe(false);
    expect(unambiguous).toBe(true);
  });

  it('a conflict where .linea/spec.json is the ONLY listed file resolves to unambiguous:false (nothing left to auto-resolve)', () => {
    const { files, unambiguous } = classifyFiles([{ path: '.linea/spec.json' }]);
    expect(files).toEqual([]);
    expect(unambiguous).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// mergePolicy
// ═════════════════════════════════════════════════════════════════════════════
describe('mergePolicy', () => {
  it('uses system defaults when no product or line policy provided', () => {
    const policy = mergePolicy(null, null);
    expect(policy).toEqual(POLICY_DEFAULTS);
  });

  it('uses line values over defaults', () => {
    const line = { criticality: 'critical', modes: { sync: 'automatic' } };
    const policy = mergePolicy(null, line);
    expect(policy.criticality).toBe('critical');
    expect(policy.modes.sync).toBe('automatic');
    expect(policy.modes.harvest).toBe('semi');
  });

  it('uses product values over line values', () => {
    const line = { criticality: 'critical', modes: { sync: 'automatic' } };
    const product = { criticality: 'normal', modes: { sync: 'propose_and_wait' } };
    const policy = mergePolicy(product, line);
    expect(policy.criticality).toBe('normal');
    expect(policy.modes.sync).toBe('manual');
  });

  it('falls through partial product to line for unspecified modes', () => {
    const line = { modes: { harvest: 'automatic' } };
    const product = { modes: { sync: 'automatic' } };
    const policy = mergePolicy(product, line);
    expect(policy.modes.sync).toBe('automatic');
    expect(policy.modes.harvest).toBe('automatic');
    expect(policy.modes.evolution).toBe('semi');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// mergeConfig
// ═════════════════════════════════════════════════════════════════════════════
describe('mergeConfig', () => {
  it('uses system defaults when no product or line config provided', () => {
    expect(mergeConfig(null, null)).toEqual(CONFIG_DEFAULTS);
  });

  it('uses line values over defaults', () => {
    const line = { enabled: false, instructions: 'be careful', triggers: { webhook: false } };
    const config = mergeConfig(null, line);
    expect(config.enabled).toBe(false);
    expect(config.instructions).toBe('be careful');
    expect(config.triggers.webhook).toBe(false);
    expect(config.triggers.schedule).toBeNull();
  });

  it('uses product values over line values', () => {
    const line = { enabled: false, instructions: 'line note' };
    const product = { enabled: true, instructions: 'product note' };
    const config = mergeConfig(product, line);
    expect(config.enabled).toBe(true);
    expect(config.instructions).toBe('product note');
  });

  it('deep-merges defaultInput with product winning per key', () => {
    const line = { defaultInput: { mode: 'migration', featureName: 'Auth' } };
    const product = { defaultInput: { mode: 'impact' } };
    const config = mergeConfig(product, line);
    expect(config.defaultInput).toEqual({ mode: 'impact', featureName: 'Auth' });
  });

  it('defaults memory scope to product_line read and run write', () => {
    const config = mergeConfig(null, null);
    expect(config.memoryRead).toBe('product_line');
    expect(config.memoryWrite).toBe('run');
  });

  it('resolves memory scope product over line over defaults', () => {
    const line = { memoryRead: 'product', memoryWrite: 'line' };
    const product = { memoryWrite: 'off' };
    const config = mergeConfig(product, line);
    expect(config.memoryRead).toBe('product'); // inherited from line
    expect(config.memoryWrite).toBe('off'); // product overrides line
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// cosineSimilarity
// ═════════════════════════════════════════════════════════════════════════════
describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('ranks a closer vector higher than a farther one', () => {
    const query = [1, 1, 0];
    const near = cosineSimilarity(query, [1, 1, 0.1]);
    const far = cosineSimilarity(query, [-1, -1, 0]);
    expect(near).toBeGreaterThan(far);
  });

  it('returns 0 on length mismatch or empty input', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [1])).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// proposalVersions
// ═════════════════════════════════════════════════════════════════════════════
describe('withRecordedVersion', () => {
  it('appends current body to an empty version history', () => {
    const body = { plan: 'first plan' };
    const versions = withRecordedVersion(body, 'v1');
    expect(versions).toHaveLength(1);
    expect(versions[0].label).toBe('v1');
    expect(versions[0].body).toMatchObject({ plan: 'first plan' });
    expect(versions[0].body.versions).toBeUndefined();
  });

  it('strips nested versions from the snapshot', () => {
    const body = { plan: 'latest', versions: [{ label: 'v0', body: {} }] };
    const versions = withRecordedVersion(body, 'v1');
    expect(versions).toHaveLength(2); // prior v0 + new snapshot of current
    expect(versions[1].body.versions).toBeUndefined();
  });

  it('auto-generates a label when none is given', () => {
    const versions = withRecordedVersion({ plan: 'x' }, '');
    expect(versions[0].label).toMatch(/^v\d+$/);
  });
});

describe('restoredBody', () => {
  it('restores a prior version and records the displaced body', () => {
    const body = {
      plan: 'v2 plan',
      versions: [
        { label: 'v1', at: new Date(), body: { plan: 'v1 plan' } },
      ],
    };
    const restored = restoredBody(body, 0, 'current');
    expect(restored.plan).toBe('v1 plan');
    expect(Array.isArray(restored.versions)).toBe(true);
    expect(restored.versions.length).toBeGreaterThan(0);
  });

  it('throws when the requested version index does not exist', () => {
    expect(() => restoredBody({ versions: [] }, 5, 'x')).toThrow('Version not found');
  });
});
