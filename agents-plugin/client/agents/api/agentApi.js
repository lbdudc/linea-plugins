import { api } from './http.js';

/**
 * REST client for the agent subsystem (server: /api/agents).
 * Mirrors the other service modules (thin wrappers returning response.data).
 */
export default {
  async listAgents() {
    return (await api.get('/agents')).data;
  },

  async listLines() {
    return (await api.get('/agents/lines')).data;
  },

  async listRuns({ lineId, productId } = {}) {
    const params = {};
    if (lineId) params.lineId = lineId;
    if (productId) params.productId = productId;
    return (await api.get('/agents/runs', { params })).data;
  },

  async getRun(id) {
    return (await api.get(`/agents/runs/${id}`)).data;
  },

  async createRun({ agentType, scope, input }) {
    return (await api.post('/agents/runs', { agentType, scope, input })).data;
  },

  async decide(id, { proposalId, decision, meta }) {
    return (await api.post(`/agents/runs/${id}/decide`, { proposalId, decision, ...(meta !== undefined && { meta }) })).data;
  },

  async cancel(id) {
    return (await api.post(`/agents/runs/${id}/cancel`)).data;
  },

  // Re-checks a sync run's MR against the git host and persists the result (unlike
  // GET /products/:id/conflicts, which is a live read with nothing stored) — so
  // the Sync board and "Retry resolver" reflect it afterward too, not just this view.
  async recheckConflict(id) {
    return (await api.post(`/agents/runs/${id}/recheck-conflict`)).data;
  },

  async deleteRun(id) {
    return (await api.delete(`/agents/runs/${id}`)).data;
  },

  async rerunStep(id, stepName) {
    return (await api.post(`/agents/runs/${id}/rerun-step`, { stepName })).data;
  },

  // Refine a paused review proposal via chat. The server dispatches by agent type
  // (Harvest fm_patch / Sync merge_resolution).
  async refine(id, message) {
    return (await api.post(`/agents/runs/${id}/refine`, { message })).data;
  },

  // Revert a review proposal to an earlier version.
  async restoreVersion(id, { proposalId, versionIndex }) {
    return (await api.post(`/agents/runs/${id}/restore-version`, { proposalId, versionIndex })).data;
  },

  // Manually author one file's content on a paused review proposal (operator
  // fallback when the agent's resolution is wrong). Revised body returns + sockets.
  async editProposalFile(id, { path, newContent }) {
    return (await api.post(`/agents/runs/${id}/proposal/edit`, { path, newContent })).data;
  },

  // Re-run FM validation on a paused sync run. Result is pushed via socket.
  async validateSync(id) {
    return (await api.post(`/agents/runs/${id}/validate`)).data;
  },

  // Test the pending merge_resolution proposal's file edits. Returns { jobId };
  // progress streams via playground:* WebSocket events.
  async testProposal(id) {
    return (await api.post(`/agents/runs/${id}/test-proposal`)).data;
  },

  async getPolicy({ lineId, productId }) {
    const params = { lineId };
    if (productId) params.productId = productId;
    return (await api.get('/agents/policy', { params })).data;
  },

  async setPolicy({ lineId, productId, criticality, modes }) {
    return (await api.put('/agents/policy', { lineId, productId, criticality, modes })).data;
  },

  // Effective per-agent customization for a scope (one entry per registered agent).
  async getConfig({ lineId, productId } = {}) {
    const params = { lineId };
    if (productId) params.productId = productId;
    return (await api.get('/agents/config', { params })).data;
  },

  // Upsert one agent's config for a scope.
  async setConfig({ lineId, productId, agentType, enabled, instructions, defaultInput, memoryRead, memoryWrite, triggers }) {
    return (await api.put('/agents/config', { lineId, productId, agentType, enabled, instructions, defaultInput, memoryRead, memoryWrite, triggers })).data;
  },

  // Delete one agent's config row for a scope (product scope → reset to line default).
  async resetConfig({ lineId, productId, agentType }) {
    const params = { lineId, agentType };
    if (productId) params.productId = productId;
    await api.delete('/agents/config', { params });
  },

  // Semantic memory recall preview: top-K relevant memories + similarity scores.
  async searchMemory({ lineId, productId, q, k } = {}) {
    const params = { lineId, q };
    if (productId) params.productId = productId;
    if (k) params.k = k;
    return (await api.get('/agents/memory/search', { params })).data;
  },

  async knowledgeAsk({ lineId, threadId, content }) {
    return (await api.post('/agents/knowledge/message', { lineId, threadId, content })).data;
  },

  async knowledgeThreads({ lineId }) {
    return (await api.get('/agents/knowledge/threads', { params: { lineId } })).data;
  },

  async knowledgeMessages(threadId) {
    return (await api.get(`/agents/knowledge/threads/${threadId}/messages`)).data;
  },

  async listMemory({ lineId, productId, limit } = {}) {
    const params = { lineId };
    if (productId) params.productId = productId;
    if (limit) params.limit = limit;
    return (await api.get('/agents/memory', { params })).data;
  },

  async deleteMemory(id) {
    await api.delete(`/agents/memory/${id}`);
  },

  async clearMemory({ lineId, productId } = {}) {
    const params = { lineId };
    if (productId) params.productId = productId;
    await api.delete('/agents/memory', { params });
  },

  async addMemory({ lineId, productId, kind, content }) {
    return (await api.post('/agents/memory', { lineId, productId, kind, content })).data;
  },

  async getMetrics({ windowDays } = {}) {
    const params = {};
    if (windowDays) params.windowDays = windowDays;
    return (await api.get('/agents/metrics', { params })).data;
  },

  async getDeploymentMetrics() {
    return (await api.get('/agents/deployment-metrics')).data;
  },

  async listEnrolledProducts() {
    return (await api.get('/agents/products/enrolled')).data;
  },

  // Recent commits on the product's default branch for the harvest "since commit" picker.
  async getHarvestCommits(productId) {
    return (await api.get('/agents/harvest/commits', { params: { productId } })).data;
  },

  // ── Harvest candidate dispositions + steering helpers ──────────────────────
  // Operator triage decisions on miner candidates, keyed by candidate signature.
  async listDispositions({ lineId }) {
    return (await api.get('/agents/dispositions', { params: { lineId } })).data;
  },

  async setDisposition(body) {
    return (await api.put('/agents/dispositions', body)).data;
  },

  async deleteDisposition(id) {
    await api.delete(`/agents/dispositions/${id}`);
  },

  // Feature names from the line's platform feature model (target-feature dropdown).
  async getLineFeatures({ lineId }) {
    return (await api.get('/agents/harvest/features', { params: { lineId } })).data;
  },

  // Lazy diff preview for a candidate card (fetched on expand).
  async getHarvestPreview({ productId }) {
    return (await api.get('/agents/harvest/preview', { params: { productId } })).data;
  },

  // Merge 2+ in-review harvest proposals into one re-synthesized proposal.
  async mergeProposals({ lineId, runIds, directive }) {
    return (await api.post('/agents/harvest/merge', { lineId, runIds, directive })).data;
  },

  // Split a merged run back into its source proposals (while still in review).
  async splitProposal(runId) {
    return (await api.post('/agents/harvest/split', { runId })).data;
  },

  async listWebhookDeliveries({ limit } = {}) {
    return (await api.get('/agents/webhook-deliveries', { params: limit ? { limit } : {} })).data;
  },

  // ── Sync Console ────────────────────────────────────────────────────────────
  // Launch a line-wide regeneration. Fans out one regen run per product; conflicts
  // auto-spawn the sync resolver. `productIds` lets the operator deselect products.
  async startLineSync({ lineId, productIds, force }) {
    return (await api.post('/agents/runs', {
      agentType: 'line-sync',
      scope: { lineId },
      input: { productIds, force },
    })).data;
  },

  // Run a product's own test suite (no edits) and persist the outcome. Returns
  // { jobId }; progress streams via the playground:* WebSocket events.
  async runProductTest(productId, { branch } = {}) {
    return (await api.post(`/agents/products/${productId}/test`, { branch })).data;
  },

  // Latest persisted test result per product for a line (powers the test chips).
  async listTestResults(lineId) {
    return (await api.get(`/agents/lines/${lineId}/test-results`)).data;
  },

  // List the branches for a line repo (for the Consolidation "from branch" picker).
  async listLineBranches(lineId, search = '') {
    return (await api.get(`/agents/lines/${lineId}/branches`, { params: search ? { search } : {} })).data;
  },

  // Promote an in-review harvest proposal to a Consolidation Change Set run.
  async harvestToChangeset(runId) {
    return (await api.post(`/agents/runs/${runId}/to-changeset`)).data;
  },

  // Consolidation "Propose with AI": start an LLM proposal session from a user intent.
  async startChangesetProposal(lineId, intent) {
    return (await api.post(`/agents/lines/${lineId}/changeset-proposal/start`, { intent })).data;
  },
  // Refine the current proposal by sending additional feedback.
  async refineChangesetProposal(lineId, sessionId, message) {
    return (await api.post(`/agents/lines/${lineId}/changeset-proposal/${sessionId}/refine`, { message })).data;
  },
  // Commit the approved proposal to a plan/ branch and return { branch }.
  async commitChangesetProposal(lineId, sessionId) {
    return (await api.post(`/agents/lines/${lineId}/changeset-proposal/${sessionId}/commit`)).data;
  },

  // Cancel a running playground job.
  async cancelPlaygroundJob(runId, jobId) {
    return (await api.delete(`/agents/runs/${runId}/playground/jobs/${jobId}`)).data;
  },

  // Persist the current playground feature selection into the product's spec
  // so future regens (cascade) include the feature-gated code.
  async savePlaygroundSelection(runId, { productId, featureSelection }) {
    return (await api.post(`/agents/runs/${runId}/playground/save-selection`, { productId, featureSelection })).data;
  },

  // ── Version tree workspace ──────────────────────────────────────────────
  async listVersions(lineId) {
    return (await api.get(`/agents/lines/${lineId}/versions`)).data;
  },
  async createVersion(lineId, { parentVersionId = null, intent = '', branch = null, origin = null } = {}) {
    return (await api.post(`/agents/lines/${lineId}/versions`, {
      parentVersionId,
      intent,
      ...(branch ? { branch } : {}),
      ...(origin ? { origin } : {}),
    })).data;
  },
  async getVersion(versionId) {
    return (await api.get(`/agents/versions/${versionId}`)).data;
  },
  async archiveVersion(versionId) {
    return (await api.post(`/agents/versions/${versionId}/archive`)).data;
  },
  async getVersionChat(versionId) {
    return (await api.get(`/agents/versions/${versionId}/chat`)).data;
  },
  async sendVersionChatMessage(versionId, message) {
    return (await api.post(`/agents/versions/${versionId}/chat`, { message })).data;
  },
  async promoteVersion(versionId) {
    return (await api.post(`/agents/versions/${versionId}/promote`)).data;
  },
  async deleteVersion(versionId, { cascade = false } = {}) {
    return (await api.delete(`/agents/versions/${versionId}`, { params: cascade ? { cascade: 1 } : {} })).data;
  },
  async resetVersion(versionId, { cascade = false } = {}) {
    return (await api.post(`/agents/versions/${versionId}/reset`, { cascade })).data;
  },

  // Also keep as alias for backward compat (used in HarvestReviewDialog)
  async refineHarvest(id, message) {
    return this.refine(id, message);
  },

  // Start a sandbox test job. Returns { jobId }; progress streams via websocket.
  async runPlaygroundTest(runId, { productId, branch, featureSelection, overrideWithLineChanges, testCommand, testImage, skipTests }) {
    return (await api.post(`/agents/runs/${runId}/playground/test`, { productId, branch, featureSelection, overrideWithLineChanges, testCommand, testImage, skipTests })).data;
  },

  // Parsed FM trees (current + proposed) for the FM tree selector.
  async getPlaygroundFm(runId) {
    return (await api.get(`/agents/runs/${runId}/playground/fm`)).data;
  },

  // List the branches for a product (for the branch dropdown).
  async getPlaygroundBranches(runId, productId, search = '') {
    return (await api.get(`/agents/runs/${runId}/playground/branches/${productId}`, { params: search ? { search } : {} })).data;
  },

  // Derive + merge the product and trigger a browser download of the resulting zip.
  async downloadPlaygroundProduct(runId, { productId, branch, featureSelection, overrideWithLineChanges }, productName) {
    const response = await api.post(
      `/agents/runs/${runId}/playground/download`,
      { productId, branch, featureSelection, overrideWithLineChanges },
      { responseType: 'blob' },
    );
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${productName ?? 'product'}-playground.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ── Sandbox (changeset plan-branch) playground ─────────────────────────────

  async getPlaygroundBranchFm(runId) {
    return (await api.get(`/agents/runs/${runId}/playground/branch/fm`)).data;
  },

  async runPlaygroundBranchTest(runId, { productId, branch, featureSelection, overrideWithLineChanges, testCommand, testImage, skipTests }) {
    return (await api.post(`/agents/runs/${runId}/playground/branch/test`, { productId, branch, featureSelection, overrideWithLineChanges, testCommand, testImage, skipTests })).data;
  },

  // Sandbox (changeset preprod iteration) ───────────────────────────────────
  async getSandboxState(runId) {
    return (await api.get(`/agents/runs/${runId}/sandbox/state`)).data;
  },
  async getSandboxFiles(runId, path = 'src/platform') {
    return (await api.get(`/agents/runs/${runId}/sandbox/files`, { params: { path } })).data;
  },
  async getSandboxFile(runId, path) {
    return (await api.get(`/agents/runs/${runId}/sandbox/file`, { params: { path } })).data;
  },
  async commitSandboxIteration(runId, { newModelUvl, fileEdits, message }) {
    return (await api.post(`/agents/runs/${runId}/sandbox/commit`, { newModelUvl, fileEdits, message })).data;
  },

  async downloadPlaygroundBranchProduct(runId, { productId, branch, featureSelection, overrideWithLineChanges }, productName) {
    const response = await api.post(
      `/agents/runs/${runId}/playground/branch/download`,
      { productId, branch, featureSelection, overrideWithLineChanges },
      { responseType: 'blob' },
    );
    const url = URL.createObjectURL(response.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${productName ?? 'product'}-sandbox.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
