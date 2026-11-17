export function buildProposalDiffFiles({ newModelUvl, fileEdits, fmLabel, fmPath, fmOld = '' }) {
  const list = [];
  if (newModelUvl) {
    list.push({
      key: '__fm__',
      label: fmLabel,
      path: fmPath ?? 'model.uvl',
      action: 'update',
      old: fmOld ?? '',
      new: newModelUvl,
    });
  }
  for (const e of fileEdits ?? []) {
    list.push({
      key: e.path,
      label: e.path,
      path: e.path,
      action: e.action ?? 'update',
      old: e.oldContent ?? '',
      new: e.newContent ?? '',
    });
  }
  return list;
}
