import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Memory capture — the substance Workstream 2 adds. `captureDecision` /
 * `captureRunOutcome` must name the files / change type / resolution shape (not just a
 * title), and `captureDisposition` must turn an operator's triage into a line-scoped
 * lesson. Exercised with a fake repository (embeddings disabled), so no DB, embedding
 * service or Anthropic API is required.
 */

const added = [];

vi.mock('typedi', () => {
  const store = new Map();
  return { Container: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) } };
});

vi.mock('../../agents/memory/EmbeddingService.js', () => {
  class EmbeddingService { enabled = false; model = 'test'; async embed() { return null; } }
  return { default: EmbeddingService, cosineSimilarity: () => 0 };
});

vi.mock('../../agents/models/AgentMemoryRepository.js', () => {
  class AgentMemoryRepository {
    async add(doc) { const saved = { ...doc, _id: `m${added.length + 1}` }; added.push(saved); return saved; }
  }
  return { default: AgentMemoryRepository };
});

vi.mock('../../agents/core/llm.js', () => ({ complete: async () => ({ text: 'YES' }) }));

const { Container } = await import('typedi');
const EmbeddingService = (await import('../../agents/memory/EmbeddingService.js')).default;
const AgentMemoryRepository = (await import('../../agents/models/AgentMemoryRepository.js')).default;
Container.set(EmbeddingService, new EmbeddingService());
Container.set(AgentMemoryRepository, new AgentMemoryRepository());

const MemoryService = (await import('../../agents/memory/MemoryService.js')).default;
const memory = Container.get(MemoryService);

beforeEach(() => { added.length = 0; });

describe('captureDecision', () => {
  it('names the conflicting files and resolution shape for a sync merge_resolution', async () => {
    await memory.captureDecision({
      run: { agentType: 'sync', scope: { lineId: 'L', productId: 'P' }, _id: 'r1' },
      proposal: {
        kind: 'merge_resolution',
        body: {
          title: 'Resolve bigbang → main (update)',
          fileEdits: [
            { path: 'src/App.js', confidence: 'manual' },
            { path: 'src/routes.js', confidence: 'ai' },
          ],
        },
      },
      decision: 'approved',
      writeMode: 'run',
    });

    expect(added).toHaveLength(1);
    const { content, scope, kind } = added[0];
    expect(kind).toBe('decision');
    expect(scope).toEqual({ lineId: 'L', productId: 'P' });
    expect(content).toContain('App.js');
    expect(content).toContain('routes.js');
    expect(content).toContain('verbatim'); // the 'manual' edit was taken from one side
    expect(content).toContain('accepted');
  });

  it('names the change type, feature and files for a harvest fm_patch', async () => {
    await memory.captureDecision({
      run: { agentType: 'harvest', scope: { lineId: 'L', productId: 'P' }, _id: 'r2' },
      proposal: {
        kind: 'fm_patch',
        body: { changeType: 'extend-existing-feature', featureName: 'Logging', fileEdits: [{ path: 'src/platform/log.js' }] },
      },
      decision: 'rejected',
      writeMode: 'run',
    });

    const { content } = added[0];
    expect(content).toContain('extend-existing-feature');
    expect(content).toContain('Logging');
    expect(content).toContain('log.js');
    expect(content).toContain('rejected');
  });
});

describe('captureRunOutcome', () => {
  it('names the committed files and stage for a sync resolution', async () => {
    await memory.captureRunOutcome({
      run: {
        agentType: 'sync',
        scope: { lineId: 'L', productId: 'P' },
        _id: 'r3',
        result: { resolutionCommitted: true, filesCommitted: ['src/App.js', 'src/api.js'], branch: 'bigbang', stage: 'update' },
      },
      writeMode: 'run',
    });

    const { content, kind } = added[0];
    expect(kind).toBe('fact');
    expect(content).toContain('App.js');
    expect(content).toContain('api.js');
    expect(content).toContain('update');
  });
});

describe('captureDisposition', () => {
  it('writes a line-scoped lesson for a dismissal, and returns its id', async () => {
    const id = await memory.captureDisposition({
      lineId: 'L',
      signature: 'sig1',
      state: 'dismissed',
      reason: 'product-specific styling',
      files: ['src/theme.css', 'src/Header.vue'],
      suggestedType: 'extend-existing-feature',
    });

    expect(added).toHaveLength(1);
    const { content, scope, kind, agentType } = added[0];
    expect(id).toBe(added[0]._id);
    expect(kind).toBe('lesson');
    expect(agentType).toBe('harvest');
    expect(scope).toEqual({ lineId: 'L', productId: null });
    expect(content).toContain('theme.css');
    expect(content).toContain('product-specific styling');
    expect(content).toMatch(/do not re-propose/i);
  });

  it('does not write a lesson for a snooze', async () => {
    const id = await memory.captureDisposition({ lineId: 'L', signature: 'sig2', state: 'snoozed' });
    expect(id).toBeNull();
    expect(added).toHaveLength(0);
  });
});
