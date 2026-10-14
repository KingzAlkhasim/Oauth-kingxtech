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

  const parsedRequest = parseModelTag(rawPrompt);
  let { model, cleanPrompt, unknownTag } = parsedRequest;

  let activeProjectId: string | undefined;
  let projectRole: 'owner' | 'editor' | 'viewer' | null = null;
  if (projectId) {
    try {
      projectRole = await getProjectRole(userId, projectId);
      if (!projectRole) {
        res.status(404).json({
          success: false,
          error: 'Project not found or no longer belongs to this account. Re-open an existing project workspace.',
        });
        return;
      }
      activeProjectId = projectId;
    } catch (error) {
      if (error instanceof ProjectAccessError) {
        res.status(404).json({
          success: false,
          error: 'Project not found or no longer belongs to this account. Re-open an existing project workspace.',
        });
        return;
      }
      await reportError(res, 500, 'Failed to validate project workspace', error, 'Project validation error:');
      return;
    }
  }

  const usageTier = await getUserTier(userId);
  if (!parsedRequest.explicitTag) model = resolveDefaultModelForTier(usageTier, REGISTRY);
  if (model.minTier === 'pro_plus' && usageTier !== 'free' && !modelTierAllowed(usageTier, model.minTier)) {
    res.status(403).json({ success: false, code: 'model_requires_pro_plus', error: `${model.label} requires Pro+. Upgrade your plan to use this model.` }); return;
  }
  if (model.requiresPaidPlan && usageTier === 'free') {
    res.status(402).json({ success: false, error: `${model.label} needs a paid plan. Try the free tier instead — no tag needed, or use :Q-qwen/ or :Q-llama/.` }); return;
  }

  if (projectRole === 'viewer') {
    const requestedMode = req.body.mode === 'build' ? 'build' : 'plan';
    if (requestedMode === 'build') {
      res.status(403).json({ success: false, code: 'project_role_forbidden', error: 'View-only members can use K-XpertAI in Plan mode only.' });
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
      await reportError(res, 500, 'Failed to check model request limit', error, 'Model request-cap check error:');
      return;
    }
  }
