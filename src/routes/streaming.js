import { Router } from 'express';
import express from 'express';
import { streamingConfig, streamingStats, getStreamBuffer, config } from '../lib/state.js';
import { flushStreamBuffer, startStreamingInterval } from '../lib/streaming.js';
import { saveConfig } from '../lib/config.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    config: {
      enabled: streamingConfig.enabled,
      endpoint: streamingConfig.endpoint ? '***configured***' : null,
      batchSize: streamingConfig.batchSize,
      flushIntervalMs: streamingConfig.flushIntervalMs,
    },
    stats: {
      ...streamingStats,
      bufferSize: getStreamBuffer().length,
    },
  });
});

router.post('/', express.json(), (req, res) => {
  try {
    const updates = req.body;
    if (updates.enabled !== undefined) streamingConfig.enabled = updates.enabled;
    if (updates.endpoint !== undefined) streamingConfig.endpoint = updates.endpoint;
    if (updates.authHeader !== undefined) streamingConfig.authHeader = updates.authHeader;
    if (updates.batchSize !== undefined) streamingConfig.batchSize = updates.batchSize;
    if (updates.flushIntervalMs !== undefined)
      streamingConfig.flushIntervalMs = updates.flushIntervalMs;

    config.streaming = {
      enabled: streamingConfig.enabled,
      endpoint: streamingConfig.endpoint,
      authHeader: streamingConfig.authHeader,
      batchSize: streamingConfig.batchSize,
      flushIntervalMs: streamingConfig.flushIntervalMs,
    };
    saveConfig(config);
    startStreamingInterval();

    res.json({
      success: true,
      message: streamingConfig.enabled ? 'Streaming enabled' : 'Streaming disabled',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/test', express.json(), async (req, res) => {
  const endpoint = req.body.endpoint || streamingConfig.endpoint;
  const authHeader = req.body.authHeader || streamingConfig.authHeader;

  if (!endpoint) {
    return res.status(400).json({ error: 'No endpoint configured' });
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'ClawGuard/0.2.0',
    };
    if (authHeader) headers['Authorization'] = authHeader;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'clawguard',
        timestamp: new Date().toISOString(),
        test: true,
        message: 'ClawGuard streaming test',
      }),
    });

    res.json({
      success: response.ok,
      status: response.status,
      message: response.ok
        ? 'Test successful - endpoint reachable'
        : 'Endpoint returned ' + response.status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to reach endpoint',
    });
  }
});

router.post('/flush', async (req, res) => {
  if (!streamingConfig.enabled) {
    return res.json({ success: false, message: 'Streaming not enabled' });
  }

  const beforeCount = getStreamBuffer().length;
  await flushStreamBuffer();

  res.json({
    success: true,
    flushed: beforeCount,
    remaining: getStreamBuffer().length,
  });
});

export default router;
