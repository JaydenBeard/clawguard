/**
 * Alert configuration and test routes.
 */

import express, { Router } from 'express';
import { alertConfig } from '../lib/state.js';

const router = Router();

router.get('/config', (req, res) => {
  res.json(alertConfig);
});

router.post('/config', express.json(), (req, res) => {
  try {
    const { enabled, webhookUrl, telegramChatId, alertOnHighRisk, onRiskLevels } = req.body;

    if (typeof enabled === 'boolean') alertConfig.enabled = enabled;

    if (webhookUrl !== undefined) {
      if (webhookUrl && typeof webhookUrl !== 'string') {
        return res.status(400).json({ error: 'webhookUrl must be a string' });
      }
      if (webhookUrl) {
        try {
          new URL(webhookUrl);
        } catch {
          return res.status(400).json({ error: 'webhookUrl must be a valid URL' });
        }
      }
      alertConfig.webhookUrl = webhookUrl;
    }

    if (telegramChatId !== undefined) alertConfig.telegramChatId = telegramChatId;
    if (Array.isArray(onRiskLevels)) alertConfig.onRiskLevels = onRiskLevels;

    // Legacy compat: alertOnHighRisk → onRiskLevels
    if (typeof alertOnHighRisk === 'boolean' && !onRiskLevels) {
      alertConfig.onRiskLevels = alertOnHighRisk
        ? ['high', 'critical']
        : ['low', 'medium', 'high', 'critical'];
    }

    res.json({ success: true, config: alertConfig });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/test', express.json(), async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    const url = webhookUrl || alertConfig.webhookUrl;
    if (!url) {
      return res.status(400).json({ error: 'No webhook URL configured' });
    }
    const testPayload = {
      type: 'test',
      message: '\ud83e\uddea ClawGuard alert test',
      timestamp: new Date().toISOString(),
      source: 'clawguard',
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    res.json({
      success: response.ok,
      status: response.status,
      message: response.ok ? 'Test alert sent successfully' : 'Failed to send test alert',
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Webhook request timed out' });
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
