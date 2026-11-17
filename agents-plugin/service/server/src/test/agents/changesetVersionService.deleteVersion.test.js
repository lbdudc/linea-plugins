import { describe, it, expect, vi } from 'vitest';

/**
 * ChangesetVersionService.deleteVersion(cascade) — exercised against the real
 * service with its repository and git dependencies mocked (no DB, no
 * network). Covers the bug where a protected descendant (merged, or promoted
 * to a run) was correctly skipped by the cascade loop, but the top-level
 * version was deleted anyway — orphaning the protected descendant with a
 * dangling parentVersionId instead of refusing the whole delete.
 */

vi.mock('typedi', () => {
  const store = new Map();
  return { Container: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) } };
});

vi.mock('../../agents/tools/git.js', () => ({
  lineAccess: vi.fn().mockRejectedValue(new Error('no git host in test')),
}));
vi.mock('../../model/connectors/properties.js', () => ({ properties: {} }));
vi.mock('../../agents/core/events.js', () => ({ emitVersion: vi.fn() }));

const ChangesetVersionService = (await import('../../agents/changeset/ChangesetVersionService.js')).default;

const version = (over = {}) => ({
  _id: 'A', lineId: 'L1', branch: 'plan/vA', status: 'draft', runId: null,
  ...over,
});

describe('ChangesetVersionService.deleteVersion', () => {
  it('refuses to cascade-delete a version with a merged descendant, instead of orphaning it', async () => {
    const A = version({ _id: 'A' });
    const B = version({ _id: 'B', status: 'merged' }); // protected
    const repo = {
      findById: vi.fn().mockResolvedValue(A),
      descendantsOf: vi.fn().mockResolvedValue([B]),
      deleteById: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ChangesetVersionService();
    Object.defineProperty(service, 'repo', { get: () => repo });

    await expect(service.deleteVersion({ versionId: 'A', userId: 'u1', cascade: true }))
      .rejects.toThrow(/merged/);

    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it('refuses to cascade-delete a version with a descendant promoted to a run', async () => {
    const A = version({ _id: 'A' });
    const B = version({ _id: 'B', runId: 'run-1' }); // protected
    const repo = {
      findById: vi.fn().mockResolvedValue(A),
      descendantsOf: vi.fn().mockResolvedValue([B]),
      deleteById: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ChangesetVersionService();
    Object.defineProperty(service, 'repo', { get: () => repo });

    await expect(service.deleteVersion({ versionId: 'A', userId: 'u1', cascade: true }))
      .rejects.toThrow(/promoted to a run/);

    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it('cascade-deletes normally when no descendant is protected', async () => {
    const A = version({ _id: 'A' });
    const B = version({ _id: 'B' });
    const repo = {
      findById: vi.fn().mockResolvedValue(A),
      descendantsOf: vi.fn().mockResolvedValue([B]),
      deleteById: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ChangesetVersionService();
    Object.defineProperty(service, 'repo', { get: () => repo });

    const result = await service.deleteVersion({ versionId: 'A', userId: 'u1', cascade: true });

    expect(result).toEqual({ deleted: 2 });
    expect(repo.deleteById).toHaveBeenCalledWith('B');
    expect(repo.deleteById).toHaveBeenCalledWith('A');
  });
});
