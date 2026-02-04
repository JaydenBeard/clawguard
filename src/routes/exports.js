import { Router } from 'express';
import { getAllActivity } from '../lib/parser.js';
import { analyzeRisk, categorize } from '../lib/risk-analyzer.js';
import { SESSIONS_DIR } from '../lib/state.js';

const router = Router();

router.get('/json', (req, res) => {
  try {
    const activity = getAllActivity(SESSIONS_DIR, 10000);
    const analyzed = activity.map((a) => ({
      ...a,
      risk: analyzeRisk(a),
      category: categorize(a.tool),
    }));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=clawguard-activity.json');
    res.json({
      exportedAt: new Date().toISOString(),
      totalRecords: analyzed.length,
      activity: analyzed,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/csv', (req, res) => {
  try {
    const activity = getAllActivity(SESSIONS_DIR, 10000);
    const headers = [
      'timestamp',
      'tool',
      'category',
      'risk_level',
      'risk_flags',
      'arguments',
      'session_id',
    ];
    const rows = activity.map((a) => {
      const risk = analyzeRisk(a);
      return [
        a.timestamp,
        a.tool,
        categorize(a.tool),
        risk.level,
        risk.flags.join('; '),
        JSON.stringify(a.arguments).replace(/"/g, '""'),
        a.sessionId,
      ]
        .map((v) => '"' + v + '"')
        .join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=clawguard-activity.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
