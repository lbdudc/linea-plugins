
export function isEditDirty(edit) {
  if (!edit) return false;
  if (edit.action === 'delete') return true;
  if (edit.action === 'create') return (edit.newContent ?? '') !== '';
  return (edit.newContent ?? '') !== (edit._originalContent ?? '');
}

export function anyEditDirty(fileEdits) {
  return (fileEdits ?? []).some((e) => isEditDirty(e));
}

export function normalizeNewPath(raw) {
  const p = (raw ?? '').trim().replace(/^\/+/, '');
  if (!p) return '';
  if (p.startsWith('src/')) return p;
  if (p.startsWith('platform/')) return `src/${p}`;
  return `src/platform/code/${p}`;
}

export function pendingCreates(fileEdits) {
  return (fileEdits ?? []).filter((e) => e.action === 'create').map((e) => e.path);
}

export function displayFiles(branchFiles, fileEdits) {
  const creates = pendingCreates(fileEdits);
  return [...(branchFiles ?? []), ...creates.filter((p) => !(branchFiles ?? []).includes(p))];
}

export function isPendingCreate(path, fileEdits) {
  return pendingCreates(fileEdits).includes(path);
}

export function editStatusOf(path, fileEdits) {
  const idx = (fileEdits ?? []).findIndex((e) => e.path === path);
  if (idx < 0) return null;
  return { idx, edit: fileEdits[idx] };
}

export function isPathDirty(path, fileEdits) {
  const status = editStatusOf(path, fileEdits);
  return Boolean(status) && isEditDirty(status.edit);
}

export function isSandboxComplete(run, serverSaysFinished) {
  if (serverSaysFinished) return true;
  const steps = run?.steps ?? [];
  const status = steps.find((s) => s.name === 'sandbox')?.status ?? null;
  return status === 'done' || status === 'skipped';
}

export function buildCommitPayload({ fmContent, initialFm, fileEdits }) {
  const fmDirty = fmContent !== initialFm;
  const dirtyEdits = (fileEdits ?? [])
    .filter((e) => isEditDirty(e))
    .map((e) => ({ path: e.path, action: e.action, newContent: e.newContent }));
  return {
    newModelUvl: fmDirty ? fmContent : undefined,
    fileEdits: dirtyEdits.length ? dirtyEdits : undefined,
  };
}
