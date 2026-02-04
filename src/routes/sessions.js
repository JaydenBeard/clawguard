import { Router } from 'express';
import { listSessions, parseSession, extractActivity } from '../lib/parser.js';
import { analyzeRisk, categorize, getCategoryIcon } from '../lib/risk-analyzer.js';
import { SESSIONS_DIR } from '../lib/state.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const sessions = listSessions(SESSIONS_DIR);
    const enriched = sessions.map((s) => {
      const session = parseSession(s.path);
      const activity = session ? extractActivity(session) : [];
      return {
        ...s,
        activityCount: activity.length,
        metadata: session?.metadata,
      };
    });
    res.json({ sessions: enriched });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const sessions = listSessions(SESSIONS_DIR);
    const sessionInfo = sessions.find((s) => s.id === req.params.id);
    if (!sessionInfo) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = parseSession(sessionInfo.path);
    const activity = extractActivity(session);
    const analyzedActivity = activity.map((a) => ({
      ...a,
      risk: analyzeRisk(a),
      icon: getCategoryIcon(categorize(a.tool)),
    }));
    res.json({
      session: { ...sessionInfo, metadata: session?.metadata },
      activity: analyzedActivity,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
