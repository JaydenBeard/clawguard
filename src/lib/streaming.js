/**
 * Streaming logic — buffer management, log entry processing, flush interval.
 */

import { readFileSync } from 'fs';

import { analyzeRisk } from './risk-analyzer.js';
import { sendAlert } from './alerts.js';
import {
  alertConfig,
  streamingConfig,
  streamingStats,
  lastProcessedLines,
  getStreamBuffer,
  setStreamBuffer,
} from './state.js';

/**
 * Flush stream buffer to the configured external endpoint.
 */
export async function flushStreamBuffer() {
  const streamBuffer = getStreamBuffer();
  if (!streamingConfig.enabled || !streamingConfig.endpoint || streamBuffer.length === 0) {
    return;
  }

  const batch = [...streamBuffer];
  setStreamBuffer([]);

  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'ClawGuard/0.2.0',
    };

    if (streamingConfig.authHeader) {
      headers['Authorization'] = streamingConfig.authHeader;
    }

    const response = await fetch(streamingConfig.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'clawguard',
        timestamp: new Date().toISOString(),
        count: batch.length,
        entries: batch,
      }),
    });

    if (response.ok) {
      streamingStats.totalSent += batch.length;
      streamingStats.lastSentAt = new Date().toISOString();
      streamingStats.lastError = null;
      console.log(`📤 Streamed ${batch.length} entries to external sink`);
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    // Put entries back in buffer for retry (up to limit)
    const current = getStreamBuffer();
    setStreamBuffer([...batch.slice(-100), ...current].slice(-500));
    streamingStats.totalFailed += batch.length;
    streamingStats.lastError = error.message;
    console.error(`❌ Stream failed: ${error.message}`);
  }
}

/**
 * Process new log entries for streaming and alerts.
 */
export function processNewLogEntries(filePath) {
  if (!streamingConfig.enabled && !alertConfig.enabled) return;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const lastLine = lastProcessedLines[filePath] || 0;

    const newLines = lines.slice(lastLine);
    lastProcessedLines[filePath] = lines.length;

    for (const line of newLines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);

        if (
          entry.type === 'message' &&
          entry.message?.content &&
          Array.isArray(entry.message.content)
        ) {
          for (const item of entry.message.content) {
            // Tool calls
            if (item.type === 'toolCall') {
              const risk = analyzeRisk({
                tool: item.name,
                arguments: item.arguments,
              });

              if (alertConfig.enabled) {
                sendAlert(
                  {
                    tool: item.name,
                    arguments: item.arguments,
                    timestamp: entry.timestamp,
                  },
                  risk,
                );
              }

              if (streamingConfig.enabled) {
                const toolEntry = {
                  type: 'tool_call',
                  tool: item.name,
                  id: item.id,
                  arguments: item.arguments,
                  timestamp: entry.timestamp,
                  _risk: risk,
                  _streamedAt: new Date().toISOString(),
                  _sessionFile: filePath.split('/').pop(),
                };
                getStreamBuffer().push(toolEntry);
              }
            }
            // Tool results
            if (item.type === 'toolResult' && streamingConfig.enabled) {
              const resultEntry = {
                type: 'tool_result',
                tool: item.name,
                id: item.id,
                result: item.content?.substring?.(0, 500) || item.content,
                isError: item.isError,
                timestamp: entry.timestamp,
                _streamedAt: new Date().toISOString(),
                _sessionFile: filePath.split('/').pop(),
              };
              getStreamBuffer().push(resultEntry);
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (streamingConfig.enabled && getStreamBuffer().length >= streamingConfig.batchSize) {
      flushStreamBuffer();
    }
  } catch (error) {
    console.error(`Failed to process log file: ${error.message}`);
  }
}

/**
 * Start the periodic flush interval. Returns a cleanup function.
 */
let flushInterval = null;
export function startStreamingInterval() {
  if (flushInterval) clearInterval(flushInterval);
  if (streamingConfig.enabled && streamingConfig.endpoint) {
    flushInterval = setInterval(flushStreamBuffer, streamingConfig.flushIntervalMs);
    console.log(`📤 Streaming enabled → ${streamingConfig.endpoint}`);
  }
}
