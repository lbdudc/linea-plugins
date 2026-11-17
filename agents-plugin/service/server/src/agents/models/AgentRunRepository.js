import { Container } from 'typedi';
import MongooseRepository from '../../model/repositories/MongooseRepository.js';
import AgentRun from './AgentRun.js';
import { buildScopeQuery } from './scopeQuery.js';

export default class AgentRunRepository extends MongooseRepository {
  constructor() {
    super(AgentRun);
  }

  async findByScope({ lineId, productId }, options) {
    const query = buildScopeQuery({ lineId, productId });
    return await this.model.find(query, null, options).sort({ createdAt: 'desc' });
  }

  async findByCreatedBy(userId, options) {
    return await this.model
      .find({ createdBy: userId }, null, options)
      .sort({ createdAt: 'desc' });
  }

  // Runs left mid-flight by a crash/restart — re-enqueued by the boot recovery
  // sweep. Includes batch parents waiting on a child, and runs awaiting an external
  // async process (CI pipeline) that may have finished while the server was down.
  async findResumable(options) {
    return await this.model.find(
      { status: { $in: ['running', 'awaiting_child', 'awaiting_external'] } },
      null,
      options
    );
  }

  // Child runs spawned by a batch parent (line-sync fans out one regen run per
  // product). Used by the parent's awaitChild loop to poll its children's state.
  async findByParentRunId(parentRunId, options) {
    return await this.model.find({ parentRunId }, null, options).sort({ createdAt: 1 });
  }

  // Aggregated metrics for the activity dashboard and the full-page ops dashboard.
  // Collection-wide counts are cheap $group aggregations; the richer performance figures
  // (latency percentiles, approval/error rates, per-agent breakdown, runs-per-day series)
  // are computed in Node over the runs in the last `windowDays`, keeping the query lean.
  // Returns the original fields plus: { windowDays, perAgent, approval, errorRate,
  // latency, timeSeries }.
  async computeMetrics({ windowDays = 30 } = {}) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const [statusCounts, agentCounts, recentDone, pendingApprovals, windowRuns] = await Promise.all([
      this.model.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      this.model.aggregate([{ $group: { _id: '$agentType', count: { $sum: 1 } } }]),
      this.model.aggregate([
        { $match: { status: 'done', createdAt: { $gte: sevenDaysAgo }, 'steps.durationMs': { $exists: true } } },
        { $project: { totalDurationMs: { $sum: '$steps.durationMs' } } },
        { $group: { _id: null, avgDurationMs: { $avg: '$totalDurationMs' } } },
      ]),
      this.model.countDocuments({ status: 'awaiting_approval' }),
      // Lean window slice for the performance math — only the fields the reducers need.
      this.model
        .find(
          { createdAt: { $gte: windowStart } },
          { agentType: 1, status: 1, createdAt: 1, updatedAt: 1, 'proposals.decision': 1 }
        )
        .lean(),
    ]);

    const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.count]));
    const byAgent = Object.fromEntries(agentCounts.map((a) => [a._id, a.count]));
    const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
    const done = byStatus.done ?? 0;
    const failed = byStatus.failed ?? 0;
    const terminal = done + failed;
    const successRate = terminal > 0 ? Math.round((done / terminal) * 100) : null;

    const perf = this.#computeWindowPerformance(windowRuns, windowDays);

    return {
      total,
      byStatus,
      byAgent,
      successRate,
      avgDurationMs7d: recentDone[0]?.avgDurationMs ?? null,
      pendingApprovals,
      windowDays,
      ...perf,
    };
  }

  // Pure reducers over the windowed run slice. Latency is wall-clock (updatedAt −
  // createdAt) for terminal runs; approval counts come from each run's proposal
  // decisions; the time-series buckets runs by calendar day.
  #computeWindowPerformance(runs, windowDays) {
    const TERMINAL = new Set(['done', 'failed', 'cancelled']);
    const pct = (sorted, q) => {
      if (!sorted.length) return null;
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
      return sorted[idx];
    };
    const latency = (r) => new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime();

    const agents = {};
    const approvalTotals = { approved: 0, rejected: 0, auto: 0 };
    const allLatencies = [];
    const series = {};
    let failedCount = 0;

    for (const r of runs) {
      const a = (agents[r.agentType] ??= {
        total: 0, done: 0, failed: 0,
        approvals: { approved: 0, rejected: 0, auto: 0 },
        _latencies: [],
      });
      a.total += 1;
      if (r.status === 'done') a.done += 1;
      if (r.status === 'failed') { a.failed += 1; failedCount += 1; }

      for (const p of r.proposals ?? []) {
        if (p.decision && approvalTotals[p.decision] !== undefined) {
          approvalTotals[p.decision] += 1;
          a.approvals[p.decision] += 1;
        }
      }

      if (TERMINAL.has(r.status)) {
        const ms = latency(r);
        if (ms >= 0) { a._latencies.push(ms); allLatencies.push(ms); }
      }

      const day = new Date(r.createdAt).toISOString().slice(0, 10);
      const bucket = (series[day] ??= { date: day, total: 0, done: 0, failed: 0 });
      bucket.total += 1;
      if (r.status === 'done') bucket.done += 1;
      if (r.status === 'failed') bucket.failed += 1;
    }

    const latencyStats = (arr) => {
      const sorted = [...arr].sort((x, y) => x - y);
      return {
        avg: sorted.length ? Math.round(sorted.reduce((s, n) => s + n, 0) / sorted.length) : null,
        p50: pct(sorted, 0.5),
        p95: pct(sorted, 0.95),
      };
    };

    const perAgent = Object.fromEntries(
      Object.entries(agents).map(([type, a]) => {
        const term = a.done + a.failed;
        const decided = a.approvals.approved + a.approvals.rejected;
        return [type, {
          total: a.total,
          done: a.done,
          failed: a.failed,
          successRate: term > 0 ? Math.round((a.done / term) * 100) : null,
          approvals: a.approvals,
          approvalRate: decided > 0 ? Math.round((a.approvals.approved / decided) * 100) : null,
          latency: latencyStats(a._latencies),
        }];
      })
    );

    const decidedAll = approvalTotals.approved + approvalTotals.rejected;
    const windowTotal = runs.length;

    // Dense day buckets across the window so the chart has no gaps.
    const timeSeries = [];
    for (let i = windowDays - 1; i >= 0; i--) {
      const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      timeSeries.push(series[day] ?? { date: day, total: 0, done: 0, failed: 0 });
    }

    return {
      perAgent,
      approval: {
        ...approvalTotals,
        approvalRate: decidedAll > 0 ? Math.round((approvalTotals.approved / decidedAll) * 100) : null,
      },
      errorRate: windowTotal > 0 ? Math.round((failedCount / windowTotal) * 100) : null,
      latency: latencyStats(allLatencies),
      timeSeries,
    };
  }

  // Last successful harvest run for a product — used to anchor "since last harvest" mode.
  async findLastSuccessfulHarvest(productId) {
    return this.model.findOne(
      { agentType: 'harvest', 'scope.productId': productId, status: 'done' },
      null,
      { sort: { createdAt: -1 } }
    );
  }

  // Latest regen run per product, restricted to those that ended in a merge conflict
  // (a conflicting regen completes `done` with result.conflicts === true — the conflict
  // is a normal outcome, not a failure). Powers the reconciliation sweep, which finds
  // products left conflicted with no resolver because the PRODUCT_GENERATED event was
  // lost (server restarted before the sync enqueue, or enqueueNew threw).
  async findLatestConflictedRegens() {
    const rows = await this.model.aggregate([
      { $match: { agentType: 'regen', status: 'done', 'scope.productId': { $ne: null } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$scope.productId', run: { $first: '$$ROOT' } } },
      { $match: { 'run.result.conflicts': true } },
    ]);
    return rows.map((r) => r.run);
  }

  // Whether a sync run (active OR terminal) exists for a product since `since`. The
  // sweep skips a conflict that already has a resolver — including a failed/finished
  // one — so re-running never duplicates and never loops on a sync that keeps failing.
  async hasSyncRunSince(productId, since) {
    return !!(await this.model.findOne(
      { agentType: 'sync', 'scope.productId': productId, createdAt: { $gte: since } },
      '_id'
    ));
  }

  // The non-terminal run (if any) for a given agentType + scope field, newest first.
  // Used to prevent duplicate runs of the same kind piling up for the same scope —
  // e.g. a manual "Diagnose sync" click racing the auto-enqueue from a conflicted
  // regen, which previously produced two independent sync runs for one conflict
  // with nothing to reconcile them.
  async findActiveRun({ agentType, scopeField, scopeValue }, options) {
    const query = {
      agentType,
      [`scope.${scopeField}`]: scopeValue,
      status: { $nin: ['done', 'failed', 'cancelled'] },
    };
    return await this.model.findOne(query, null, { sort: { createdAt: -1 }, ...options });
  }

  // Check whether any non-terminal run exists for a given agentType + scope field.
  // Used to prevent duplicate webhook-triggered runs for the same product.
  async hasActiveRun({ agentType, scopeField, scopeValue }, options) {
    return !!(await this.findActiveRun({ agentType, scopeField, scopeValue }, options));
  }

  // Lightweight check for AgentRunner's step loop to notice a concurrent cancel()
  // between/after steps without paying for a full document fetch each time.
  async isCancelled(runId) {
    return !!(await this.model.exists({ _id: runId, status: 'cancelled' }));
  }
}

Container.set(AgentRunRepository, new AgentRunRepository());
