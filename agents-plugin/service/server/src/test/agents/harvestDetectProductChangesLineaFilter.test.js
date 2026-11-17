import { vi, test, expect, afterEach } from 'vitest';

vi.mock('../../linea/repo.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, compareBranches: vi.fn() };
});

afterEach(() => {
  vi.clearAllMocks();
});

test('a diff touching only .linea/spec.json is filtered out of detectProductChanges', async () => {
  const { compareBranches } = await import('../../linea/repo.js');
  compareBranches.mockResolvedValue({
    files: [{ newPath: '.linea/spec.json', status: 'modified', patch: '...' }],
    commits: [{ shortId: 'c1', title: 'Update product spec', authorName: 'x', createdAt: '2026-01-01T00:00:00.000Z' }],
  });

  const { detectProductChanges } = await import('../../agents/tools/harvest.js');
  const result = await detectProductChanges({ projectId: 1 });

  expect(result.files).toEqual([]);
});

test('a genuine platform-file diff is NOT filtered (regression guard)', async () => {
  const { compareBranches } = await import('../../linea/repo.js');
  compareBranches.mockResolvedValue({
    files: [
      { newPath: '.linea/spec.json', status: 'modified', patch: '...' },
      { newPath: 'src/platform/model.uvl', status: 'modified', patch: '...' },
    ],
    commits: [],
  });

  const { detectProductChanges } = await import('../../agents/tools/harvest.js');
  const result = await detectProductChanges({ projectId: 1 });

  expect(result.files).toHaveLength(1);
  expect(result.files[0].path).toBe('src/platform/model.uvl');
});
