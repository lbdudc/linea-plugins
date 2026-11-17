import AgentRun from './AgentRun.js';
import WebhookDelivery from './WebhookDelivery.js';

/**
 * Runs made while agents spoke to GitLab named what they did after it ('gitlab' steps, 'gitlab_comment' proposals, 'gitlab_webhook' and
 * 'gitlab_event' triggers). They are called 'git', 'git_comment', 'git_push' and 'git_event' now: this renames the old records once
 * (and is a no-op afterwards).
 */
export const renameLegacyKinds = async () => {
  const done = await Promise.all([
    AgentRun.updateMany({ 'steps.kind': 'gitlab' }, { $set: { 'steps.$[s].kind': 'git' } }, { arrayFilters: [{ 's.kind': 'gitlab' }] }),
    AgentRun.updateMany({ 'proposals.kind': 'gitlab_comment' }, { $set: { 'proposals.$[p].kind': 'git_comment' } }, { arrayFilters: [{ 'p.kind': 'gitlab_comment' }] }),
    AgentRun.updateMany({ 'trigger.kind': 'gitlab_webhook' }, { $set: { 'trigger.kind': 'git_push' } }),
    AgentRun.updateMany({ 'trigger.kind': 'gitlab_event' }, { $set: { 'trigger.kind': 'git_event' } }),
    WebhookDelivery.updateMany({ gitlabUsername: { $exists: true } }, { $rename: { gitlabUsername: 'username' } }, { strict: false }),
  ]);
  return done.reduce((n, r) => n + (r.modifiedCount ?? 0), 0);
};
