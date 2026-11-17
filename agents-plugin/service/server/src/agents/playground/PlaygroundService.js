import { Container } from 'typedi';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import fsExtra from 'fs-extra';
import JSZip from 'jszip';
import { linea } from '../../linea/LineaClient.js';
import { downloadArchive } from '../../linea/repo.js';
import { FEATURE_MODEL_PATH, toLineaFeatureModel } from '../../linea/featureModelFormat.js';
import { properties } from '../../model/connectors/properties.js';
import { normalizeFeatureSelection, normalizeProductSpec, normalizeUvl, parseFeatureModel, extractArchive } from '../../linea/featureModel.js';
import { productAccess } from '../tools/git.js';
import { loadFeatureModel, loadFeatureModelFromBranch } from '../tools/splContext.js';
import AgentRunRepository from '../models/AgentRunRepository.js';
import TestResultRepository from '../models/TestResultRepository.js';
import ProductSpecService, { ProductSpecUnavailableError } from '../../model/services/ProductSpecService.js';
import { emitToUser } from '../core/events.js';

// Keep only the tail of a test log on the persisted result — enough for triage
// without bloating the document.
const LOG_TAIL_CHARS = 4000;

// In-memory job registry — ephemeral, not persisted across restarts.
// Map<jobId, { status, productId, exitCode, error, cancel }>
const jobs = new Map();

// Track active Docker container IDs so we can force-remove them on process exit.
const activeContainers = new Set();

const cleanupContainers = () => {
  for (const id of activeContainers) {
    try { spawn('docker', ['rm', '-f', id], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  }
  activeContainers.clear();
};

process.once('exit', cleanupContainers);
process.once('SIGTERM', () => { cleanupContainers(); process.exit(0); });
process.once('SIGINT', () => { cleanupContainers(); process.exit(0); });

const getTestTimeoutMs = () => properties.playground?.testTimeoutMs ?? 300000;

export default class PlaygroundService {
  agentRunRepository = Container.get(AgentRunRepository);
  testResultRepository = Container.get(TestResultRepository);

  /**
   * Start an async playground test for a single product.
   * Returns { jobId } immediately; progress arrives via websocket events:
   *   playground:start  — job kicked off
   *   playground:log    — stdout/stderr line
   *   playground:done   — { exitCode, passed }
   *   playground:error  — { message }
   */
  runProductTest = async ({ runId, userId, productId, branch, featureSelection, overrideWithLineChanges, testCommand, testImage, skipTests = false }) => {
    const run = await this.agentRunRepository.findById(runId);
    if (!run) throw new Error('Run not found');

    const proposal = run.proposals.find((p) => p.kind === 'fm_patch' && !p.decision) ?? null;
    const jobId = uuidv4();

    const abortController = new AbortController();
    jobs.set(jobId, { status: 'running', productId, exitCode: null, error: null, cancel: () => abortController.abort() });

    this.#execute({ jobId, userId, proposal, productId, branch, featureSelection, overrideWithLineChanges, testCommand, testImage, skipTests, signal: abortController.signal })
      .catch((err) => {
        const job = jobs.get(jobId);
        if (job) { job.status = 'error'; job.error = err.message; }
        emitToUser(userId, 'playground:error', { jobId, productId, message: err.message });
      });

    return { jobId };
  };

  cancelJob = (jobId) => {
    const job = jobs.get(jobId);
    if (!job) return false;
    if (typeof job.cancel === 'function') job.cancel();
    job.status = 'cancelled';
    return true;
  };

  getJob = (jobId) => jobs.get(jobId) ?? null;

  /**
   * Parse the proposal's FM content (current + proposed) into plain trees
   * that the client can render without depending on spl-js-engine.
   */
  getFmTrees = async (runId) => {
    const run = await this.agentRunRepository.findById(runId);
    if (!run) throw new Error('Run not found');

    const proposal = run.proposals.find((p) => p.kind === 'fm_patch' && !p.decision) ?? null;
    const modelPath = proposal?.body?.modelPath ?? '';
    const fmType = modelPath.endsWith('.xml') ? 'XML' : 'UVL';

    const parse = (content, type) => {
      if (!content) return null;
      try {
        const fm = parseFeatureModel({ content, type });
        return this.#fmToTree(fm);
      } catch {
        return null;
      }
    };

    return {
      current: parse(proposal?.body?.fmOld ?? null, fmType),
      proposed: parse(proposal?.body?.newModelUvl ?? null, 'UVL'),
    };
  };

  /**
   * Derive + merge a product (same pipeline as the test runner, without the test run),
   * then zip the result and return { buffer: Buffer, productName: string }.
   */
  generateDownloadZip = async ({ runId, userId, productId, branch, featureSelection, overrideWithLineChanges }) => {
    const run = await this.agentRunRepository.findById(runId);
    if (!run) throw new Error('Run not found');

    const proposal = run.proposals.find((p) => p.kind === 'fm_patch' && !p.decision) ?? null;
    const uuid = uuidv4();
    const tmp = path.join(properties.paths.output, `playground-dl-${uuid}`);
    fs.mkdirSync(tmp, { recursive: true });

    try {
      const { productOutput, productName } = await this.#prepareWorkspace({
        userId, productId, branch, featureSelection, overrideWithLineChanges, proposal, tmp,
      });

      const zip = new JSZip();
      this.#addDirToZip(zip, productOutput, '');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });

      return { buffer, productName };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  #productAccessWithSpec = async ({ productId, userId, context }) => {
    const access = await productAccess({ productId, userId });
    const { product } = access;
    const { spec: resolvedSpec, source, reason } = await Container.get(ProductSpecService).getSpecFromHostOrCache({
      productProjectId: product.repo.id, fallbackSpec: product.spec, context, userId,
    });
    if (reason === 'infra') {
      throw new ProductSpecUnavailableError(
        `No se pudo leer el spec del producto ${productId} en el host git, así que no se sabe cuál es su spec ` +
        'real (features, testEnvironment...). Se cancela para no derivar código ni decidir un veredicto de test ' +
        'sobre una caché posiblemente obsoleta. Reintenta cuando el host git responda.'
      );
    }
    product.spec = source === 'repo' ? normalizeProductSpec({ spec: resolvedSpec }) : resolvedSpec;
    return access;
  };

  // ── private: workspace pipeline (shared by test + download) ─────────────────

  /**
   * Downloads the product, has LINEA derive it from the line, and merges the two.
   * Returns { product, productOutput, productName }.
   * Pass a `log` function to stream progress; omit for silent operation.
   *
   * LINEA does the derivation (it knows how the line is made: its modules, its metamodels): agents asks for the code of the
   * product's spec from the line at `lineBranch` (default `main`), with the `proposal`'s edits applied to the platform first.
   * When `lineBranch` is given any `proposal` patch is ignored — the branch already carries the changes.
   */
  #prepareWorkspace = async ({ userId, productId, branch, featureSelection, overrideWithLineChanges, proposal, tmp, log = null, lineBranch = null }) => {
    const emit = log ?? (() => {});

    const { product, line } = await this.#productAccessWithSpec({
      productId, userId, context: `PlaygroundService#prepareWorkspace: product ${productId}`,
    });
    const productName = product.spec?.basicData?.name ?? 'product';

    // Skip proposal-based patching when the line was loaded from a working branch.
    const overrides = [];
    if (!lineBranch && proposal?.body) {
      const { newModelUvl, modelPath, fileEdits = [] } = proposal.body;
      if (newModelUvl && modelPath) {
        // The line keeps its feature model as a model of its feature metamodel, not as UVL: LINEA converts it.
        const content = modelPath === FEATURE_MODEL_PATH
          ? await toLineaFeatureModel({ lineId: String(line._id), userId, uvl: normalizeUvl({ uvl: newModelUvl }) })
          : newModelUvl;
        overrides.push({ path: modelPath, action: 'update', content });
      }
      for (const edit of fileEdits) {
        if (!edit?.path || edit.newContent == null) continue;
        overrides.push({ path: edit.path, action: edit.action === 'delete' ? 'delete' : edit.action === 'create' ? 'create' : 'update', content: edit.newContent });
      }
      emit(`Applying proposed FM and ${fileEdits.length} platform file(s).\n`);
    }

    const lineRef = lineBranch || 'main';
    emit(`Deriving product with ${featureSelection.length} feature(s) from the line at ${lineRef}...\n`);
    const spec = { ...product.spec, features: featureSelection };
    const derived = await linea.post(`/api/products/${productId}/zip`, { spec, lineRef, overrides }, { userId, timeoutMs: 10 * 60 * 1000 });
    const { dir: genOutput } = await extractArchive({
      source: Buffer.from(derived, 'base64'),
      destDir: path.join(tmp, 'gen'),
      prefix: '',
    });

    emit(`Downloading product at branch "${branch}"...\n`);
    const { dir: productOutput } = await extractArchive({
      source: await downloadArchive({ id: product.repo.id, userId, ref: branch }),
      destDir: path.join(tmp, 'product'),
      prefix: '',
    });

    emit(`Merging generated code into product...\n`);
    fsExtra.copySync(genOutput, productOutput, { overwrite: overrideWithLineChanges ?? true });

    return { product, productOutput, productName };
  };

  // ── private: test execution ──────────────────────────────────────────────────

  #execute = async ({ jobId, userId, proposal, productId, branch, featureSelection, overrideWithLineChanges, testCommand, testImage, signal = null, lineBranch = null, skipTests = false }) => {
    const uuid = uuidv4();
    const tmp = path.join(properties.paths.output, `playground-${uuid}`);
    fs.mkdirSync(tmp, { recursive: true });

    try {
      emitToUser(userId, 'playground:start', { jobId, productId });

      const log = (msg) => this.#log(userId, jobId, productId, msg);

      const { product, productOutput } = await this.#prepareWorkspace({
        userId, productId, branch, featureSelection, overrideWithLineChanges, proposal, tmp, log, lineBranch,
      });

      // Deploy mode — instead of running the product's test suite, exercise the
      // build/deploy pipeline: detect a Docker image or a build command, run it
      // and pass/fail based on whether the artifact compiles. Verifies that the
      // FM + platform changes still produce a runnable product without needing
      // the product's tests to be wired up.
      if (skipTests) {
        const build = this.#detectDeployCommand(productOutput);
        if (!build) {
          log(`[deploy] No build/deploy command could be auto-detected. Add a Dockerfile, a `);
          log(`package.json "build" script, a pom.xml, a Cargo.toml, or a go.mod to enable this.\n`);
          const job = jobs.get(jobId);
          if (job) { job.status = 'error'; job.error = 'No deploy command detected'; }
          emitToUser(userId, 'playground:error', { jobId, productId, message: 'No deploy command detected.' });
          return;
        }

        const productTestEnv = product.spec?.basicData?.testEnvironment ?? {};
        const deployImage = testImage?.trim() || productTestEnv.image || build.image || null;

        log(`\n[deploy] Running build/deploy: ${build.cmd}${deployImage ? ` (in ${deployImage})` : ''}\n`);
        log(`[deploy] This exercises the compile pipeline without running the test suite.\n`);

        const exitCode = deployImage
          ? await this.#runInDocker(build.cmd, productOutput, deployImage, log, signal)
          : await this.#runLocal(build.cmd, productOutput, log, signal);

        const job = jobs.get(jobId);
        const ok = exitCode === 0;
        if (job) { job.status = ok ? 'passed' : 'failed'; job.exitCode = exitCode; }
        log(`\n[deploy] exit code: ${exitCode}${ok ? ' — product compiled and would deploy.' : ' — build failed.'}\n`);
        emitToUser(userId, 'playground:done', { jobId, productId, exitCode, passed: ok });
        return;
      }

      const productTestEnv = product.spec?.basicData?.testEnvironment ?? {};

      // Resolve Docker image: explicit → product config → file-based auto-detect → local
      let image = testImage?.trim() || null;
      if (image === 'local') image = null;
      if (image === null) {
        if (productTestEnv.image) {
          image = productTestEnv.image;
          log(`[product config] image: ${image}\n`);
        } else {
          const detected = this.#detectTestImage(productOutput);
          if (detected) {
            image = detected;
            log(`[auto-detected image] ${image}\n`);
          }
        }
      }

      // Resolve test command: explicit → product config → file-based auto-detect → error
      let cmd = testCommand?.trim() || '';
      if (!cmd) {
        if (productTestEnv.command) {
          cmd = productTestEnv.command;
          log(`[product config] cmd: ${cmd}\n`);
        } else {
          cmd = this.#detectTestCommand(productOutput);
          if (!cmd) {
            log(`[error] Could not auto-detect a test command. Set one in the product's Configuration tab or the "Test cmd" field.\n`);
            const job = jobs.get(jobId);
            if (job) { job.status = 'error'; job.error = 'No test command found'; }
            emitToUser(userId, 'playground:error', { jobId, productId, message: 'No test command found.' });
            return;
          }
          log(`[auto-detected cmd] ${cmd}\n`);
        }
      }

      log(`Running: ${cmd}${image ? ` (in ${image})` : ''}\n`);

      const exitCode = image
        ? await this.#runInDocker(cmd, productOutput, image, log, signal)
        : await this.#runLocal(cmd, productOutput, log, signal);

      const job = jobs.get(jobId);
      if (job) { job.status = exitCode === 0 ? 'passed' : 'failed'; job.exitCode = exitCode; }
      emitToUser(userId, 'playground:done', { jobId, productId, exitCode, passed: exitCode === 0 });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  /**
   * Test a product against a set of proposed file edits, streaming progress via
   * WebSocket events (playground:start / playground:log / playground:done /
   * playground:error). Returns { jobId } immediately.
   * Used by the sync review dialog's "Test product" button.
   */
  testProposalEdits = async ({ userId, productId, branch, fileEdits = [] }) => {
    const jobId = uuidv4();
    const abortController = new AbortController();
    jobs.set(jobId, { status: 'running', productId, exitCode: null, error: null, cancel: () => abortController.abort() });

    this.#executeFileEdits({ jobId, userId, productId, branch, fileEdits, signal: abortController.signal }).catch((err) => {
      const job = jobs.get(jobId);
      if (job) { job.status = 'error'; job.error = err.message; }
      emitToUser(userId, 'playground:error', { jobId, productId, message: err.message });
    });

    return { jobId };
  };

  /**
   * Run a product's own test suite (its committed code at `branch`, no edits) and
   * persist the outcome as a TestResult. Streams the usual playground:* events.
   * This is the Sync Console's per-product "Run tests" action. Returns { jobId }.
   */
  runStandaloneProductTest = async ({ userId, productId, branch = 'main' }) => {
    const jobId = uuidv4();
    const abortController = new AbortController();
    jobs.set(jobId, { status: 'running', productId, exitCode: null, error: null, cancel: () => abortController.abort() });

    this.#executeFileEdits({ jobId, userId, productId, branch, fileEdits: [], persist: true, signal: abortController.signal }).catch((err) => {
      const job = jobs.get(jobId);
      if (job) { job.status = 'error'; job.error = err.message; }
      emitToUser(userId, 'playground:error', { jobId, productId, message: err.message });
      void this.#persistTestResult({ userId, product: null, productId, passed: false, exitCode: null, status: 'error', logTail: err.message });
    });

    return { jobId };
  };

  // Best-effort write of a product test outcome. Never throws into the caller.
  // `product` is the fetched Product doc when available (carries line + version);
  // on an early error it may be null, in which case a minimal record is stored.
  #persistTestResult = async ({ userId, product, productId, passed, exitCode, status, logTail, durationMs = null }) => {
    try {
      const Model = this.testResultRepository.model;
      await this.testResultRepository.save(
        new Model({
          productId: product?._id ?? productId,
          lineId: product?.lineId ?? null,
          version: product?.spec?.basicData?.version ?? null,
          features: product ? normalizeFeatureSelection({ spec: product.spec }) : [],
          passed: Boolean(passed),
          exitCode: exitCode ?? null,
          durationMs,
          status: status ?? (passed ? 'passed' : 'failed'),
          logTail: (logTail ?? '').slice(-LOG_TAIL_CHARS),
          createdBy: userId ?? null,
        })
      );
    } catch (err) {
      console.error('[playground] failed to persist test result:', err?.message ?? err);
    }
  };

  #executeFileEdits = async ({ jobId, userId, productId, branch, fileEdits, persist = false, signal = null }) => {
    const uuid = uuidv4();
    const tmp = path.join(properties.paths.output, `sync-test-${uuid}`);
    fs.mkdirSync(tmp, { recursive: true });

    const startedAt = Date.now();
    let tail = '';
    try {
      emitToUser(userId, 'playground:start', { jobId, productId });
      const log = (msg) => {
        if (persist) tail = (tail + msg).slice(-LOG_TAIL_CHARS);
        this.#log(userId, jobId, productId, msg);
      };

      const { product } = await this.#productAccessWithSpec({
        productId, userId, context: `PlaygroundService#executeFileEdits: product ${productId}`,
      });
      const productTestEnv = product.spec?.basicData?.testEnvironment ?? {};

      const cmd = productTestEnv.command || '';
      if (!cmd) {
        log(`[error] No test command configured for this product. Set one in the product's Configuration tab.\n`);
        const job = jobs.get(jobId);
        if (job) { job.status = 'error'; job.error = 'No test command found'; }
        emitToUser(userId, 'playground:error', { jobId, productId, message: 'No test command configured for this product.' });
        if (persist) await this.#persistTestResult({ userId, product, productId, passed: false, exitCode: null, status: 'error', logTail: tail });
        return;
      }

      log(`Downloading product at branch "${branch}"...\n`);
      const { dir: productOutput } = await extractArchive({
        source: await downloadArchive({ id: product.repo.id, userId, ref: branch }),
        destDir: path.join(tmp, 'product'),
        prefix: '',
      });

      log(`Applying ${fileEdits.length} proposed edit(s)...\n`);
      for (const edit of fileEdits) {
        if (!edit?.path || edit.newContent == null) continue;
        const dest = path.join(productOutput, edit.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (edit.action === 'delete') {
          try { fs.rmSync(dest, { force: true }); } catch {}
        } else {
          fs.writeFileSync(dest, edit.newContent, 'utf8');
        }
      }

      const image = productTestEnv.image || this.#detectTestImage(productOutput) || null;
      if (image) log(`[image] ${image}\n`);

      log(`Running: ${cmd}${image ? ` (in ${image})` : ''}\n`);

      const exitCode = image
        ? await this.#runInDocker(cmd, productOutput, image, log, signal)
        : await this.#runLocal(cmd, productOutput, log, signal);

      const job = jobs.get(jobId);
      if (job) { job.status = exitCode === 0 ? 'passed' : 'failed'; job.exitCode = exitCode; }
      emitToUser(userId, 'playground:done', { jobId, productId, exitCode, passed: exitCode === 0 });
      if (persist) {
        await this.#persistTestResult({
          userId, product, productId,
          passed: exitCode === 0, exitCode,
          status: exitCode === 0 ? 'passed' : 'failed',
          logTail: tail, durationMs: Date.now() - startedAt,
        });
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  /**
   * Silent test run for agent-internal use (no WebSocket events).
   * Downloads the product at `branch`, applies `fileEdits` in memory, then runs
   * the configured tests. Returns { passed, exitCode, log, noTestCommand }.
   * Used by the Sync agent's test-resolution loop.
   */
  testFileEdits = async ({ userId, productId, branch, fileEdits = [] }) => {
    const uuid = uuidv4();
    const tmp = path.join(properties.paths.output, `sync-test-${uuid}`);
    fs.mkdirSync(tmp, { recursive: true });
    const lines = [];
    const log = (line) => lines.push(line);

    try {
      const { product } = await this.#productAccessWithSpec({
        productId, userId, context: `PlaygroundService#testFileEdits: product ${productId}`,
      });
      const productTestEnv = product.spec?.basicData?.testEnvironment ?? {};

      if (!productTestEnv.command) {
        return { passed: false, exitCode: 0, log: '', noTestCommand: true };
      }

      log(`Downloading product at branch "${branch}"...\n`);
      const { dir: productOutput } = await extractArchive({
        source: await downloadArchive({ id: product.repo.id, userId, ref: branch }),
        destDir: path.join(tmp, 'product'),
        prefix: '',
      });

      log(`Applying ${fileEdits.length} resolution edit(s)...\n`);
      for (const edit of fileEdits) {
        if (!edit?.path || edit.newContent == null) continue;
        const dest = path.join(productOutput, edit.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (edit.action === 'delete') {
          try { fs.rmSync(dest, { force: true }); } catch {}
        } else {
          fs.writeFileSync(dest, edit.newContent, 'utf8');
        }
      }

      let image = productTestEnv.image || this.#detectTestImage(productOutput) || null;
      if (image) log(`[image] ${image}\n`);

      const cmd = productTestEnv.command;
      log(`Running: ${cmd}${image ? ` (in ${image})` : ''}\n`);

      const exitCode = image
        ? await this.#runInDocker(cmd, productOutput, image, log, null)
        : await this.#runLocal(cmd, productOutput, log, null);

      return { passed: exitCode === 0, exitCode, log: lines.join(''), noTestCommand: false };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  /**
   * Silent, variability-aware validation for the Test-Authoring agent: apply
   * proposed LINE (platform) `fileEdits`, derive `productId` at its feature
   * selection, then run that product's tests. This is how a feature-gated
   * platform test is checked — by actually generating a product that selects the
   * feature. Returns { passed, exitCode, log, noTestCommand }.
   */
  testPlatformFileEdits = async ({ userId, productId, fileEdits = [], featureSelection = null, branch = 'main' }) => {
    const uuid = uuidv4();
    const tmp = path.join(properties.paths.output, `agent-test-${uuid}`);
    fs.mkdirSync(tmp, { recursive: true });
    const lines = [];
    const log = (line) => lines.push(line);

    try {
      const { product } = await this.#productAccessWithSpec({
        productId, userId, context: `PlaygroundService#testPlatformFileEdits: product ${productId}`,
      });
      const productTestEnv = product.spec?.basicData?.testEnvironment ?? {};
      if (!productTestEnv.command) {
        return { passed: false, exitCode: 0, log: '', noTestCommand: true };
      }

      const sel = featureSelection ?? normalizeFeatureSelection({ spec: product.spec });
      const { productOutput } = await this.#prepareWorkspace({
        userId,
        productId,
        branch,
        featureSelection: sel,
        overrideWithLineChanges: true,
        proposal: { body: { fileEdits } },
        tmp,
        log,
      });

      const image = productTestEnv.image || this.#detectTestImage(productOutput) || null;
      const cmd = productTestEnv.command;
      log(`Running: ${cmd}${image ? ` (in ${image})` : ''}\n`);

      const exitCode = image
        ? await this.#runInDocker(cmd, productOutput, image, log, null)
        : await this.#runLocal(cmd, productOutput, log, null);

      return { passed: exitCode === 0, exitCode, log: lines.join(''), noTestCommand: false };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  #log = (userId, jobId, productId, line) => {
    emitToUser(userId, 'playground:log', { jobId, productId, line });
  };

  // Run command directly on the server process, with optional AbortSignal for cancellation.
  #runLocal = (cmd, cwd, log, signal = null) => {
    return new Promise((resolve) => {
      const proc = spawn(cmd, { cwd, shell: true });
      const timeoutMs = getTestTimeoutMs();
      const timer = timeoutMs
        ? setTimeout(() => {
            log(`\n[error] Test timed out after ${timeoutMs / 1000}s — killing process.\n`);
            try { proc.kill('SIGTERM'); } catch {}
          }, timeoutMs)
        : null;

      if (signal) {
        signal.addEventListener('abort', () => {
          log(`\n[cancelled] Test job cancelled.\n`);
          try { proc.kill('SIGTERM'); } catch {}
        }, { once: true });
      }

      proc.stdout.on('data', (chunk) => log(chunk.toString()));
      proc.stderr.on('data', (chunk) => log(chunk.toString()));
      proc.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (code === 127) {
          const tool = cmd.split(/\s+/)[0];
          log(`\n[error] "${tool}" was not found — ensure it is installed in the server environment, or pick a Docker image.\n`);
        }
        resolve(code ?? 1);
      });
      proc.on('error', (err) => {
        if (timer) clearTimeout(timer);
        log(`[error] ${err.message}\n`);
        resolve(1);
      });
    });
  };

  /**
   * Run a command inside a throwaway Docker container.
   * 1. docker create  — creates container, sets up workdir
   * 2. docker cp      — copies product files into the container
   * 3. docker start --attach — runs and streams stdout+stderr
   * The container ID is tracked in activeContainers for process-exit cleanup.
   */
  #runInDocker = async (cmd, srcDir, image, log, signal = null) => {
    let containerId = null;
    const timeoutMs = getTestTimeoutMs();

    const forceRemove = async (id) => {
      activeContainers.delete(id);
      try { await this.#spawnCapture('docker', ['rm', '-f', id]); } catch {}
    };

    try {
      containerId = await this.#spawnCapture('docker', [
        'create', '-w', '/workspace', image, 'sh', '-c', cmd,
      ]);
      activeContainers.add(containerId);

      await this.#spawnCapture('docker', ['cp', `${srcDir}/.`, `${containerId}:/workspace/`]);

      const exitCode = await new Promise((resolve) => {
        const proc = spawn('docker', ['start', '--attach', containerId], { shell: false });
        let done = false;

        const finish = (code) => {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          resolve(code ?? 1);
        };

        const timer = timeoutMs
          ? setTimeout(() => {
              log(`\n[error] Test timed out after ${timeoutMs / 1000}s — stopping container.\n`);
              try { spawn('docker', ['stop', containerId], { stdio: 'ignore' }); } catch {}
              finish(1);
            }, timeoutMs)
          : null;

        if (signal) {
          signal.addEventListener('abort', () => {
            log(`\n[cancelled] Test job cancelled — stopping container.\n`);
            try { spawn('docker', ['stop', containerId], { stdio: 'ignore' }); } catch {}
            finish(1);
          }, { once: true });
        }

        proc.stdout.on('data', (chunk) => log(chunk.toString()));
        proc.stderr.on('data', (chunk) => log(chunk.toString()));
        proc.on('close', (code) => finish(code));
        proc.on('error', (err) => {
          log(`[error] ${err.message}\n`);
          finish(1);
        });
      });

      await forceRemove(containerId);
      return exitCode;
    } catch (err) {
      log(`[docker error] ${err.message}\n`);
      if (containerId) await forceRemove(containerId);
      return 1;
    }
  };

  // Spawn a process, capture stdout, reject on non-zero exit.
  #spawnCapture = (cmd, args) => new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d; });
    proc.stderr?.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
      else resolve(stdout.trim());
    });
    proc.on('error', reject);
  });

  // ── private: auto-detection ──────────────────────────────────────────────────

  #detectTestCommand = (dir) => {
    const pkgJson = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJson)) {
      try {
        const scripts = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).scripts ?? {};
        if (scripts.test) return 'npm test';
        if (scripts['test:unit']) return 'npm run test:unit';
        if (scripts['test:e2e']) return 'npm run test:e2e';
        if (scripts['test:ci']) return 'npm run test:ci';
      } catch {}
      return 'npm test';
    }
    if (fs.existsSync(path.join(dir, 'pom.xml'))) return 'mvn test';
    const gradlew = fs.existsSync(path.join(dir, 'gradlew')) ? './gradlew' : 'gradle';
    if (fs.existsSync(path.join(dir, 'build.gradle')) || fs.existsSync(path.join(dir, 'build.gradle.kts'))) return `${gradlew} test`;
    if (fs.existsSync(path.join(dir, 'go.mod'))) return 'go test ./...';
    if (fs.existsSync(path.join(dir, 'Cargo.toml'))) return 'cargo test';
    if (fs.existsSync(path.join(dir, 'Makefile'))) return 'make test';
    return null;
  };

  /**
   * Auto-detect a build/deploy command for the "assume tests pass" flow.
   * Returns { cmd, image } — image is a suggested Docker image when the
   * ecosystem has a canonical one. Priority:
   *   Dockerfile  → docker build (local, needs the host daemon)
   *   package.json build script → npm run build
   *   package.json (no build)   → npm ci  (install-only smoke)
   *   pom.xml → mvn -DskipTests package
   *   gradle  → gradle build -x test
   *   go.mod  → go build ./...
   *   Cargo.toml → cargo build --release
   *   requirements.txt / pyproject.toml → pip install
   */
  #detectDeployCommand = (dir) => {
    if (fs.existsSync(path.join(dir, 'Dockerfile'))) {
      // Docker build runs on the host daemon (mounted socket); pass image=null.
      return { cmd: 'docker build -t sandbox-product:latest .', image: null };
    }
    const pkgJson = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJson)) {
      // `npm ci` requires a package-lock.json / npm-shrinkwrap.json — fall back
      // to `npm install` when the lockfile is missing so first-time products
      // still exercise the pipeline.
      const hasLock = fs.existsSync(path.join(dir, 'package-lock.json'))
        || fs.existsSync(path.join(dir, 'npm-shrinkwrap.json'));
      const install = hasLock ? 'npm ci' : 'npm install --no-audit --no-fund';
      try {
        const scripts = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).scripts ?? {};
        if (scripts.build) return { cmd: `${install} && npm run build`, image: 'node:20' };
      } catch { /* ignore */ }
      return { cmd: install, image: 'node:20' };
    }
    if (fs.existsSync(path.join(dir, 'pom.xml'))) {
      return { cmd: 'mvn -DskipTests package', image: 'maven:3.9-eclipse-temurin-17' };
    }
    if (fs.existsSync(path.join(dir, 'build.gradle')) || fs.existsSync(path.join(dir, 'build.gradle.kts'))) {
      const wrapper = fs.existsSync(path.join(dir, 'gradlew')) ? './gradlew' : 'gradle';
      const image = wrapper === './gradlew' ? 'eclipse-temurin:21-jdk' : 'gradle:8-jdk21';
      return { cmd: `${wrapper} build -x test`, image };
    }
    if (fs.existsSync(path.join(dir, 'go.mod'))) return { cmd: 'go build ./...', image: 'golang:1.22' };
    if (fs.existsSync(path.join(dir, 'Cargo.toml'))) return { cmd: 'cargo build --release', image: 'rust:1.77' };
    if (fs.existsSync(path.join(dir, 'requirements.txt'))) {
      return { cmd: 'pip install --no-cache-dir -r requirements.txt', image: 'python:3.12' };
    }
    if (fs.existsSync(path.join(dir, 'pyproject.toml'))) {
      return { cmd: 'pip install --no-cache-dir .', image: 'python:3.12' };
    }
    if (fs.existsSync(path.join(dir, 'Makefile'))) return { cmd: 'make', image: null };
    return null;
  };

  #detectTestImage = (dir) => {
    if (fs.existsSync(path.join(dir, 'package.json'))) return 'node:20';
    if (fs.existsSync(path.join(dir, 'pom.xml'))) return 'maven:3.9-eclipse-temurin-17';
    if (fs.existsSync(path.join(dir, 'build.gradle')) || fs.existsSync(path.join(dir, 'build.gradle.kts'))) {
      return fs.existsSync(path.join(dir, 'gradlew')) ? 'eclipse-temurin:21-jdk' : 'gradle:8-jdk21';
    }
    if (fs.existsSync(path.join(dir, 'go.mod'))) return 'golang:1.22';
    if (fs.existsSync(path.join(dir, 'requirements.txt')) || fs.existsSync(path.join(dir, 'pyproject.toml'))) return 'python:3.12';
    if (fs.existsSync(path.join(dir, 'Cargo.toml'))) return 'rust:1.77';
    return null;
  };

  // ── private: zip helpers ─────────────────────────────────────────────────────

  #addDirToZip = (zip, dirPath, prefix) => {
    for (const entry of fs.readdirSync(dirPath)) {
      const fullPath = path.join(dirPath, entry);
      const zipPath = prefix ? `${prefix}/${entry}` : entry;
      if (fs.statSync(fullPath).isDirectory()) {
        this.#addDirToZip(zip, fullPath, zipPath);
      } else {
        zip.file(zipPath, fs.readFileSync(fullPath));
      }
    }
  };

  /**
   * Fire fake WebSocket events so the client's Run button visibly cycles
   * start → log → done even when the git host is not reachable. Used by the sandbox
   * flow's mock fallback. Never touches Docker or the git host.
   */
  runMockProductTest = ({ userId, productId, reason = 'the git host is not reachable' }) => {
    const jobId = uuidv4();
    jobs.set(jobId, { status: 'running', productId, exitCode: null, error: null, cancel: () => {} });

    setImmediate(() => {
      emitToUser(userId, 'playground:start', { jobId, productId });
      const line = (msg) => emitToUser(userId, 'playground:log', { jobId, productId, line: msg });

      line(`[mock] ${reason}. Emitting a synthetic passing run so the UI stays exercisable.\n`);
      line(`[mock] Sign in to the git host in LINEA and set ANTHROPIC_API_KEY\n`);
      line(`[mock] in the server env to switch this over to real product+Docker runs — the\n`);
      line(`[mock] same client button will hit the real pipeline once those are in place.\n`);
      line(`[mock] --------------------------------------------------------------\n`);
      line(`[mock] Would download line at plan/ branch, apply the sandbox edits,\n`);
      line(`[mock] derive the product with its current feature selection, and run\n`);
      line(`[mock] the configured test command in a throwaway Docker container.\n`);
      line(`\n[mock] exit code: 0\n`);

      const job = jobs.get(jobId);
      if (job) { job.status = 'passed'; job.exitCode = 0; }
      emitToUser(userId, 'playground:done', { jobId, productId, exitCode: 0, passed: true });
    });

    return { jobId, mock: true };
  };

  // ── plan-branch mode (changeset sandbox) ───────────────────────────────────

  /**
   * Parse the line FM at `main` (current) and at `planBranch` (proposed) into
   * plain trees for the playground's FM selector. Used by the sandbox tab.
   */
  getFmTreesFromBranch = async ({ userId, lineId, planBranch }) => {
    if (!lineId || !planBranch) throw new Error('lineId and planBranch are required.');
    const [{ model: current }, { model: proposed }] = await Promise.all([
      loadFeatureModel({ lineId, userId }),
      loadFeatureModelFromBranch({ lineId, userId, branch: planBranch }),
    ]);
    return {
      current: this.#fmToTree(current),
      proposed: this.#fmToTree(proposed),
    };
  };

  /**
   * Run a product test against a plan/ branch of the line (sandbox mode).
   * Streams progress via the same playground:* events.
   */
  runProductTestOnBranch = async ({
    userId, productId, lineBranch,
    branch = 'main', featureSelection = [], overrideWithLineChanges = true,
    testCommand = '', testImage = '', skipTests = false,
  }) => {
    if (!lineBranch) throw new Error('lineBranch is required.');
    const jobId = uuidv4();
    const abortController = new AbortController();
    jobs.set(jobId, { status: 'running', productId, exitCode: null, error: null, cancel: () => abortController.abort() });

    this.#execute({
      jobId, userId, proposal: null, productId, branch, featureSelection,
      overrideWithLineChanges, testCommand, testImage, lineBranch, skipTests,
      signal: abortController.signal,
    }).catch((err) => {
      const job = jobs.get(jobId);
      if (job) { job.status = 'error'; job.error = err.message; }
      emitToUser(userId, 'playground:error', { jobId, productId, message: err.message });
    });

    return { jobId };
  };

  /**
   * Derive + merge a product against a plan/ branch and return a zip buffer.
   * Sibling of generateDownloadZip for the sandbox flow.
   */
  generateBranchDownloadZip = async ({
    userId, productId, lineBranch,
    branch = 'main', featureSelection = [], overrideWithLineChanges = true,
  }) => {
    if (!lineBranch) throw new Error('lineBranch is required.');
    const uuid = uuidv4();
    const tmp = path.join(properties.paths.output, `playground-dl-${uuid}`);
    fs.mkdirSync(tmp, { recursive: true });

    try {
      const { productOutput, productName } = await this.#prepareWorkspace({
        userId, productId, branch, featureSelection, overrideWithLineChanges,
        proposal: null, tmp, lineBranch,
      });

      const zip = new JSZip();
      this.#addDirToZip(zip, productOutput, '');
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });

      return { buffer, productName };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  // ── private: FM tree serialisation ──────────────────────────────────────────

  #fmToTree = (node) => {
    if (!node) return null;
    return {
      name: node.name,
      type: node.type ?? 'AND',
      mandatory: Boolean(node.mandatory),
      hidden: Boolean(node.hidden),
      children: Array.isArray(node.features)
        ? node.features.map((c) => this.#fmToTree(c)).filter(Boolean)
        : [],
    };
  };
}

Container.set(PlaygroundService, new PlaygroundService());
