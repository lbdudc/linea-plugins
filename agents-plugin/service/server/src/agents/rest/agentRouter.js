import express from 'express';
import { Container } from 'typedi';
import { requireAuth } from '../../rest/common/auth.js';
import AgentController from './agentController.js';
import {
    createRunValidator,
    decideValidator,
    refineValidator,
    putPolicyValidator,
    putConfigValidator,
    knowledgeMessageValidator,
    addMemoryValidator,
    putDispositionValidator,
    mergeProposalsValidator,
    splitProposalValidator,
    editProposalFileValidator,
} from './agentValidators.js';

const agentRouter = express.Router();
const agentController = Container.get(AgentController);

agentRouter.get('/', requireAuth, agentController.listAgents);
agentRouter.get('/policy', requireAuth, agentController.getPolicy);
agentRouter.put('/policy', requireAuth, putPolicyValidator, agentController.putPolicy);
agentRouter.get('/config', requireAuth, agentController.getConfig);
agentRouter.put('/config', requireAuth, putConfigValidator, agentController.putConfig);
agentRouter.delete('/config', requireAuth, agentController.deleteConfig);
agentRouter.post('/runs', requireAuth, createRunValidator, agentController.createRun);
agentRouter.get('/runs', requireAuth, agentController.listRuns);
agentRouter.get('/runs/:id', requireAuth, agentController.getRun);
agentRouter.post('/runs/:id/decide', requireAuth, decideValidator, agentController.decide);
agentRouter.post('/runs/:id/cancel', requireAuth, agentController.cancel);
agentRouter.post('/runs/:id/rerun-step', requireAuth, agentController.rerunStep);
agentRouter.delete('/runs/:id', requireAuth, agentController.deleteRun);
agentRouter.post('/runs/:id/refine', requireAuth, refineValidator, agentController.refine);
agentRouter.post('/runs/:id/restore-version', requireAuth, agentController.restoreVersion);
agentRouter.post('/runs/:id/proposal/edit', requireAuth, editProposalFileValidator, agentController.editProposalFile);
agentRouter.post('/runs/:id/validate', requireAuth, agentController.validateSync);
agentRouter.post('/runs/:id/recheck-conflict', requireAuth, agentController.recheckSyncConflict);
agentRouter.post('/runs/:id/test-proposal', requireAuth, agentController.testProposal);
agentRouter.post('/runs/:id/playground/test', requireAuth, agentController.playgroundTest);
agentRouter.post('/runs/:id/playground/download', requireAuth, agentController.playgroundDownload);
agentRouter.get('/runs/:id/playground/fm', requireAuth, agentController.playgroundFm);
agentRouter.get('/runs/:id/playground/branches/:productId', requireAuth, agentController.playgroundBranches);
agentRouter.delete('/runs/:id/playground/jobs/:jobId', requireAuth, agentController.cancelPlaygroundJob);
agentRouter.post('/runs/:id/playground/save-selection', requireAuth, agentController.playgroundSaveSelection);
// Plan-branch playground (changeset sandbox): same shape but reads from the run's plan/ branch.
agentRouter.get('/runs/:id/playground/branch/fm', requireAuth, agentController.playgroundBranchFm);
agentRouter.post('/runs/:id/playground/branch/test', requireAuth, agentController.playgroundBranchTest);
agentRouter.post('/runs/:id/playground/branch/download', requireAuth, agentController.playgroundBranchDownload);
agentRouter.get('/runs/:id/sandbox/state', requireAuth, agentController.sandboxState);
agentRouter.get('/runs/:id/sandbox/files', requireAuth, agentController.sandboxFiles);
agentRouter.get('/runs/:id/sandbox/file', requireAuth, agentController.sandboxFile);
agentRouter.post('/runs/:id/sandbox/commit', requireAuth, agentController.sandboxCommit);

// Sync Console: per-product test run + latest results per line.
agentRouter.post('/products/:productId/test', requireAuth, agentController.runProductTest);
agentRouter.get('/lines/:lineId/test-results', requireAuth, agentController.listTestResults);
// Consolidation Console: list line-repo branches for the "from branch" plan picker.
agentRouter.get('/lines/:lineId/branches', requireAuth, agentController.listLineBranches);
// Promote a harvest in-review proposal to a Consolidation Change Set run.
agentRouter.post('/runs/:id/to-changeset', requireAuth, agentController.createChangesetFromHarvest);
// Consolidation "Propose with AI": LLM-chat session that produces a plan/ branch.
agentRouter.post('/lines/:lineId/changeset-proposal/start', requireAuth, agentController.startChangesetProposal);
agentRouter.post('/lines/:lineId/changeset-proposal/:sessionId/refine', requireAuth, agentController.refineChangesetProposal);
agentRouter.post('/lines/:lineId/changeset-proposal/:sessionId/commit', requireAuth, agentController.commitChangesetProposal);
// Version-tree workspace endpoints
agentRouter.get('/lines/:lineId/versions', requireAuth, agentController.listVersions);
agentRouter.post('/lines/:lineId/versions', requireAuth, agentController.createVersion);
agentRouter.get('/versions/:versionId', requireAuth, agentController.getVersion);
agentRouter.post('/versions/:versionId/archive', requireAuth, agentController.archiveVersion);
agentRouter.post('/versions/:versionId/promote', requireAuth, agentController.promoteVersion);
agentRouter.delete('/versions/:versionId', requireAuth, agentController.deleteVersion);
agentRouter.post('/versions/:versionId/reset', requireAuth, agentController.resetVersion);
agentRouter.get('/versions/:versionId/chat', requireAuth, agentController.getVersionChat);
agentRouter.post('/versions/:versionId/chat', requireAuth, agentController.postVersionChat);

agentRouter.post('/knowledge/message', requireAuth, knowledgeMessageValidator, agentController.knowledgeMessage);
agentRouter.get('/knowledge/threads', requireAuth, agentController.knowledgeThreads);
agentRouter.get('/knowledge/threads/:id/messages', requireAuth, agentController.knowledgeMessages);

agentRouter.get('/memory', requireAuth, agentController.listMemory);
agentRouter.get('/memory/search', requireAuth, agentController.searchMemory);
agentRouter.post('/memory', requireAuth, addMemoryValidator, agentController.addMemory);
agentRouter.delete('/memory', requireAuth, agentController.clearMemory);
agentRouter.delete('/memory/:id', requireAuth, agentController.deleteMemory);

agentRouter.get('/dispositions', requireAuth, agentController.listDispositions);
agentRouter.put('/dispositions', requireAuth, putDispositionValidator, agentController.putDisposition);
agentRouter.delete('/dispositions/:id', requireAuth, agentController.deleteDisposition);
agentRouter.get('/harvest/features', requireAuth, agentController.getLineFeatures);
agentRouter.get('/harvest/preview', requireAuth, agentController.harvestPreview);
agentRouter.get('/harvest/commits', requireAuth, agentController.harvestCommits);
agentRouter.post('/harvest/merge', requireAuth, mergeProposalsValidator, agentController.mergeHarvestProposals);
agentRouter.post('/harvest/split', requireAuth, splitProposalValidator, agentController.splitHarvestProposal);
agentRouter.get('/metrics', requireAuth, agentController.getMetrics);
agentRouter.get('/webhook-deliveries', requireAuth, agentController.listWebhookDeliveries);

export default agentRouter;
