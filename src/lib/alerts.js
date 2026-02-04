/**
 * Alert sending logic for ClawGuard.
 */

import { alertConfig } from './state.js';

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
    const message = `⚠️ ${risk.level.toUpperCase()} RISK: ${activity.tool}\n\nFlags: ${risk.flags.join(', ')}\nArgs: ${JSON.stringify(activity.arguments).substring(0, 100)}`;
    body = JSON.stringify({
      chat_id: alertConfig.telegramChatId,
      text: message,
      parse_mode: 'Markdown',
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

  try {
    await fetch(alertConfig.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    console.log(`🔔 Alert sent for ${activity.tool} (${risk.level})`);
  } catch (error) {
    console.error('Failed to send alert:', error);
  }
}
