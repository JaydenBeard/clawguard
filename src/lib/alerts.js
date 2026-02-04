/**
 * Alert sending logic for ClawGuard.
 */

import { alertConfig } from './state.js';

const ALERT_TIMEOUT_MS = 10000;

/**
 * Escape special characters for Telegram MarkdownV2.
 */
function escapeTelegramMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Send alert to configured webhook (generic or Telegram).
 */
export async function sendAlert(activity, risk) {
  if (!alertConfig.enabled || !alertConfig.webhookUrl) return;

  // Only alert if the risk level is in the configured onRiskLevels list
  if (!alertConfig.onRiskLevels.includes(risk.level)) {
    return;
  }

  // Check for Telegram
  const isTelegram = alertConfig.webhookUrl.includes('api.telegram.org');
  let body;

  if (isTelegram) {
    if (!alertConfig.telegramChatId) {
      console.error('Telegram alert skipped: telegramChatId not configured');
      return;
    }
    const toolName = escapeTelegramMarkdown(activity.tool);
    const level = escapeTelegramMarkdown(risk.level.toUpperCase());
    const flags = escapeTelegramMarkdown(risk.flags.join(', '));
    const args = escapeTelegramMarkdown(JSON.stringify(activity.arguments).substring(0, 100));
    const message = `⚠️ ${level} RISK: ${toolName}\n\nFlags: ${flags}\nArgs: ${args}`;
    body = JSON.stringify({
      chat_id: alertConfig.telegramChatId,
      text: message,
      parse_mode: 'MarkdownV2',
    });
  } else {
    const message = `⚠️ ${risk.level.toUpperCase()} RISK: ${activity.tool} - ${risk.flags.join(', ')}`;
    body = JSON.stringify({
      type: 'activity_alert',
      timestamp: new Date().toISOString(),
      activity: {
        tool: activity.tool,
        arguments: activity.arguments,
        timestamp: activity.timestamp,
      },
      risk: {
        level: risk.level,
        flags: risk.flags,
      },
      message,
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);

  try {
    const response = await fetch(alertConfig.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      console.log(`🔔 Alert sent for ${activity.tool} (${risk.level})`);
    } else {
      const text = await response.text().catch(() => '');
      console.error(`🔔 Alert failed (HTTP ${response.status}): ${text.substring(0, 200)}`);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`🔔 Alert timed out after ${ALERT_TIMEOUT_MS}ms`);
    } else {
      console.error('Failed to send alert:', error.message);
    }
  }
}
