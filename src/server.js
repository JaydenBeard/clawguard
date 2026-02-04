import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { watch } from 'chokidar';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { clients, PORT, SESSIONS_DIR, config, alertConfig, streamingConfig } from './lib/state.js';
import { pkg } from './lib/pkg.js';
import { processNewLogEntries, startStreamingInterval } from './lib/streaming.js';

// Route modules
import sessionsRouter from './routes/sessions.js';
import activityRouter from './routes/activity.js';
import gatewayRouter from './routes/gateway.js';
import alertsRouter from './routes/alerts.js';
import streamingRouter from './routes/streaming.js';
import exportsRouter from './routes/exports.js';
import dumpRouter from './routes/dump.js';
import configRouter from './routes/config.js';
import versionRouter from './routes/version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// JSON body parser
app.use(express.json());

// Serve static files
app.use(express.static(join(__dirname, '..', 'public')));

// Mount route modules
app.use('/api/sessions', sessionsRouter);
app.use('/api', activityRouter);
app.use('/api/gateway', gatewayRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/streaming', streamingRouter);
app.use('/api/export', exportsRouter);
app.use('/api/dump', dumpRouter);
app.use('/api/config', configRouter);
app.use('/api/version', versionRouter);

// WebSocket for live updates
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected for live updates');

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });
});

// Watch for file changes and broadcast updates
const watcher = watch(SESSIONS_DIR, {
  ignoreInitial: true,
  persistent: true,
});

watcher.on('change', (path) => {
  console.log('Session file changed:', path);

  if (path.endsWith('.jsonl')) {
    processNewLogEntries(path);
  }

  const message = JSON.stringify({
    type: 'update',
    file: path,
    timestamp: new Date().toISOString(),
  });

  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`\n🛡️  ClawGuard v${pkg.version}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🌐 Dashboard:  http://localhost:${PORT}`);
  console.log(`📁 Sessions:   ${SESSIONS_DIR}`);
  console.log(`📋 Config:     ${config._configPath}`);
  console.log(`🔔 Alerts:     ${alertConfig.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`📤 Streaming:  ${streamingConfig.enabled ? streamingConfig.endpoint : 'Disabled'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  startStreamingInterval();
});
