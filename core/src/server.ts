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

// Lightweight deployment/uptime check. This backend is an API service,
// not a browser page, so the root URL intentionally has no HTML response.
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'KX-NeuroCore' });
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

// --- POST /api/ai/generate ---------------------------------------------
// Streams progress as Server-Sent Events: one "step" event per tool call
// as it happens (so the UI can show "Building…", "Running command…", live),
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

  const USD_PER_CREDIT = 0.01;
  let credit;
  try {
    if (req.authMethod === 'api_key') {
      const charge = await chargeUserByApiKey(userId, model.creditCost * USD_PER_CREDIT);
      if (!charge.allowed) {
        res.status(402).json({ success: false, error: `Insufficient wallet balance — need $${(model.creditCost * USD_PER_CREDIT).toFixed(2)}, have $${charge.balance.toFixed(2)}.` });
        return;
      }
      credit = { ok: true, remaining: 0 };
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
    await Sentry.flush(2000).catch(() => {});
    res.end();
  }
});

// --- Models / credits / usage ----------------------------------------------

app.get('/api/ai/models', requireAuth, (_req, res) => {
  res.json({ success: true, models: listModelsForClient() });
});
