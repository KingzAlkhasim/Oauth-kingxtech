import { initSentry, Sentry } from './lib/sentry';
initSentry(); // must run before express/other modules are set up

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { env } from './config/env';
import { generateContent } from './services/aiRouter';
import { getHistoryFromDb, saveMessageToDb, deleteSessionHistory } from './services/chatHistory';
import { touchSession, listSessions, deleteSession } from './services/sessions';
import { parseModelTag, listModelsForClient, tagForModel } from './services/modelRegistry';
import { consumeCredits, getCreditsRemaining, logUsage, getUsageLog, checkModelRequestCap, getUserPlan, chargeUserByApiKey, convertWalletToCredits } from './services/credits';
import { getTurnChanges, revertTurn, revertFileToPreviousVersion } from './services/versioning';
import { executeTerminalCommand } from './services/commandExecutor';
import { initializePaystackTransaction } from './services/paystackCheckout';
import { runSecurityCheck, SECURITY_CHECK_CREDIT_COST } from './services/securityCheck';
import { buildPublicEnvScript } from './services/publicEnv';
import { listProjectEnvVars, upsertProjectEnvVar, deleteProjectEnvVar } from './services/projectEnvVars';
import {
  saveGithubToken,
  deleteGithubToken,
  hasGithubToken,
  listGithubRepos,
  linkProjectToRepo,
  getProjectGithubLink,
  pushProjectToGithub,
  importRepoIntoProject,
} from './services/github';
import {
  listProjectFiles,
  readProjectFile,
  readProjectFilePublic,
  writeProjectFile,
  createProjectFolder,
  deleteProjectFile,
  publishProject,
  getProjectIdBySlug,
  getProjectOwnerId,
  assertProjectOwnership,
  ProjectAccessError,
} from './services/projectFs';
import { requireAuth, type AuthedRequest } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';

const app = express();
app.use(helmet());
app.use(cors({ origin: env.ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '2mb' }));

async function handleFsError(res: express.Response, error: unknown) {
  if (error instanceof ProjectAccessError) {
    // Expected access-control rejection, not a bug — no Sentry report.
    res.status(403).json({ success: false, error: error.message });
    return;
  }
  console.error('Project FS error:', error);
  Sentry.captureException(error, { tags: { route: res.req?.path } });
  // Cloud Run can freeze/scale an instance down right after the response is
  // sent, and Sentry delivers events asynchronously in the background —
  // without this flush, errors on a scaled-down instance can silently never
  // reach Sentry at all. 2s cap so a slow network never hangs the response.
  await Sentry.flush(2000).catch(() => {});
  res.status(500).json({ success: false, error: 'Internal error.' });
}

// Same reporting + flush pattern as handleFsError, for routes that build
// their own status code / message instead of the generic "Internal error."
async function reportError(
  res: express.Response,
  status: number,
  message: string,
  error: unknown,
  logLabel: string
) {
  console.error(logLabel, error);
  Sentry.captureException(error, { tags: { route: res.req?.path } });
  await Sentry.flush(2000).catch(() => {});
  res.status(status).json({ success: false, error: message });
}

// --- POST /api/ai/generate ---------------------------------------------
// Streams progress as Server-Sent Events: one "step" event per tool call
// as it happens (so the UI can show "Building…", "Running command…" live),
// then one final "done" event with the complete result.
app.post('/api/ai/generate', requireAuth, rateLimit, async (req: AuthedRequest, res) => {
  const { prompt: rawPrompt, sessionId, projectId } = req.body;
  const userId = req.user!.id;

  if (!sessionId) {
    res.status(400).json({ success: false, error: 'sessionId is required' });
    return;
  }
  if (!rawPrompt || typeof rawPrompt !== 'string') {
    res.status(400).json({ success: false, error: 'prompt is required' });
    return;
  }

  const { model, cleanPrompt, unknownTag } = parseModelTag(rawPrompt);

  // Plan gate — free-plan users can only use the genuinely-free open-weights
  // models. Everything else (Gemini, Claude, GPT) needs a paid plan, since
  // it either costs KingxTech real money or is a premium third-party model.
  if (model.requiresPaidPlan) {
    const plan = await getUserPlan(userId);
    if (plan !== 'paid') {
      res.status(402).json({
        success: false,
        error: `${model.label} needs a paid plan. Try the free tier instead — no tag needed, or use :Q-qwen/ or :Q-llama/.`,
      });
      return;
    }
  }

  // Per-model request cap (e.g. Gemini Flash: 5/month) — checked before the
  // shared credit pool, since this exists specifically to bound models that
  // cost KingxTech real money per call, independent of remaining credits.
  if (model.requestCap) {
    try {
      const capCheck = await checkModelRequestCap(userId, model.code, model.requestCap);
      if (!capCheck.ok) {
        res.status(402).json({
          success: false,
          error: `${model.label} is limited to ${model.requestCap} messages/month (you've used ${capCheck.used}). Try the free Qwen3 Coder model (no tag needed) instead.`,
        });
        return;
      }
    } catch (error) {
      await reportError(res, 500, 'Failed to check model usage limit', error, 'Request cap check error:');
      return;
    }
  }

  // Credit gate happens BEFORE we switch to streaming mode, so failures here
  // are still plain JSON responses with normal status codes.
  //
  // Direct API key usage (req.authMethod === 'api_key') is billed differently
  // from the in-app K-XpertAI chat: it charges the wallet directly in real
  // dollars via chargeUserByApiKey, logged in usage_log (Console → AI Lab →
  // "API key usage") — completely separate from the free monthly credit pool
  // a logged-in session draws from. USD_PER_CREDIT keeps the two systems
  // priced consistently: a model costing N credits costs N * $0.01 via API key.
  const USD_PER_CREDIT = 0.01;
  let credit;
  try {
    if (req.authMethod === 'api_key') {
      const charge = await chargeUserByApiKey(userId, model.creditCost * USD_PER_CREDIT);
      if (!charge.allowed) {
        res.status(402).json({ success: false, error: `Insufficient wallet balance — need $${(model.creditCost * USD_PER_CREDIT).toFixed(2)}, have $${charge.balance.toFixed(2)}.` });
        return;
      }
      credit = { ok: true, remaining: 0 }; // not meaningful for API-key billing; kept for shared code below
    } else {
      credit = await consumeCredits(userId, model.creditCost);
    }
  } catch (error) {
    await reportError(res, 500, 'Failed to check credits', error, 'Credit check error:');
    return;
  }
  if (!credit.ok) {
    res.status(402).json({
      success: false,
      error: `You've used your 300 free credits for this month. They reset next month, or premium billing is coming soon.`,
      creditsRemaining: credit.remaining,
    });
    return;
  }

  // From here on, everything streams as SSE.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const sendEvent = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const turnId = crypto.randomUUID();
  try {
    const history = await getHistoryFromDb(userId, sessionId);

    // Sentry span around the actual agent turn — records exactly the
    // metric (history payload size) that would have surfaced the unbounded
    // history growth bug: if this climbs unbounded across a long session,
    // it shows up here as a real, visible trend instead of a mystery.
    const historyChars = history.reduce((sum, t) => sum + t.text.length, 0);
    const aiResponse = await Sentry.startSpan(
      {
        name: 'agent.generate',
        op: 'ai.agent',
        attributes: {
          'agent.model_provider': model.provider,
          'agent.model_code': model.code,
          'agent.history_messages': history.length,
          'agent.history_chars': historyChars,
        },
      },
      () =>
        generateContent(
          cleanPrompt,
          model.provider,
          model.modelId,
          history,
          { userId, projectId: projectId || undefined, turnId },
          (step) => sendEvent({ type: 'step', step })
        )
    );

    await touchSession(userId, sessionId, projectId || undefined, cleanPrompt);
    await saveMessageToDb(userId, sessionId, { role: 'user', text: cleanPrompt });
    await saveMessageToDb(userId, sessionId, { role: 'model', text: aiResponse.text });
    if (req.authMethod !== 'api_key') {
      await logUsage(userId, model.provider, model.code, model.creditCost, projectId || undefined);
    }

    const changes = projectId ? await getTurnChanges(userId, projectId, turnId) : [];

    let output = aiResponse.text;
    if (unknownTag) {
      output = `(Didn't recognize model tag "${unknownTag}" — used ${model.label} instead.)\n\n${output}`;
    }

    sendEvent({
      type: 'done',
      output,
      steps: aiResponse.steps,
      model: { label: model.label, tier: model.tier, creditCost: model.creditCost, tag: tagForModel(model) },
      creditsRemaining: credit.remaining,
      turnId,
      changes,
    });
  } catch (error: any) {
    console.error('Agent Error:', error, 'user:', userId);
    Sentry.captureException(error, { tags: { route: 'api.ai.generate', model_code: model.code } });
    const isRateLimit = error?.status === 429 || /429|rate.?limit/i.test(error?.message ?? '');
    sendEvent({
      type: 'error',
      error: isRateLimit
        ? "The free model is busy right now (shared usage limit) — this is temporary. Wait about 30 seconds and try again."
        : 'Failed to process agent request',
    });
  } finally {
    // Cloud Run can scale an instance down between requests, and Sentry
    // sends events asynchronously in the background — without an explicit
    // flush here, a scaled-down instance can silently drop events that
    // never finished sending. 2s cap so a slow network never hangs the
    // response.
    await Sentry.flush(2000).catch(() => {});
    res.end();
  }
});

// --- Models / credits / usage ----------------------------------------------

app.get('/api/ai/models', requireAuth, (_req, res) => {
  res.json({ success: true, models: listModelsForClient() });
});

// --- Billing: Paystack checkout initialization -----------------------------
// The webhook that actually credits the payment (and flips is_pro_member)
// already exists as a Supabase Edge Function — see
// supabase/functions/billing-webhook/index.ts. This route only starts a
// transaction with real user_id metadata attached, since Paystack's hosted
// Payment Page links don't reliably carry custom metadata through the way
// LemonSqueezy's do.
app.post('/api/billing/paystack/initialize', requireAuth, async (req: AuthedRequest, res) => {
  const email = req.user!.email;
  if (!email) {
    res.status(400).json({ success: false, error: 'Your account has no email on file.' });
    return;
  }
  try {
    const { authorization_url } = await initializePaystackTransaction(req.user!.id, email);
    res.json({ success: true, authorization_url });
  } catch (error: any) {
    await reportError(res, 502, error.message || 'Failed to start checkout', error, 'Paystack initialize error:');
  }
});

app.post('/api/billing/paystack/topup', requireAuth, async (req: AuthedRequest, res) => {
  const email = req.user!.email;
  const amountUsd = Number(req.body?.amountUsd);
  if (!email) {
    res.status(400).json({ success: false, error: 'Your account has no email on file.' });
    return;
  }
  if (!Number.isFinite(amountUsd) || amountUsd < 5 || amountUsd > 500) {
    res.status(400).json({ success: false, error: 'Choose a top-up amount between $5 and $500.' });
    return;
  }
  try {
    const { authorization_url } = await initializePaystackTransaction(req.user!.id, email, {
      purpose: 'credit_topup',
      amountUsd,
    });
    res.json({ success: true, authorization_url });
  } catch (error: any) {
    await reportError(res, 502, error.message || 'Failed to start checkout', error, 'Paystack top-up error:');
  }
});

app.post('/api/billing/convert-to-credits', requireAuth, async (req: AuthedRequest, res) => {
  const usdAmount = Number(req.body?.usdAmount);
  if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
    res.status(400).json({ success: false, error: 'usdAmount must be a positive number.' });
    return;
  }
  try {
    const result = await convertWalletToCredits(req.user!.id, usdAmount);
    if (!result.ok) {
      res.status(402).json({ success: false, error: `Insufficient wallet balance — need $${usdAmount.toFixed(2)}.` });
      return;
    }
    res.json({ success: true, walletBalance: result.walletBalance, purchasedCredits: result.purchasedCredits });
  } catch (error) {
    await reportError(res, 500, 'Failed to convert wallet balance to credits', error, 'Convert-to-credits error:');
  }
});

app.get('/api/ai/credits', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const credits = await getCreditsRemaining(req.user!.id);
    res.json({ success: true, ...credits });
  } catch (error) {
    await reportError(res, 500, 'Failed to fetch credits', error, 'Credits fetch error:');
  }
});

app.get('/api/ai/usage', requireAuth, async (req: AuthedRequest, res) => {
  const limitParam = parseInt(req.query.limit as string, 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
  try {
    const log = await getUsageLog(req.user!.id, limit);
    res.json({ success: true, log });
  } catch (error) {
    await reportError(res, 500, 'Failed to fetch usage', error, 'Usage fetch error:');
  }
});

// --- Turn accept/reject + per-file undo ------------------------------------

app.post('/api/projects/:projectId/turns/:turnId/reject', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await revertTurn(req.user!.id, req.params.projectId, req.params.turnId);
    res.json({ success: true });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.post('/api/projects/:projectId/file/revert', requireAuth, async (req: AuthedRequest, res) => {
  const filePath = req.query.path as string | undefined;
  if (!filePath) {
    res.status(400).json({ success: false, error: 'path query param is required' });
    return;
  }
  try {
    await revertFileToPreviousVersion(req.user!.id, req.params.projectId, filePath);
    res.json({ success: true });
  } catch (error) {
    await handleFsError(res, error);
  }
});

// --- Publish (permanent hosted URL) ----------------------------------------

app.post('/api/projects/:projectId/publish', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const slug = await publishProject(req.user!.id, req.params.projectId);
    const url = env.PUBLIC_SITE_BASE_DOMAIN
      ? `https://${slug}.${env.PUBLIC_SITE_BASE_DOMAIN}/`
      : `/site/${slug}/`;
    res.json({ success: true, slug, url });
  } catch (error) {
    await handleFsError(res, error);
  }
});

// --- Chat sessions -----------------------------------------------------

app.get('/api/ai/sessions', requireAuth, async (req: AuthedRequest, res) => {
  const projectId = req.query.projectId as string | undefined;
  try {
    const sessions = await listSessions(req.user!.id, projectId);
    res.json({ success: true, sessions });
  } catch (error) {
    await reportError(res, 500, 'Failed to fetch sessions', error, 'Sessions fetch error:');
  }
});

app.delete('/api/ai/sessions/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await deleteSession(req.user!.id, req.params.id);
    await deleteSessionHistory(req.user!.id, req.params.id);
    res.json({ success: true });
  } catch (error) {
    await reportError(res, 500, 'Failed to delete session', error, 'Session delete error:');
  }
});

app.get('/api/ai/history', requireAuth, async (req: AuthedRequest, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  const userId = req.user!.id;
  if (!sessionId) {
    res.status(400).json({ success: false, error: 'sessionId is required' });
    return;
  }
  try {
    const history = await getHistoryFromDb(userId, sessionId);
    const messages = history.map((turn) => ({
      role: turn.role === 'model' ? 'system' : 'user',
      text: turn.text,
    }));
    res.json({ success: true, messages });
  } catch (error) {
    await reportError(res, 500, 'Failed to fetch history', error, `History fetch error (user: ${userId}):`);
  }
});

app.delete('/api/ai/history', requireAuth, async (req: AuthedRequest, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  const userId = req.user!.id;
  if (!sessionId) {
    res.status(400).json({ success: false, error: 'sessionId is required' });
    return;
  }
  try {
    await deleteSessionHistory(userId, sessionId);
    res.json({ success: true });
  } catch (error) {
    await reportError(res, 500, 'Failed to clear history', error, `History delete error (user: ${userId}):`);
  }
});

// --- Project file explorer -----------------------------------------------

app.get('/api/projects/:projectId/files', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const files = await listProjectFiles(req.user!.id, req.params.projectId);
    res.json({ success: true, files });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.get('/api/projects/:projectId/file', requireAuth, async (req: AuthedRequest, res) => {
  const filePath = req.query.path as string | undefined;
  if (!filePath) {
    res.status(400).json({ success: false, error: 'path query param is required' });
    return;
  }
  try {
    const file = await readProjectFile(req.user!.id, req.params.projectId, filePath);
    res.json({ success: true, file });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.put('/api/projects/:projectId/file', requireAuth, async (req: AuthedRequest, res) => {
  const filePath = req.query.path as string | undefined;
  const { content } = req.body;
  if (!filePath) {
    res.status(400).json({ success: false, error: 'path query param is required' });
    return;
  }
  if (typeof content !== 'string') {
    res.status(400).json({ success: false, error: 'content (string) is required in the body' });
    return;
  }
  try {
    await writeProjectFile(req.user!.id, req.params.projectId, filePath, content);
    res.json({ success: true });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.post('/api/projects/:projectId/folder', requireAuth, async (req: AuthedRequest, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath || typeof folderPath !== 'string') {
    res.status(400).json({ success: false, error: 'path (string) is required in the body' });
    return;
  }
  try {
    await createProjectFolder(req.user!.id, req.params.projectId, folderPath);
    res.json({ success: true });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.delete('/api/projects/:projectId/file', requireAuth, async (req: AuthedRequest, res) => {
  const filePath = req.query.path as string | undefined;
  if (!filePath) {
    res.status(400).json({ success: false, error: 'path query param is required' });
    return;
  }
  try {
    await deleteProjectFile(req.user!.id, req.params.projectId, filePath);
    res.json({ success: true });
  } catch (error) {
    await handleFsError(res, error);
  }
});

// --- Manual terminal (workspace "Terminal" tab) -----------------------
// Runs the SAME allowlisted commands the AI can use (see commandExecutor.ts)
// — read-only diagnostics only (git status/log/diff, npm test/run/ls,
// node --version, ls, pwd). Important: this executes against the real
// backend container's filesystem, NOT the virtual per-project files stored
// in Supabase — those are separate concepts. This is a diagnostic tool for
// the deployed service, not a shell "inside" the AI-built project.
app.post('/api/projects/:projectId/terminal', requireAuth, rateLimit, async (req: AuthedRequest, res) => {
  const { command, args } = req.body;
  if (!command || typeof command !== 'string') {
    res.status(400).json({ success: false, error: 'command is required' });
    return;
  }
  try {
    await assertProjectOwnership(req.user!.id, req.params.projectId);
    const result = await executeTerminalCommand(command, Array.isArray(args) ? args : []);
    res.json({ success: true, ...result });
  } catch (error) {
    await handleFsError(res, error);
  }
});

// --- GitHub push ---------------------------------------------------------

app.post('/api/github/token', requireAuth, async (req: AuthedRequest, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    res.status(400).json({ success: false, error: 'token is required' });
    return;
  }
  try {
    await saveGithubToken(req.user!.id, token);
    res.json({ success: true });
  } catch (error) {
    await reportError(res, 500, 'Failed to save token', error, 'GitHub token save error:');
  }
});

app.delete('/api/github/token', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await deleteGithubToken(req.user!.id);
    res.json({ success: true });
  } catch (error) {
    await reportError(res, 500, 'Failed to remove token', error, 'GitHub token delete error:');
  }
});

app.get('/api/github/status', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const connected = await hasGithubToken(req.user!.id);
    res.json({ success: true, connected });
  } catch (error) {
    await reportError(res, 500, 'Failed to check GitHub status', error, 'GitHub status error:');
  }
});

app.get('/api/github/repos', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const repos = await listGithubRepos(req.user!.id);
    res.json({ success: true, repos });
  } catch (error: any) {
    await reportError(res, 502, error.message || 'Failed to list GitHub repos', error, 'GitHub repos list error:');
  }
});

app.post('/api/projects/:projectId/github/link', requireAuth, async (req: AuthedRequest, res) => {
  const { repoFullName, branch } = req.body;
  if (!repoFullName || typeof repoFullName !== 'string') {
    res.status(400).json({ success: false, error: 'repoFullName is required' });
    return;
  }
  try {
    await linkProjectToRepo(req.user!.id, req.params.projectId, repoFullName, branch || 'main');
    res.json({ success: true });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.get('/api/projects/:projectId/github/link', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const link = await getProjectGithubLink(req.user!.id, req.params.projectId);
    res.json({ success: true, link });
  } catch (error) {
    await reportError(res, 500, 'Failed to fetch GitHub link', error, 'GitHub link fetch error:');
  }
});

app.post('/api/projects/:projectId/github/push', requireAuth, async (req: AuthedRequest, res) => {
  const { commitMessage } = req.body;
  try {
    const result = await pushProjectToGithub(
      req.user!.id,
      req.params.projectId,
      commitMessage || 'Update from KingxTech K-XpertAI workspace'
    );
    res.json({ success: true, ...result });
  } catch (error: any) {
    await reportError(res, 502, error.message || 'Push to GitHub failed', error, 'GitHub push error:');
  }
});

app.post('/api/projects/:projectId/github/import', requireAuth, async (req: AuthedRequest, res) => {
  const { repoFullName, branch } = req.body;
  if (!repoFullName || typeof repoFullName !== 'string') {
    res.status(400).json({ success: false, error: 'repoFullName is required' });
    return;
  }
  try {
    const result = await importRepoIntoProject(req.user!.id, req.params.projectId, repoFullName, branch || 'main');
    res.json({ success: true, ...result });
  } catch (error: any) {
    await reportError(res, 502, error.message || 'Import from GitHub failed', error, 'GitHub import error:');
  }
});

// --- Site Settings (per-project env vars) -----------------------------

app.get('/api/projects/:projectId/env', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const vars = await listProjectEnvVars(req.user!.id, req.params.projectId);
    res.json({ success: true, vars });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.put('/api/projects/:projectId/env', requireAuth, async (req: AuthedRequest, res) => {
  const { key, value, isPublic } = req.body;
  if (!key || typeof key !== 'string') {
    res.status(400).json({ success: false, error: 'key is required' });
    return;
  }
  if (typeof value !== 'string') {
    res.status(400).json({ success: false, error: 'value (string) is required' });
    return;
  }
  try {
    await upsertProjectEnvVar(req.user!.id, req.params.projectId, key, value, !!isPublic);
    res.json({ success: true });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.delete('/api/projects/:projectId/env/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await deleteProjectEnvVar(req.user!.id, req.params.projectId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    await handleFsError(res, error);
  }
});

// SecureCheck: dual-model (Claude + Gemini) security review of a project's
// files. Visible to every user in the UI, but gated to Pro members here —
// and even Pro members are charged from the same shared credit pool used by
// /api/ai/generate, since running two premium models isn't free for us either.
app.post('/api/projects/:projectId/security-check', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  try {
    const plan = await getUserPlan(userId);
    if (plan !== 'paid') {
      res.status(403).json({ success: false, error: 'SecureCheck is a Pro feature.', requiresPro: true });
      return;
    }

    const { remaining } = await getCreditsRemaining(userId);
    if (remaining < SECURITY_CHECK_CREDIT_COST) {
      res.status(402).json({
        success: false,
        error: `SecureCheck costs ${SECURITY_CHECK_CREDIT_COST} credits — you have ${remaining} left this month.`,
        requiresCredits: true,
      });
      return;
    }

    const credit = await consumeCredits(userId, SECURITY_CHECK_CREDIT_COST);
    if (!credit.ok) {
      res.status(402).json({ success: false, error: 'Not enough credits remaining.', requiresCredits: true });
      return;
    }

    const result = await runSecurityCheck(userId, req.params.projectId);
    res.json({ success: true, ...result, creditsRemaining: credit.remaining });
  } catch (error) {
    await handleFsError(res, error);
  }
});

// --- Public preview / hosted site -------------------------------------
// No requireAuth — a plain browser tab can't send an Authorization header.
// /preview/:projectId/ is scoped only by the project's UUID being
// practically unguessable. /site/:slug/ is the same thing under a
// human-friendly published name. Both render straight from project_files
// on every request — there is no separate "build" step, so a project is
// live the instant the AI (or you) saves a file. Binary assets aren't
// supported yet — the virtual filesystem only stores text content.
const MIME_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
};

app.use(['/preview', '/site'], (_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${env.ALLOWED_ORIGINS.join(' ')}`);
  next();
});

// --- Subdomain-per-project hosting (optional) ------------------------------
// Once PUBLIC_SITE_BASE_DOMAIN is set AND DNS/a Load Balancer with a
// wildcard cert is pointed at this service (see deployment notes — Cloud
// Run's simple domain-mappings command has spotty wildcard support; a
// Google Cloud HTTPS Load Balancer + wildcard managed cert + Serverless NEG
// is the reliable path), a request to <slug>.<PUBLIC_SITE_BASE_DOMAIN>
// serves that project directly at the root, same content as /site/<slug>/.
// Falls through untouched for every other hostname (including this
// service's own Cloud Run URL), so nothing breaks if the domain isn't
// configured yet.
app.use(async (req, res, next) => {
  const base = env.PUBLIC_SITE_BASE_DOMAIN;
  if (!base) return next();

  const host = req.hostname; // Express already strips the port
  const suffix = `.${base}`;
  if (!host.endsWith(suffix) || host === base) return next();

  const subdomain = host.slice(0, -suffix.length);
  if (!subdomain || ['www', 'api', 'app'].includes(subdomain)) return next();

  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${env.ALLOWED_ORIGINS.join(' ')}`);

  try {
    const projectId = await getProjectIdBySlug(subdomain);
    if (!projectId) {
      res.status(404).type('text/plain').send('No published site found at this address.');
      return;
    }
    await servePreview(res, projectId, req.path.replace(/^\//, ''));
  } catch (error) {
    console.error('Subdomain site error:', error);
    Sentry.captureException(error, { tags: { route: 'subdomain-site' } });
    await Sentry.flush(2000).catch(() => {});
    res.status(500).type('text/plain').send('Site failed to load.');
  }
});

async function servePreview(res: express.Response, projectId: string, requestedPath: string) {
  let filePath = requestedPath || 'index.html';
  if (filePath === '') filePath = 'index.html';

  // Synthesized, not a real project_file: gives the built site's client-side
  // code access to whichever KX Cloud env vars the owner explicitly marked
  // public (see publicEnv.ts) via `<script src="/kx-env.js"></script>`.
  if (filePath === 'kx-env.js') {
    const ownerId = await getProjectOwnerId(projectId);
    if (!ownerId) {
      res.status(404).type('text/plain').send('Project not found.');
      return;
    }
    const script = await buildPublicEnvScript(ownerId, projectId);
    res.type('application/javascript; charset=utf-8').send(script);
    return;
  }

  let file = await readProjectFilePublic(projectId, filePath);
  if (!file && !filePath.includes('.')) {
    file = await readProjectFilePublic(projectId, 'index.html');
  }
  if (!file || file.is_folder) {
    res.status(404).type('text/plain').send('Not found. Ask K-XpertAI to create an index.html to get started.');
    return;
  }
  const ext = filePath.split('.').pop() || '';
  res.type(MIME_TYPES[ext] || 'text/plain; charset=utf-8').send(file.content ?? '');
}

app.get(/^\/preview\/([^/]+)\/?(.*)$/, async (req, res) => {
  try {
    await servePreview(res, req.params[0], req.params[1]);
  } catch (error) {
    console.error('Preview error:', error);
    Sentry.captureException(error, { tags: { route: 'preview' } });
    await Sentry.flush(2000).catch(() => {});
    res.status(500).type('text/plain').send('Preview failed to load.');
  }
});

app.get(/^\/site\/([^/]+)\/?(.*)$/, async (req, res) => {
  try {
    const projectId = await getProjectIdBySlug(req.params[0]);
    if (!projectId) {
      res.status(404).type('text/plain').send('No published site found at this address.');
      return;
    }
    await servePreview(res, projectId, req.params[1]);
  } catch (error) {
    console.error('Site error:', error);
    Sentry.captureException(error, { tags: { route: 'site' } });
    await Sentry.flush(2000).catch(() => {});
    res.status(500).type('text/plain').send('Site failed to load.');
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const PORT = env.PORT;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));