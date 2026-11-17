/**
 * Version history for review proposals (Harvest fm_patch / Sync merge_resolution).
 *
 * Each chat-refine or restore snapshots the *previous* body into `body.versions`,
 * so the domain engineer can browse earlier proposals and revert to any of them.
 * The live state is always the top-level body; `versions` holds the prior states.
 */

export const VERSIONED_KINDS = ['fm_patch', 'merge_resolution'];

/** A body without its own version history (so snapshots don't nest unboundedly). */
const stripVersions = (body) => {
  if (!body || typeof body !== 'object') return {};
  const { versions, ...rest } = body;
  return rest;
};

/**
 * Append the current body as a prior version and return the new versions array.
 * `label` describes the snapshot (e.g. the feature/summary it represented).
 */
export const withRecordedVersion = (body, label) => {
  const versions = Array.isArray(body?.versions) ? body.versions : [];
  return [
    ...versions,
    { label: label || `v${versions.length + 1}`, at: new Date(), body: stripVersions(body) },
  ];
};

/**
 * Restore a prior version onto the live body, recording the state being replaced
 * as a new version (so a restore is itself reversible). Returns the new body.
 */
export const restoredBody = (body, versionIndex, replacedLabel) => {
  const versions = Array.isArray(body?.versions) ? body.versions : [];
  const target = versions[versionIndex];
  if (!target) throw new Error('Version not found');
  return {
    ...stripVersions(target.body),
    versions: withRecordedVersion(body, replacedLabel || 'before restore'),
  };
};
