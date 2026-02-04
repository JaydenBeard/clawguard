/**
 * Streaming configuration, test, and flush routes.
 */

import express, { Router } from 'express';
import { streamingConfig, streamingStats, getStreamBuffer, config } from '../lib/state.js';
import { flushStreamBuffer, startStreamingInterval } from '../lib/streaming.js';
import { saveConfig } from '../lib/config.js';
import { resolveEndpoint } from '../lib/validate.js';

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

    // Validate types before applying
    if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    if (updates.endpoint !== undefined && typeof updates.endpoint !== 'string') {
      return res.status(400).json({ error: 'endpoint must be a string' });
    }
    if (updates.authHeader !== undefined && typeof updates.authHeader !== 'string') {
      return res.status(400).json({ error: 'authHeader must be a string' });
    }
    if (updates.batchSize !== undefined) {
      const n = Number(updates.batchSize);
      if (isNaN(n) || n < 1) {
        return res.status(400).json({ error: 'batchSize must be a positive number' });
      }
      updates.batchSize = n;
    }
    if (updates.flushIntervalMs !== undefined) {
      const n = Number(updates.flushIntervalMs);
      if (isNaN(n) || n < 100) {
        return res.status(400).json({ error: 'flushIntervalMs must be >= 100' });
      }
      updates.flushIntervalMs = n;
    }

    // Build new config — apply to copy first, persist, then commit to live
    const newStreaming = { ...streamingConfig };
    if (updates.enabled !== undefined) newStreaming.enabled = updates.enabled;
    if (updates.endpoint !== undefined) newStreaming.endpoint = updates.endpoint;
    if (updates.authHeader !== undefined) newStreaming.authHeader = updates.authHeader;
    if (updates.batchSize !== undefined) newStreaming.batchSize = updates.batchSize;
    if (updates.flushIntervalMs !== undefined)
      newStreaming.flushIntervalMs = updates.flushIntervalMs;

    config.streaming = {
      enabled: newStreaming.enabled,
      endpoint: newStreaming.endpoint,
      authHeader: newStreaming.authHeader,
      batchSize: newStreaming.batchSize,
      flushIntervalMs: newStreaming.flushIntervalMs,
    };

    const saved = saveConfig(config);
    if (!saved) {
      return res.status(500).json({ error: 'Failed to save config file' });
    }

    // Commit to live state only after successful save
    Object.assign(streamingConfig, newStreaming);
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
  const endpoint = resolveEndpoint(req.body.endpoint, streamingConfig.endpoint);
  if (!endpoint) {
    return res.status(400).json({
      error: req.body.endpoint
        ? 'Invalid endpoint URL. Only external http/https URLs are allowed.'
        : 'No endpoint configured',
    });
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'ClawGuard/0.3.0',
    };
    if (streamingConfig.authHeader) headers['Authorization'] = streamingConfig.authHeader;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'clawguard',
        timestamp: new Date().toISOString(),
        test: true,
        message: 'ClawGuard streaming test',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    res.json({
      success: response.ok,
      status: response.status,
      message: response.ok
        ? 'Test successful - endpoint reachable'
        : 'Endpoint returned ' + response.status,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Endpoint request timed out' });
    }
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
