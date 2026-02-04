/**
 * Session dump/export to external endpoints.
 */

import express, { Router } from 'express';
import { listSessions, parseSession, extractActivity } from '../lib/parser.js';
import { analyzeRisk, categorize } from '../lib/risk-analyzer.js';
import { SESSIONS_DIR, streamingConfig } from '../lib/state.js';
import { resolveEndpoint } from '../lib/validate.js';

const router = Router();

router.post('/session/:id', express.json(), async (req, res) => {
  const endpoint = resolveEndpoint(req.body.endpoint, streamingConfig.endpoint);
  if (!endpoint) {
    return res.status(400).json({
      error: req.body.endpoint
        ? 'Invalid endpoint URL. Only external http/https URLs are allowed.'
        : 'No endpoint configured. Set streaming endpoint or provide one in request.',
    });
  }
  const authHeader = req.body.authHeader || streamingConfig.authHeader;

  try {
    const sessions = listSessions(SESSIONS_DIR);
    const sessionInfo = sessions.find((s) => s.id === req.params.id);
    if (!sessionInfo) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = parseSession(sessionInfo.path);
    if (!session) {
      return res.status(404).json({ error: 'Session file could not be parsed' });
    }
    const activity = extractActivity(session);
    const analyzedActivity = activity.map((a) => ({
      ...a,
      risk: analyzeRisk(a),
      category: categorize(a.tool),
    }));
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'ClawGuard/0.3.0' };
    if (authHeader) headers['Authorization'] = authHeader;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'clawguard',
        type: 'session_dump',
        timestamp: new Date().toISOString(),
        session: {
          id: sessionInfo.id,
          name: sessionInfo.name,
          modified: sessionInfo.modified,
          metadata: session?.metadata,
        },
        activityCount: analyzedActivity.length,
        activity: analyzedActivity,
      }),
    });
    if (response.ok) {
      res.json({
        success: true,
        sessionId: req.params.id,
        activityCount: analyzedActivity.length,
        message: 'Session dumped successfully (' + analyzedActivity.length + ' activities)',
      });
    } else {
      throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/all', express.json(), async (req, res) => {
  const endpoint = resolveEndpoint(req.body.endpoint, streamingConfig.endpoint);
  if (!endpoint) {
    return res.status(400).json({
      error: req.body.endpoint
        ? 'Invalid endpoint URL. Only external http/https URLs are allowed.'
        : 'No endpoint configured. Set streaming endpoint or provide one in request.',
    });
  }
  const authHeader = req.body.authHeader || streamingConfig.authHeader;

  try {
    const sessions = listSessions(SESSIONS_DIR);
    const headers = { 'Content-Type': 'application/json', 'User-Agent': 'ClawGuard/0.3.0' };
    if (authHeader) headers['Authorization'] = authHeader;
    const results = {
      success: true,
      totalSessions: sessions.length,
      totalActivity: 0,
      sent: 0,
      failed: 0,
      errors: [],
    };
    for (const sessionInfo of sessions) {
      try {
        const session = parseSession(sessionInfo.path);
        const activity = session ? extractActivity(session) : [];
        const analyzedActivity = activity.map((a) => ({
          ...a,
          risk: analyzeRisk(a),
          category: categorize(a.tool),
        }));
        results.totalActivity += analyzedActivity.length;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            source: 'clawguard',
            type: 'session_dump',
            timestamp: new Date().toISOString(),
            session: {
              id: sessionInfo.id,
              name: sessionInfo.name,
              modified: sessionInfo.modified,
              metadata: session?.metadata,
            },
            activityCount: analyzedActivity.length,
            activity: analyzedActivity,
          }),
        });
        if (response.ok) {
          results.sent++;
        } else {
          results.failed++;
          results.errors.push({ session: sessionInfo.id, error: 'HTTP ' + response.status });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({ session: sessionInfo.id, error: error.message });
      }
    }
    results.success = results.failed === 0;
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/preview', (req, res) => {
  try {
    const sessions = listSessions(SESSIONS_DIR);
    let totalActivity = 0;
    const sessionPreviews = sessions.map((sessionInfo) => {
      const session = parseSession(sessionInfo.path);
      const activity = session ? extractActivity(session) : [];
      totalActivity += activity.length;
      return {
        id: sessionInfo.id,
        name: sessionInfo.name,
        modified: sessionInfo.modified,
        activityCount: activity.length,
      };
    });
    res.json({
      totalSessions: sessions.length,
      totalActivity,
      sessions: sessionPreviews,
      endpoint: streamingConfig.endpoint ? '***configured***' : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
