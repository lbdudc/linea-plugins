import { listMergeRequests, getMergeRequest } from '../../linea/repo.js';
import { branches } from './git.js';

/**
 * Tools for the Steward agent (SPL hygiene). Anti-pattern detection over a
 * product's open merge requests — conflicting MRs and stale generation MRs are
 * the signals that a sync is stuck or the branch convention was bypassed.
 */

export const productAntiPatterns = async ({ userId, product }) => {
  const name = product.spec?.basicData?.name ?? String(product._id);
  const projectId = product.repo?.id;
  if (!projectId) return { name, openMRs: 0, issues: ['No git repository linked'] };

  let mrs = [];
  try {
    mrs = await listMergeRequests({ id: projectId, userId, state: 'opened' });
  } catch {
    return { name, openMRs: 0, issues: ['Could not read merge requests (access?)'] };
  }

  // (a host's list does not always compute conflicts: each MR is asked for in full)
  mrs = await Promise.all(mrs.map((m) => getMergeRequest({ id: projectId, userId, number: m.number }).catch(() => m)));
  const conflicting = mrs.filter((m) => m.hasConflicts);
  const staleGeneration = mrs.filter((m) =>
    (m.sourceBranch ?? '').startsWith(`${branches.generation}/`)
  );

  const issues = [];
  if (conflicting.length) issues.push(`${conflicting.length} conflicting open MR(s)`);
  if (staleGeneration.length) {
    issues.push(`${staleGeneration.length} open generation MR(s) — a sync was never resolved`);
  }

  return {
    name,
    openMRs: mrs.length,
    conflicting: conflicting.length,
    staleGeneration: staleGeneration.length,
    issues,
  };
};
