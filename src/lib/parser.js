import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

/**
 * Get the default sessions directory (supports openclaw/moltbot/clawdbot)
 */
export function getSessionsDir() {
  const candidates = [
    join(homedir(), '.openclaw', 'agents', 'main', 'sessions'),
    join(homedir(), '.moltbot', 'agents', 'main', 'sessions'),
    join(homedir(), '.clawdbot', 'agents', 'main', 'sessions'),
    join(homedir(), '.openclaw', 'sessions'),
    join(homedir(), '.moltbot', 'sessions'),
    join(homedir(), '.clawdbot', 'sessions'),
  ];
  for (const dir of candidates) {
    try {
      readdirSync(dir);
      return dir;
    } catch {
      // not found, try next
    }
  }
  // fallback to openclaw path
  return candidates[0];
}

/**
 * List all session files from one or more directories
 * @param {string|string[]} sessionsDirs - Single path or array of paths
 */
export function listSessions(sessionsDirs = getSessionsDir()) {
  // Normalize to array
  const dirs = Array.isArray(sessionsDirs) ? sessionsDirs : [sessionsDirs];
  const allFiles = [];

  for (const sessionsDir of dirs) {
    try {
      // Extract agent name from path (e.g., ~/.openclaw/agents/main/sessions -> main)
      const pathParts = sessionsDir.split('/');
      const agentsIdx = pathParts.indexOf('agents');
      const agentName =
        agentsIdx >= 0 && pathParts[agentsIdx + 1] ? pathParts[agentsIdx + 1] : null;

      const files = readdirSync(sessionsDir)
        .filter((f) => f.endsWith('.jsonl') && !f.includes('.deleted.'))
        .map((f) => {
          const filePath = join(sessionsDir, f);
          const stats = statSync(filePath);
          return {
            id: basename(f, '.jsonl'),
            filename: f,
            path: filePath,
            size: stats.size,
            modified: stats.mtime,
            created: stats.birthtime,
            agent: agentName,
            sessionsDir,
          };
        });

      allFiles.push(...files);
    } catch (error) {
      console.error(`Error listing sessions in ${sessionsDir}:`, error.message);
    }
  }

  return allFiles.sort((a, b) => b.modified - a.modified);
}

/**
 * Parse a single JSONL file and extract activity
 */
export function parseSession(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    const session = {
      id: null,
      metadata: null,
      messages: [],
      toolCalls: [],
      toolResults: [],
    };

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        if (entry.type === 'session') {
          session.id = entry.id;
          session.metadata = {
            version: entry.version,
            timestamp: entry.timestamp,
            cwd: entry.cwd,
          };
        } else if (entry.type === 'message') {
          session.messages.push(entry);

          // Extract tool calls from assistant messages
          if (entry.message?.content && Array.isArray(entry.message.content)) {
            for (const item of entry.message.content) {
              if (item.type === 'toolCall') {
                session.toolCalls.push({
                  id: item.id,
                  name: item.name,
                  arguments: item.arguments,
                  timestamp: entry.timestamp,
                  messageId: entry.id,
                });
              }
            }
          }

          // Extract tool results
          if (entry.message?.role === 'toolResult') {
            session.toolResults.push({
              toolCallId: entry.message.toolCallId,
              toolName: entry.message.toolName,
              content: entry.message.content,
              isError: entry.message.isError,
              timestamp: entry.timestamp,
              details: entry.message.details,
            });
          }
        }
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    return session;
  } catch (error) {
    console.error('Error parsing session:', error);
    return null;
  }
}

/**
 * Extract all activity (tool calls with their results) from a session
 */
export function extractActivity(session) {
  const activities = [];

  // Create a map of tool results by their toolCallId
  const resultsMap = new Map();
  for (const result of session.toolResults) {
    resultsMap.set(result.toolCallId, result);
  }

  // Match tool calls with their results
  for (const call of session.toolCalls) {
    const result = resultsMap.get(call.id);

    activities.push({
      id: call.id,
      tool: call.name,
      arguments: call.arguments,
      timestamp: call.timestamp,
      result: result
        ? {
            content: summarizeResult(result.content),
            isError: result.isError,
            details: result.details,
          }
        : null,
      sessionId: session.id,
    });
  }

  return activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/**
 * Summarize tool result content for display
 */
function summarizeResult(content) {
  if (!content) return null;

  if (typeof content === 'string') {
    return content.length > 500 ? content.substring(0, 500) + '...' : content;
  }

  if (Array.isArray(content)) {
    const textContent = content.find((c) => c.type === 'text');
    if (textContent?.text) {
      const text = textContent.text;
      return text.length > 500 ? text.substring(0, 500) + '...' : text;
    }
  }

  return JSON.stringify(content).substring(0, 500);
}

/**
 * Get all activity from all sessions
 * @param {string|string[]} sessionsDirs - Single path or array of paths
 * @param {number} limit - Maximum number of activities to return
 */
export function getAllActivity(sessionsDirs = getSessionsDir(), limit = 1000) {
  const sessions = listSessions(sessionsDirs);
  const allActivity = [];

  for (const sessionInfo of sessions) {
    const session = parseSession(sessionInfo.path);
    if (session) {
      const activity = extractActivity(session);
      // Add agent info to each activity
      const enrichedActivity = activity.map((a) => ({
        ...a,
        agent: sessionInfo.agent,
      }));
      allActivity.push(...enrichedActivity);
    }

    // Stop if we have enough
    if (allActivity.length >= limit) break;
  }

  return allActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, limit);
}
