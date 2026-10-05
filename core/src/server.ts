import { initSentry, Sentry } from './lib/sentry';
initSentry(); // must run before express/other modules are set up

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import { env } from './config/env';
import { supabaseAdmin } from './lib/supabaseAdmin';
import { generateContent } from './services/aiRouter';
import type { AgentTurn } from './services/agentTools';
import { getHistoryFromDb, saveMessageToDb, deleteSessionHistory } from './services/chatHistory';
import { touchSession, listSessions, deleteSession } from './services/sessions';
import { parseModelTag, listModelsForClient, tagForModel, findModelForApi, listModelsForApi } from './services/modelRegistry';
import { consumeCredits, getCreditsRemaining, logUsage, getUsageLog, checkModelRequestCap, getUserPlan, chargeUserByApiKey, convertWalletToCredits } from './services/credits';
import { getTurnChanges, revertTurn, revertFileToPreviousVersion } from './services/versioning';
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
  hasPublishedBuild,
  readPublishedBuildFile,
} from './services/projectFs';
import { buildProjectForPublish } from './services/projectRuntime';
import { getProjectIdByCustomDomain, addCustomDomain, verifyCustomDomain, removeCustomDomain } from './services/customDomains';
import { requireAuth, type AuthedRequest } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';

const app = express();
app.use(helmet());
// API-key callers may be hosted on any origin. Authentication is explicit via
// Authorization: Bearer kx_live_/kx_test_ — no browser session cookie is used.
// Keep credentials disabled so reflecting arbitrary origins cannot authorize
// ambient browser credentials.
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '2mb' }));
function applyPublishedSiteSecurity(req: express.Request, res: express.Response) {
  res.removeHeader('X-Frame-Options');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "connect-src 'self' https: wss:",
      `frame-ancestors 'self' ${env.ALLOWED_ORIGINS.join(' ')}`,
    ].join('; ')
  );
}


// Lightweight deployment/uptime check.
app.get('/', (_req, res) => {
  res.status(200).json({ ok: true, service: 'KX-Neurocore', status: 'online' });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'KX-Neurocore' });
});

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

// --- Public OpenAI-compatible API ---------------------------------------
// These routes are deliberately separate from the internal K-XpertAI workspace
// endpoint above. API-key callers cannot access project files or terminal tools.
app.get('/api/v1/models', requireAuth, (_req, res) => {
  res.json({ object: 'list', data: listModelsForApi() });
});

app.post('/api/v1/chat/completions', requireAuth, rateLimit, async (req: AuthedRequest, res) => {
  const { model: modelName, messages, stream = false } = req.body ?? {};
  const userId = req.user!.id;

  if (!modelName || typeof modelName !== 'string') {
    res.status(400).json({ error: { message: 'model is required', type: 'invalid_request_error', param: 'model' } });
    return;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: { message: 'messages must be a non-empty array', type: 'invalid_request_error', param: 'messages' } });
    return;
  }

  const selected = findModelForApi(modelName);
  if (!selected) {
    res.status(400).json({
      error: {
        message: `Unknown model "${modelName}". Use GET /api/v1/models to list supported models.`,
        type: 'invalid_request_error',
        param: 'model',
      },
    });
    return;
  }

  const normalized = messages.slice(-40).map((message: any) => {
    const role = message?.role;
    const text = typeof message?.content === 'string' ? message.content : '';
    return { role, text };
  }).filter((message: any) => (message.role === 'user' || message.role === 'assistant' || message.role === 'system') && message.text);

  const latestUser = [...normalized].reverse().find((message: any) => message.role === 'user');
  if (!latestUser) {
    res.status(400).json({ error: { message: 'messages must contain at least one user message', type: 'invalid_request_error', param: 'messages' } });
    return;
  }

  const systemPrompt = normalized.filter((message: any) => message.role === 'system').map((message: any) => message.text).join('\n\n');
  const history: AgentTurn[] = normalized
    .filter((message: any) => message.role === 'user' || message.role === 'assistant')
    .slice(0, -1)
    .map((message: any) => ({ role: message.role === 'assistant' ? 'model' : 'user', text: message.text }));
  const prompt = systemPrompt ? `${systemPrompt}\n\n${latestUser.text}` : latestUser.text;

  if (selected.requiresPaidPlan) {
    const plan = await getUserPlan(userId);
    if (plan !== 'paid') {
      res.status(402).json({ error: { message: `${selected.label} requires a paid KingxTech plan.`, type: 'billing_error' } });
      return;
    }
  }

  if (selected.requestCap) {
    try {
      const capCheck = await checkModelRequestCap(userId, selected.code, selected.requestCap);
      if (!capCheck.ok) {
        res.status(402).json({
          error: {
            message: `${selected.label} is limited to ${selected.requestCap} API requests/month; this key has used ${capCheck.used}.`,
            type: 'rate_limit_error',
          },
        });
        return;
      }
    } catch (error) {
      await reportError(res, 500, 'Failed to check model usage limit', error, 'Public API request cap error:');
      return;
    }
  }

  const USD_PER_CREDIT = 0.01;
  try {
    const charge = await chargeUserByApiKey(userId, selected.creditCost * USD_PER_CREDIT);
    if (!charge.allowed) {
      res.status(402).json({
        error: {
          message: `Insufficient wallet balance — need ${(selected.creditCost * USD_PER_CREDIT).toFixed(2)}, have ${charge.balance.toFixed(2)}.`,
          type: 'billing_error',
        },
      });
      return;
    }

    const result = await generateContent(
      prompt,
      selected.provider,
      selected.modelId,
      history,
      { userId, publicApi: true },
    );

    await logUsage(userId, selected.provider, selected.code, selected.creditCost);

    const responseBody = {
      id: `kx-${crypto.randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: selected.modelId,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: result.text },
        finish_reason: 'stop',
      }],
    };

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify({
        id: responseBody.id,
        object: 'chat.completion.chunk',
        created: responseBody.created,
        model: responseBody.model,
        choices: [{ index: 0, delta: { role: 'assistant', content: result.text }, finish_reason: null }],
      })}\n\n`);
      res.write(`data: ${JSON.stringify({
        id: responseBody.id,
        object: 'chat.completion.chunk',
        created: responseBody.created,
        model: responseBody.model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.json(responseBody);
  } catch (error) {
    await reportError(res, 502, 'AI provider request failed', error, 'Public API generation error:');
  }
});

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
    sendEvent({ type: 'status', label: 'Loading conversation context…' });
    const history = await getHistoryFromDb(userId, sessionId);

    // Sentry span around the actual agent turn — records exactly the
    // metric (history payload size) that would have surfaced the unbounded
    // history growth bug: if this climbs unbounded across a long session,
    // it shows up here as a real, visible trend instead of a mystery.
    const historyChars = history.reduce((sum, t) => sum + t.text.length, 0);
    const isPlanningMode = cleanPrompt.startsWith('PLANNING MODE:');
    sendEvent({ type: 'status', label: isPlanningMode ? 'Preparing your implementation plan…' : 'Planning the next action…' });
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
          { userId, projectId: projectId || undefined, turnId, readOnly: isPlanningMode },
          (step) => sendEvent({ type: 'step', step })
        )
    );

    sendEvent({ type: 'status', label: isPlanningMode ? 'Writing the final plan…' : 'Finalizing changes…' });
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

// --- Project environment variables ---------------------------------------
app.get('/api/projects/:projectId/env', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const vars = await listProjectEnvVars(req.user!.id, req.params.projectId);
    res.json({ success: true, vars });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.put('/api/projects/:projectId/env', requireAuth, async (req: AuthedRequest, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim().toUpperCase() : '';
  const value = typeof req.body?.value === 'string' ? req.body.value : '';
  const isPublic = req.body?.isPublic === true;
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key)) {
    res.status(400).json({ success: false, error: 'Environment variable keys may contain only letters, numbers, and underscores, and must start with a letter or underscore.' });
    return;
  }
  if (value.length > 64 * 1024) {
    res.status(400).json({ success: false, error: 'Environment variable value is too large (maximum 64 KB).' });
    return;
  }
  try {
    await upsertProjectEnvVar(req.user!.id, req.params.projectId, key, value, isPublic);
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

// --- Publish (permanent hosted URL) ----------------------------------------

app.post('/api/projects/:projectId/publish', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const slug = await publishProject(req.user!.id, req.params.projectId);
    await buildProjectForPublish(req.user!.id, req.params.projectId);
    // KingxTech's canonical published URL is path-based on the public site host.
    // Keep /site/:slug/ as a legacy backend route, but never advertise the Vercel
    // function URL to users as the published address.
    const url = `https://site.kingxtech.name.ng/${slug}/`;
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

// --- SecureCheck ----------------------------------------------------------
app.post('/api/projects/:projectId/security-check', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await assertProjectOwnership(req.user!.id, req.params.projectId);
    const plan = await getUserPlan(req.user!.id);
    if (plan !== 'paid') {
      res.status(402).json({ success: false, error: 'SecureCheck requires the Pro plan.', requiresPro: true });
      return;
    }

    const credit = await consumeCredits(req.user!.id, SECURITY_CHECK_CREDIT_COST);
    if (!credit.ok) {
      res.status(402).json({
        success: false,
        error: `Insufficient credits — SecureCheck requires ${SECURITY_CHECK_CREDIT_COST} credits.`,
        requiresCredits: true,
        creditsRemaining: credit.remaining,
      });
      return;
    }

    const result = await runSecurityCheck(req.user!.id, req.params.projectId);
    await logUsage(req.user!.id, 'security', 'securecheck', SECURITY_CHECK_CREDIT_COST, req.params.projectId);
    res.json({ success: true, ...result, creditsRemaining: credit.remaining });
  } catch (error) {
    await reportError(res, 500, 'SecureCheck failed to run', error, 'SecureCheck error:');
  }
});

// --- GitHub integration -------------------------------------------------
app.get('/api/github/status', requireAuth, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, connected: await hasGithubToken(req.user!.id) });
  } catch (error) {
    await reportError(res, 500, 'Failed to check GitHub connection', error, 'GitHub status error:');
  }
});

app.post('/api/github/token', requireAuth, async (req: AuthedRequest, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token) {
    res.status(400).json({ success: false, error: 'GitHub token is required.' });
    return;
  }
  try {
    await saveGithubToken(req.user!.id, token);
    res.json({ success: true });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (message.toLowerCase().includes('github token is invalid or expired')) {
      res.status(400).json({ success: false, error: message });
      return;
    }
    await reportError(res, 500, 'Failed to save GitHub token', error, 'GitHub token save error:');
  }
});

app.delete('/api/github/token', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await deleteGithubToken(req.user!.id);
    res.json({ success: true });
  } catch (error) {
    await reportError(res, 500, 'Failed to remove GitHub token', error, 'GitHub token delete error:');
  }
});

app.get('/api/github/repos', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const repos = await listGithubRepos(req.user!.id);
    res.json({ success: true, repos });
  } catch (error) {
    await reportError(res, 502, 'Failed to list GitHub repositories', error, 'GitHub repos error:');
  }
});

app.get('/api/projects/:projectId/github/link', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const link = await getProjectGithubLink(req.user!.id, req.params.projectId);
    res.json({ success: true, link });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.post('/api/projects/:projectId/github/link', requireAuth, async (req: AuthedRequest, res) => {
  const repoFullName = typeof req.body?.repoFullName === 'string' ? req.body.repoFullName.trim() : '';
  const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
  if (!repoFullName || !branch) {
    res.status(400).json({ success: false, error: 'repoFullName and branch are required.' });
    return;
  }
  try {
    await linkProjectToRepo(req.user!.id, req.params.projectId, repoFullName, branch);
    res.json({ success: true });
  } catch (error) {
    await handleFsError(res, error);
  }
});

app.post('/api/projects/:projectId/github/push', requireAuth, async (req: AuthedRequest, res) => {
  const commitMessage = typeof req.body?.commitMessage === 'string' && req.body.commitMessage.trim()
    ? req.body.commitMessage.trim()
    : 'Update project from KingxTech';
  try {
    const result = await pushProjectToGithub(req.user!.id, req.params.projectId, commitMessage);
    res.json({ success: true, ...result });
  } catch (error) {
    await reportError(res, 502, 'Failed to push project to GitHub', error, 'GitHub push error:');
  }
});

app.post('/api/projects/:projectId/github/import', requireAuth, async (req: AuthedRequest, res) => {
  const repoFullName = typeof req.body?.repoFullName === 'string' ? req.body.repoFullName.trim() : '';
  const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : '';
  if (!repoFullName || !branch) {
    res.status(400).json({ success: false, error: 'repoFullName and branch are required.' });
    return;
  }
  try {
    const result = await importRepoIntoProject(req.user!.id, req.params.projectId, repoFullName, branch);
    res.json({ success: true, ...result });
  } catch (error) {
    await reportError(res, 502, 'Failed to import GitHub repository', error, 'GitHub import error:');
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

// --- Project Runtime / Terminal ----------------------------------------
// Commands run inside an isolated Vercel Sandbox belonging to this project.
// The production NeuroCore filesystem is never used as the user's terminal.
app.post('/api/projects/:projectId/runtime/start', requireAuth, rateLimit, async (req: AuthedRequest, res) => {
  try {
    const { startProjectRuntime } = require('./services/projectRuntime') as typeof import('./services/projectRuntime');
    const runtime = await startProjectRuntime(req.user!.id, req.params.projectId);
    res.json({ success: true, runtime });
  } catch (error: any) {
    await reportError(res, 502, error?.message || 'Failed to start project runtime', error, 'Project runtime start error:');
  }
});

app.post('/api/projects/:projectId/runtime/sync', requireAuth, rateLimit, async (req: AuthedRequest, res) => {
  try {
    const { syncProjectRuntime } = require('./services/projectRuntime') as typeof import('./services/projectRuntime');
    const result = await syncProjectRuntime(req.user!.id, req.params.projectId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    await reportError(res, 502, error?.message || 'Failed to sync project runtime', error, 'Project runtime sync error:');
  }
});

app.post('/api/projects/:projectId/terminal', requireAuth, rateLimit, async (req: AuthedRequest, res) => {
  const { command, args } = req.body;
  if (!command || typeof command !== 'string') {
    res.status(400).json({ success: false, error: 'command is required' });
    return;
  }
  try {
    const { runProjectCommand } = require('./services/projectRuntime') as typeof import('./services/projectRuntime');
    const result = await runProjectCommand(req.user!.id, req.params.projectId, command, Array.isArray(args) ? args : []);
    res.json({ success: true, ...result });
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
function applyPublishedSiteCache(res: express.Response, filePath: string) {
  const normalizedPath = filePath.replace(/^\/+/, '');
  const isHashedAsset =
    /^assets\/[^/]+-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/.test(normalizedPath);

  if (isHashedAsset) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  if (normalizedPath.toLowerCase().endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

const MIME_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
};

app.use(['/preview', '/site'], (req, res, next) => {
  applyPublishedSiteSecurity(req, res);
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

  applyPublishedSiteSecurity(req, res);

  try {
    const projectId = await getProjectIdBySlug(subdomain);
    if (!projectId) {
      res.status(404).type('text/plain').send('No published site found at this address.');
      return;
    }
    await servePreview(res, projectId, req.path.replace(/^[/]+/, ''));
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

  // Modern Vite projects are published from compiled artifacts. This keeps
  // browsers from receiving raw TS/TSX and makes nested /site/:slug/ paths work.
  if (filePath === 'kx-env.js') {
    const ownerId = await getProjectOwnerId(projectId);
    if (!ownerId) {
      res.status(404).type('text/plain').send('Project not found.');
      return;
    }
    const script = await buildPublicEnvScript(ownerId, projectId);
    res.setHeader('Cache-Control', 'no-cache');
    res.type('application/javascript; charset=utf-8').send(script);
    return;
  }

  if (await hasPublishedBuild(projectId)) {
    let file = await readPublishedBuildFile(projectId, filePath);
    if (!file && !filePath.includes('.')) {
      file = await readPublishedBuildFile(projectId, 'index.html');
    }
    if (!file || file.is_folder) {
      res.status(404).type('text/plain').send('Not found.');
      return;
    }
    const content = file.content ?? '';
    if (content.startsWith('__KX_BINARY_BASE64__:')) {
      const binary = Buffer.from(content.slice('__KX_BINARY_BASE64__:'.length), 'base64');
      const servedPath = filePath;
      const ext = servedPath.split('.').pop() || '';
      applyPublishedSiteCache(res, servedPath);
      res.type(MIME_TYPES[ext] || 'application/octet-stream').send(binary);
      return;
    }
    const servedPath = filePath;
    const ext = servedPath.split('.').pop() || '';
    applyPublishedSiteCache(res, servedPath);
    res.type(MIME_TYPES[ext] || 'text/plain; charset=utf-8').send(content);
    return;
  }

  // Legacy/static projects continue to be served directly from source files.


  let file = await readProjectFilePublic(projectId, filePath);
  if (!file && !filePath.includes('.')) {
    file = await readProjectFilePublic(projectId, 'index.html');
  }
  if (!file || file.is_folder) {
    res.status(404).type('text/plain').send('Not found. Ask K-XpertAI to create an index.html to get started.');
    return;
  }
  const servedPath = file ? (filePath.includes('.') || filePath === 'index.html' ? filePath : 'index.html') : filePath;
  const ext = servedPath.split('.').pop() || '';
  applyPublishedSiteCache(res, servedPath);
  res.type(MIME_TYPES[ext] || 'text/plain; charset=utf-8').send(file.content ?? '');
}

// Custom domain management. Vercel registration/verification stays server-side so the
// Vercel API token is never exposed to the browser.
app.get('/api/domains', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('custom_domains')
      .select('*, projects(id, name)')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ success: true, domains: data ?? [] });
  } catch (error) {
    await reportError(res, 500, 'Failed to load domains', error, 'Domains list error:');
  }
});

app.post('/api/domains', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const projectId = String(req.body?.projectId || '');
    const domain = String(req.body?.domain || '');
    if (!projectId || !domain) {
      res.status(400).json({ success: false, error: 'Project and domain are required.' });
      return;
    }
    const result = await addCustomDomain(req.user!.id, projectId, domain);
    res.json({ success: true, ...result });
  } catch (error) {
    await reportError(res, 400, 'Failed to connect domain', error, 'Domain add error:');
  }
});

app.post('/api/domains/:id/verify', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const result = await verifyCustomDomain(req.user!.id, req.params.id);
    res.json({ success: true, ...result });
  } catch (error) {
    await reportError(res, 400, 'Failed to verify domain', error, 'Domain verify error:');
  }
});

app.delete('/api/domains/:id', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await removeCustomDomain(req.user!.id, req.params.id);
    res.json({ success: true });
  } catch (error) {
    await reportError(res, 400, 'Failed to remove domain', error, 'Domain remove error:');
  }
});

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

// Custom domains: Vercel routes the hostname to NeuroCore, then we resolve
// the verified hostname to its KingxTech project and serve that project's
// compiled production build from the root path.
app.use(async (req, res, next) => {
  const host = req.hostname.toLowerCase();
  if (!host || host === 'site.kingxtech.name.ng' || host.endsWith('.vercel.app') || host.endsWith('.vercel.run')) return next();
  try {
    const projectId = await getProjectIdByCustomDomain(host);
    if (!projectId) return next();
    applyPublishedSiteSecurity(req, res);
    let requestPath = req.path;
    while (requestPath.startsWith('/')) requestPath = requestPath.slice(1);
    await servePreview(res, projectId, requestPath);
  } catch (error) {
    console.error('Custom domain route error:', error);
    Sentry.captureException(error, { tags: { route: 'custom-domain' } });
    await Sentry.flush(2000).catch(() => {});
    res.status(500).type('text/plain').send('Custom domain failed to load.');
  }
});

// Clean published-site URLs on the custom site host:
// https://site.kingxtech.name.ng/<slug>/
// The hostname is checked explicitly so normal API routes on NeuroCore
// are never interpreted as site slugs.
app.get(/^\/([^/]+)\/?(.*)$/, async (req, res, next) => {
  if (req.hostname !== 'site.kingxtech.name.ng') return next();
  applyPublishedSiteSecurity(req, res);
  try {
    const slug = req.params[0];
    const projectId = await getProjectIdBySlug(slug);
    if (!projectId) {
      res.status(404).type('text/plain').send('No published site found at this address.');
      return;
    }
    await servePreview(res, projectId, req.params[1]);
  } catch (error) {
    console.error('Custom site route error:', error);
    Sentry.captureException(error, { tags: { route: 'custom-site' } });
    await Sentry.flush(2000).catch(() => {});
    res.status(500).type('text/plain').send('Site failed to load.');
  }
});

app.get(/^\/site\/([^/]+)\/?(.*)$/, async (req, res) => {
  applyPublishedSiteSecurity(req, res);
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

export = app;

// Keep app.listen only for local/Cloud Run execution.
if (!process.env.VERCEL) {
  const PORT = env.PORT;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}