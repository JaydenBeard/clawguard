import { describe, it } from 'node:test';
import assert from 'node:assert';

const PORT = process.env.CLAWGUARD_TEST_PORT || 3847;
const BASE = `http://localhost:${PORT}`;

// Tests connect to ClawGuard on CLAWGUARD_TEST_PORT (default 3847).
// CI starts the server on a dedicated test port to avoid conflicts.
// Locally: npm start & npm test

async function fetchJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  assert.ok(res.ok, `${path} returned ${res.status}`);
  return res.json();
}

// ── Dashboard ────────────────────────────────────────────

describe('Dashboard', () => {
  it('GET / serves HTML', async () => {
    const res = await fetch(`${BASE}/`);
    assert.ok(res.ok, 'should return 200');
    const contentType = res.headers.get('content-type');
    assert.ok(contentType.includes('text/html'), 'should serve HTML');
    const text = await res.text();
    assert.ok(text.includes('ClawGuard'), 'should contain ClawGuard title');
  });
});

// ── Version ──────────────────────────────────────────────

describe('GET /api/version', () => {
  it('returns current version and update info', async () => {
    const data = await fetchJSON('/api/version');
    assert.ok(data.current, 'should have current version');
    assert.ok(typeof data.current === 'string', 'current should be a string');
    assert.ok(data.current.match(/^\d+\.\d+\.\d+/), 'current should be semver');
    assert.ok('hasUpdate' in data, 'should have hasUpdate field');
    assert.ok(typeof data.hasUpdate === 'boolean', 'hasUpdate should be boolean');
  });
});

// ── Activity ─────────────────────────────────────────────

describe('GET /api/activity', () => {
  it('returns activity array with expected shape', async () => {
    const data = await fetchJSON('/api/activity?limit=5');
    assert.ok(Array.isArray(data.activity), 'should have activity array');
    assert.ok(typeof data.total === 'number', 'should have total count');
    assert.ok('hasMore' in data, 'should have hasMore field');
    assert.ok('offset' in data, 'should have offset field');
  });

  it('respects limit parameter', async () => {
    const data = await fetchJSON('/api/activity?limit=2');
    assert.ok(data.activity.length <= 2, 'should respect limit');
  });

  it('supports offset for pagination', async () => {
    const page1 = await fetchJSON('/api/activity?limit=2&offset=0');
    const page2 = await fetchJSON('/api/activity?limit=2&offset=2');
    if (page1.activity.length > 0 && page2.activity.length > 0) {
      assert.notDeepStrictEqual(page1.activity[0], page2.activity[0], 'pages should be different');
    }
  });

  it('filters by risk level', async () => {
    const data = await fetchJSON('/api/activity?limit=50&risk=high');
    for (const item of data.activity) {
      assert.strictEqual(item.risk?.level, 'high', 'should only return high risk items');
    }
  });
});

// ── Sessions ─────────────────────────────────────────────

describe('GET /api/sessions', () => {
  it('returns sessions array', async () => {
    const data = await fetchJSON('/api/sessions');
    const sessions = data.sessions || data;
    assert.ok(Array.isArray(sessions), 'should have sessions array');
    if (sessions.length > 0) {
      assert.ok(sessions[0].id, 'session should have id');
    }
  });
});

// ── Stats ────────────────────────────────────────────────

describe('GET /api/stats', () => {
  it('returns aggregate statistics', async () => {
    const data = await fetchJSON('/api/stats');
    assert.ok(typeof data.total === 'number', 'should have total');
    assert.ok(data.byCategory, 'should have byCategory');
    assert.ok(data.byRisk, 'should have byRisk');
  });
});

// ── Gateway ──────────────────────────────────────────────

describe('GET /api/gateway/status', () => {
  it('returns gateway status info', async () => {
    const data = await fetchJSON('/api/gateway/status');
    assert.ok(typeof data.isRunning === 'boolean', 'should have isRunning');
    assert.ok(data.cli, 'should have cli field');
    assert.ok(data.timestamp, 'should have timestamp');
  });
});

// NOTE: POST /api/gateway/kill and /api/gateway/restart are NOT tested here.
// These endpoints execute real process kills/restarts against the live gateway.
// Testing them would kill the actual OpenClaw gateway. Manual testing only.

// ── Alerts ───────────────────────────────────────────────

describe('GET /api/alerts/config', () => {
  it('returns alert configuration', async () => {
    const data = await fetchJSON('/api/alerts/config');
    assert.ok(typeof data.enabled === 'boolean', 'should have enabled');
    assert.ok(Array.isArray(data.onRiskLevels), 'should have onRiskLevels array');
  });
});

describe('POST /api/alerts/config', () => {
  it('accepts and persists config changes', async () => {
    const res = await fetch(`${BASE}/api/alerts/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onRiskLevels: ['high', 'critical'] }),
    });
    assert.ok(res.ok, 'should return 200');
    const data = await res.json();
    assert.ok(data.success, 'should return success');
    assert.deepStrictEqual(data.config.onRiskLevels, ['high', 'critical']);
  });
});

// ── Config ───────────────────────────────────────────────

describe('GET /api/config', () => {
  it('returns full configuration', async () => {
    const data = await fetchJSON('/api/config');
    assert.ok(data.version, 'should have version');
    assert.ok(data.port, 'should have port');
    assert.ok(data.configPath, 'should have configPath');
    assert.ok(data.alerts, 'should have alerts section');
    assert.ok(typeof data.alerts.enabled === 'boolean', 'alerts.enabled should be boolean');
  });
});

describe('POST /api/config', () => {
  it('accepts config updates', async () => {
    const res = await fetch(`${BASE}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui: { theme: 'dark' } }),
    });
    assert.ok(res.ok, 'should return 200');
    const data = await res.json();
    assert.ok(data.success, 'should return success');
  });
});

// ── Exports ──────────────────────────────────────────────

describe('GET /api/export/json', () => {
  it('returns valid JSON export', async () => {
    const data = await fetchJSON('/api/export/json');
    assert.ok(data.exportedAt, 'should have exportedAt');
    assert.ok(Array.isArray(data.activity), 'should have activity array');
    assert.ok(typeof data.totalRecords === 'number', 'should have totalRecords');
  });
});

describe('GET /api/export/csv', () => {
  it('returns CSV with correct headers', async () => {
    const res = await fetch(`${BASE}/api/export/csv`);
    assert.ok(res.ok, 'should return 200');
    const contentType = res.headers.get('content-type');
    assert.ok(contentType.includes('text/csv'), 'should be CSV content type');
    const text = await res.text();
    const firstLine = text.split('\n')[0];
    assert.ok(firstLine.includes('timestamp'), 'should have timestamp header');
    assert.ok(firstLine.includes('tool'), 'should have tool header');
    assert.ok(firstLine.includes('risk_level'), 'should have risk_level header');
  });
});

// ── Dump Preview ─────────────────────────────────────────

describe('GET /api/dump/preview', () => {
  it('returns session previews with counts', async () => {
    const data = await fetchJSON('/api/dump/preview');
    assert.ok(typeof data.totalSessions === 'number', 'should have totalSessions');
    assert.ok(typeof data.totalActivity === 'number', 'should have totalActivity');
    assert.ok(Array.isArray(data.sessions), 'should have sessions array');
  });
});

// ── WebSocket ────────────────────────────────────────────

describe('WebSocket /ws', () => {
  it('accepts WebSocket connections', async () => {
    // Dynamic import to handle environments without ws
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        assert.ok(true, 'WebSocket connected');
        ws.close();
        resolve();
      });
      ws.on('error', (err) => reject(err));
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    });
  });
});
