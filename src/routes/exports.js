/**
 * JSON and CSV export routes.
 */

import { Router } from 'express';
import { getAllActivity } from '../lib/parser.js';
import { analyzeRisk, categorize } from '../lib/risk-analyzer.js';
import { SESSIONS_DIR } from '../lib/state.js';

/**
 * Escape a value for safe CSV output.
 * Handles null/undefined, objects, newlines, and double quotes.
 */
function escapeCsv(value) {
  if (value == null) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Replace newlines with spaces, escape double quotes by doubling them
  const escaped = str.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""');
  return `"${escaped}"`;
}

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
        escapeCsv(a.timestamp),
        escapeCsv(a.tool),
        escapeCsv(categorize(a.tool)),
        escapeCsv(risk.level),
        escapeCsv(risk.flags.join('; ')),
        escapeCsv(a.arguments),
        escapeCsv(a.sessionId),
      ].join(',');
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
