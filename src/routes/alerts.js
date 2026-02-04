import { Router } from 'express';
import express from 'express';
import { alertConfig } from '../lib/state.js';

const router = Router();

router.get('/config', (req, res) => {
  res.json(alertConfig);
});

router.post('/config', express.json(), (req, res) => {
  try {
    const {
      enabled,
      webhookUrl,
      telegramChatId,
      alertOnHighRisk,
      alertOnCategories,
      onRiskLevels,
    } = req.body;
    if (typeof enabled === 'boolean') alertConfig.enabled = enabled;
    if (webhookUrl !== undefined) alertConfig.webhookUrl = webhookUrl;
    if (telegramChatId !== undefined) alertConfig.telegramChatId = telegramChatId;
    if (Array.isArray(onRiskLevels)) alertConfig.onRiskLevels = onRiskLevels;
    if (Array.isArray(alertOnCategories)) alertConfig.alertOnCategories = alertOnCategories;
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
      source: 'clawdbot-dashboard',
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload),
    });
    res.json({
      success: response.ok,
      status: response.status,
      message: response.ok ? 'Test alert sent successfully' : 'Failed to send test alert',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
