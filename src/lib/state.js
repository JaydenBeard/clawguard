/**
 * Shared mutable state for ClawGuard modules.
 *
 * Every module that needs alertConfig, streamingConfig, streamBuffer, etc.
 * imports from here so there is a single source of truth.
 */

import { loadConfig } from './config.js';

// Load configuration once at startup
export const config = loadConfig();

// Alert configuration (from config file)
export const alertConfig = {
  enabled: config.alerts?.enabled || false,
  webhookUrl: config.alerts?.webhookUrl || null,
  telegramChatId: config.alerts?.telegramChatId || null,
  alertOnHighRisk: config.alerts?.onRiskLevels?.includes('high') ?? true,
  alertOnCategories: ['shell', 'file'],
  onRiskLevels: config.alerts?.onRiskLevels || ['high', 'critical'],
  onSequences: config.alerts?.onSequences ?? true,
};

// Streaming configuration (external log sink)
export const streamingConfig = {
  enabled: config.streaming?.enabled || false,
  endpoint: config.streaming?.endpoint || null,
  authHeader: config.streaming?.authHeader || null,
  batchSize: config.streaming?.batchSize || 10,
  flushIntervalMs: config.streaming?.flushIntervalMs || 5000,
};

// Streaming state
let streamBuffer = [];
export const lastProcessedLines = {};
export const streamingStats = {
  totalSent: 0,
  totalFailed: 0,
  lastSentAt: null,
  lastError: null,
};

// WebSocket clients set
export const clients = new Set();

// Derived values (with env override)
export const PORT = process.env.PORT || config.port || 3847;
export const SESSIONS_DIR = process.env.SESSIONS_DIR || config.sessionsPath;
export const SEQUENCE_WINDOW_MS = (config.detection?.sequenceWindowMinutes || 5) * 60 * 1000;

// streamBuffer is a let — provide getter/setter helpers so other modules
// can replace the array reference.
export function getStreamBuffer() {
  return streamBuffer;
}

export function setStreamBuffer(buf) {
  streamBuffer = buf;
}
