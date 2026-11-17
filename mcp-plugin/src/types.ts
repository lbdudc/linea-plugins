export interface SplalmMember {
  username: string;
  role: number;
}

export interface SplalmProductSummary {
  _id: string;
  name: string;
  version: string;
  /** Line name string (as returned by /api/products/enrolled) */
  line: string;
  createdAt: string;
  repo: {
    id: number;
    webUrl: string;
  };
}

export interface ProductBasicData {
  name: string;
  version: string;
  createdAt?: string;
  database?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  languages?: string[];
  SRID?: string;
}

export interface ProductSpec {
  basicData: ProductBasicData;
  dataModel?: Record<string, unknown>;
  features?: string[];
  statics?: unknown[];
}

export interface SplalmProductDetail {
  _id: string;
  spec: ProductSpec;
  lineId: string;
  repo: {
    id: number;
    namespaceId: number;
    webUrl: string;
    webIdeUrl: string;
  };
  featureModel: string;
  members: SplalmMember[];
  line: { id: string; name: string };
}

export interface SplalmLine {
  _id: string;
  name: string;
  version: string;
  description: string;
  models: string[];
  repoId: number;
  namespaceId: number;
  webUrl: string;
  webIdeUrl: string;
  members: SplalmMember[];
  products: SplalmProductSummary[];
}

export interface SplalmLog {
  version: string;
  type: 'info' | 'warning' | 'success' | 'error';
  message: string;
  params?: string[];
  link?: string;
  createdAt: string;
}

export interface ProductHealth {
  valid: boolean;
  error: string | null;
  errorType: string | null;
  features: string[];
}

export interface ProductConflicts {
  openMRs: number;
  conflictingMRs: number;
}


export interface GenerateResult extends Record<string, unknown> {
  spec?: ProductSpec;
  repo?: SplalmProductDetail['repo'];
  conflicts?: boolean;
  stage?: 'generating' | 'update';
  mergeRequestUrl?: string;
}

export interface LoginResponse {
  token: string;
  user: { userId: string; username: string };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export type AgentStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'awaiting_approval'
  | 'awaiting_child';

export type ProposalKind = 'gitlab_comment' | 'fm_patch' | 'merge_resolution' | 'spec_patch';
export type ProposalDecision = 'approved' | 'rejected';
export type AgentMode = 'propose_and_wait' | 'automatic';
export type AgentCriticality = 'critical' | 'normal';

export interface AgentScope {
  lineId?: string;
  productId?: string;
}

export interface AgentProposal {
  _id: string;
  kind: ProposalKind;
  title: string;
  body: Record<string, unknown>;
  decision?: ProposalDecision;
  decidedAt?: string;
  decidedBy?: string;
  unambiguous?: boolean;
}

export interface AgentStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  output?: unknown;
  startedAt?: string;
  endedAt?: string;
}

export interface AgentRun {
  _id: string;
  agentType: string;
  status: AgentStatus;
  scope: AgentScope;
  input: Record<string, unknown>;
  steps: AgentStep[];
  proposals: AgentProposal[];
  result?: unknown;
  error?: string;
  parentRunId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDefinition {
  type: string;
  description: string;
  scope: 'line' | 'product';
}

export interface AgentPolicy {
  scope: AgentScope;
  criticality: AgentCriticality;
  modes: {
    sync?: AgentMode;
    harvest?: AgentMode;
    evolution?: AgentMode;
  };
}

// ---------------------------------------------------------------------------
// Knowledge chat
// ---------------------------------------------------------------------------

export interface KnowledgeThread {
  _id: string;
  lineId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeMessage {
  _id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string }>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface AgentMemory {
  _id: string;
  agentType: string;
  kind: 'decision' | 'fact' | 'lesson';
  content: string;
  sourceRunId?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Playground
// ---------------------------------------------------------------------------

export interface PlaygroundJob {
  jobId: string;
  status?: string;
}

export interface FmTreeNode {
  id: string;
  label: string;
  type: string;
  children?: FmTreeNode[];
}

export interface FmTrees {
  current: FmTreeNode | null;
  proposed: FmTreeNode | null;
}

export interface Branch {
  name: string;
  default: boolean;
}

// ---------------------------------------------------------------------------
// Variability Agents — Agent C (Variant Test Pilot) + Agent D (Handbook Curator)
// ---------------------------------------------------------------------------

export interface CoverageResult {
  coverage1Wise: number;
  coverage2Wise: number;
  covered1Wise: number;
  total1Wise: number;
  coveredPairsCount: number;
  totalPairsCount: number;
  /** Top-15 uncovered pairs of used features, sorted by combined feature frequency (risk). */
  riskyUncoveredPairs: [string, string][];
}

export interface CoveringArrayConfig {
  /** Valid feature selection produced by model.completeFeatureSelection. */
  features: string[];
  /** Pairs newly covered by this configuration that were uncovered before. */
  newlyCoveredPairs: [string, string][];
}

export interface CoveringArrayResult {
  configsCount: number;
  remainingUncoveredCount: number;
  configs: CoveringArrayConfig[];
  /** Pairs that could not be covered (FM constraints make them infeasible). */
  remainingUncovered: [string, string][];
}

export interface TestConfigResult {
  passed: boolean;
  exitCode: number;
  log: string;
  noTestCommand: boolean;
}

export interface WikiPageResult {
  slug: string;
  title: string;
  content?: string;
  format?: string;
  web_url?: string;
}
