import { lineDiff } from '../../activity/diffUtils.js';

export function diffStats(oldText, newText) {
  let added = 0;
  let deleted = 0;
  for (const row of lineDiff(oldText, newText)) {
    if (row.type === 'add') added++;
    else if (row.type === 'del') deleted++;
  }
  return { added, deleted };
}

export function buildPatchFiles(body) {
  if (!body) return [];
  const list = [];
  if (body.newModelUvl) {
    const old = body.fmOld ?? '';
    const next = body.newModelUvl ?? '';
    list.push({
      key: '__fm__',
      isFeatureModel: true,
      path: body.modelPath ?? 'model.uvl',
      action: 'update',
      old,
      new: next,
      confidence: null,
      stats: diffStats(old, next),
    });
  }
  for (const edit of body.fileEdits ?? []) {
    const old = edit.oldContent ?? '';
    const next = edit.newContent ?? '';
    list.push({
      key: edit.path,
      isFeatureModel: false,
      path: edit.path,
      action: edit.action ?? 'update',
      old,
      new: next,
      theirs: edit.theirsContent != null && edit.theirsContent !== '' ? edit.theirsContent : null,
      confidence: edit.confidence ?? 'ai',
      stats: diffStats(old, next),
    });
  }
  return list;
}

export function buildFileList(body, patchFiles) {
  if (!body) return [];
  const list = body.markdown ? [{ key: '__overview__', isOverview: true, action: 'plan' }] : [];
  return [...list, ...patchFiles];
}

export function buildReclassifyMessage({
  changeType,
  targetFeature,
  translateDirective,
  translateTargeting,
  translateSuffix,
}) {
  const parts = [];
  if (changeType) parts.push(translateDirective(changeType));
  if (targetFeature) parts.push(translateTargeting(targetFeature));
  if (!parts.length) return null;
  return `${parts.join(' ')}. ${translateSuffix()}`;
}

export function seedChatFromSteps(steps, translateRevised) {
  const messages = [];
  for (const step of steps ?? []) {
    if (step.name !== 'refine') continue;
    if (step.inputSummary) messages.push({ role: 'user', content: step.inputSummary });
    if (step.outputSummary?.revised) messages.push({ role: 'assistant', content: translateRevised() });
    else if (step.outputSummary?.note) messages.push({ role: 'assistant', content: step.outputSummary.note });
  }
  return messages;
}
