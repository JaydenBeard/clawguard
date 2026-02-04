/**
 * Configuration read/write route.
 */

import express, { Router } from 'express';
import { saveConfig } from '../lib/config.js';
import { config, alertConfig } from '../lib/state.js';
import { pkg } from '../lib/pkg.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    version: pkg.version,
    port: config.port,
    sessionsPath: config.sessionsPath,
    configPath: config._configPath,
    alerts: {
      enabled: alertConfig.enabled,
      webhookUrl: alertConfig.webhookUrl || '',
      onRiskLevels: alertConfig.onRiskLevels,
      onSequences: alertConfig.onSequences,
    },
    ui: config.ui,
    detection: config.detection,
  });
});

router.post('/', express.json(), (req, res) => {
  try {
    const updates = req.body;

    if (updates.port !== undefined) {
      const port = Number(updates.port);
      if (isNaN(port) || port < 1 || port > 65535) {
        return res.status(400).json({ success: false, message: 'Invalid port number (1-65535)' });
      }
      config.port = port;
    }
    if (updates.sessionsPath !== undefined) {
      if (typeof updates.sessionsPath !== 'string') {
        return res.status(400).json({ success: false, message: 'sessionsPath must be a string' });
      }
      config.sessionsPath = updates.sessionsPath;
    }
    if (updates.alerts) {
      config.alerts = { ...config.alerts, ...updates.alerts };
      alertConfig.enabled = updates.alerts.enabled ?? alertConfig.enabled;
      alertConfig.webhookUrl = updates.alerts.webhookUrl ?? alertConfig.webhookUrl;
      alertConfig.telegramChatId = updates.alerts.telegramChatId ?? alertConfig.telegramChatId;
      alertConfig.onRiskLevels = updates.alerts.onRiskLevels ?? alertConfig.onRiskLevels;
      alertConfig.onSequences = updates.alerts.onSequences ?? alertConfig.onSequences;
    }
    if (updates.ui) {
      config.ui = { ...config.ui, ...updates.ui };
    }
    if (updates.detection) {
      config.detection = { ...config.detection, ...updates.detection };
    }

    const saved = saveConfig(config);
    if (saved) {
      res.json({
        success: true,
        message: 'Settings saved. Some changes may require a restart.',
        requiresRestart: updates.port !== undefined || updates.sessionsPath !== undefined,
      });
    } else {
      res.status(500).json({ success: false, message: 'Failed to save config file' });
    }
  } catch (error) {
    console.error('Failed to update config:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
