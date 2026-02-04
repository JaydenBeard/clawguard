import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { watch } from 'chokidar';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';

import {
  listSessions,
  parseSession,
  extractActivity,
  getAllActivity,
  getSessionsDir,
} from './lib/parser.js';

import {
  analyzeRisk,
  categorize,
  getCategoryIcon,
  getRiskColor,
  ToolCategory,
  RiskLevel,
} from './lib/risk-analyzer.js';

import { loadConfig, saveConfig, getConfigValue } from './lib/config.js';

// Load configuration
const config = loadConfig();

// Alert configuration (from config file)
let alertConfig = {
  enabled: config.alerts?.enabled || false,
  webhookUrl: config.alerts?.webhookUrl || null,
  telegramChatId: config.alerts?.telegramChatId || null,
  alertOnHighRisk: config.alerts?.onRiskLevels?.includes('high') ?? true,
  alertOnCategories: ['shell', 'file'],
  onRiskLevels: config.alerts?.onRiskLevels || ['high', 'critical'],
  onSequences: config.alerts?.onSequences ?? true,
};

// Streaming configuration (external log sink)
let streamingConfig = {
  enabled: config.streaming?.enabled || false,
  endpoint: config.streaming?.endpoint || null,
  authHeader: config.streaming?.authHeader || null,
  batchSize: config.streaming?.batchSize || 10,
  flushIntervalMs: config.streaming?.flushIntervalMs || 5000,
};

// Streaming state
let streamBuffer = [];
let lastProcessedLines = {}; // Track last processed line per session file
let streamingStats = {
  totalSent: 0,
  totalFailed: 0,
  lastSentAt: null,
  lastError: null,
};

// Flush stream buffer to external endpoint
async function flushStreamBuffer() {
  if (!streamingConfig.enabled || !streamingConfig.endpoint || streamBuffer.length === 0) {
    return;
  }
  
  const batch = [...streamBuffer];
  streamBuffer = [];
  
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
    streamBuffer = [...batch.slice(-100), ...streamBuffer].slice(-500);
    streamingStats.totalFailed += batch.length;
    streamingStats.lastError = error.message;
    console.error(`❌ Stream failed: ${error.message}`);
  }
}

// Process new log entries for streaming and alerts
function processNewLogEntries(filePath) {
  if (!streamingConfig.enabled && !alertConfig.enabled) return;
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const lastLine = lastProcessedLines[filePath] || 0;
    
    // Process new lines only
    const newLines = lines.slice(lastLine);
    lastProcessedLines[filePath] = lines.length;
    
    for (const line of newLines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        
        // Extract tool calls and results from message content
        if (entry.type === 'message' && entry.message?.content && Array.isArray(entry.message.content)) {
          for (const item of entry.message.content) {
            // Tool calls
            if (item.type === 'toolCall') {
              const risk = analyzeRisk({ tool: item.name, arguments: item.arguments });
              
              // 1. Send alert if enabled
              if (alertConfig.enabled) {
                sendAlert({
                  tool: item.name,
                  arguments: item.arguments,
                  timestamp: entry.timestamp
                }, risk);
              }

              // 2. Add to stream buffer if streaming enabled
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
                streamBuffer.push(toolEntry);
              }
            }
            // Tool results
            if (item.type === 'toolResult' && streamingConfig.enabled) {
              const resultEntry = {
                type: 'tool_result',
                tool: item.name,
                id: item.id,
                result: item.content?.substring?.(0, 500) || item.content, // Truncate large results
                isError: item.isError,
                timestamp: entry.timestamp,
                _streamedAt: new Date().toISOString(),
                _sessionFile: filePath.split('/').pop(),
              };
              streamBuffer.push(resultEntry);
            }
          }
        }
      } catch (e) {
        // Skip malformed lines
      }
    }
    
    // Flush if batch size reached
    if (streamingConfig.enabled && streamBuffer.length >= streamingConfig.batchSize) {
      flushStreamBuffer();
    }
  } catch (error) {
    console.error(`Failed to process log file: ${error.message}`);
  }
}

// Start streaming flush interval
let flushInterval = null;
function startStreamingInterval() {
  if (flushInterval) clearInterval(flushInterval);
  if (streamingConfig.enabled && streamingConfig.endpoint) {
    flushInterval = setInterval(flushStreamBuffer, streamingConfig.flushIntervalMs);
    console.log(`📤 Streaming enabled → ${streamingConfig.endpoint}`);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Use config values with env override
const PORT = process.env.PORT || config.port || 3847;
const SESSIONS_DIR = process.env.SESSIONS_DIR || config.sessionsPath;
const SEQUENCE_WINDOW_MS = (config.detection?.sequenceWindowMinutes || 5) * 60 * 1000;

// Serve static files
app.use(express.static(join(__dirname, '..', 'public')));

// API Routes

/**
 * List all sessions
 */
app.get('/api/sessions', (req, res) => {
  try {
    const sessions = listSessions(SESSIONS_DIR);
    
    // Enrich with activity count
    const enriched = sessions.map(s => {
      const session = parseSession(s.path);
      const activity = session ? extractActivity(session) : [];
      return {
        ...s,
        activityCount: activity.length,
        metadata: session?.metadata,
      };
    });
    
    res.json({ sessions: enriched });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get session details
 */
app.get('/api/sessions/:id', (req, res) => {
  try {
    const sessions = listSessions(SESSIONS_DIR);
    const sessionInfo = sessions.find(s => s.id === req.params.id);
    
    if (!sessionInfo) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const session = parseSession(sessionInfo.path);
    const activity = extractActivity(session);
    
    // Analyze risk for each activity
    const analyzedActivity = activity.map(a => ({
      ...a,
      risk: analyzeRisk(a),
      icon: getCategoryIcon(categorize(a.tool)),
    }));
    
    res.json({
      session: {
        ...sessionInfo,
        metadata: session?.metadata,
      },
      activity: analyzedActivity,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all activity (paginated)
 */
app.get('/api/activity', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const category = req.query.category;
    const riskLevel = req.query.risk;
    const search = req.query.search?.toLowerCase();
    const tool = req.query.tool;
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;
    
    let activity = getAllActivity(SESSIONS_DIR, 5000);
    
    // Analyze risk for each activity
    activity = activity.map(a => ({
      ...a,
      risk: analyzeRisk(a),
      category: categorize(a.tool),
      icon: getCategoryIcon(categorize(a.tool)),
    }));
    
    // Filter by category
    if (category && category !== 'all') {
      activity = activity.filter(a => a.category === category);
    }
    
    // Filter by risk level
    if (riskLevel && riskLevel !== 'all') {
      activity = activity.filter(a => a.risk.level === riskLevel);
    }
    
    // Filter by tool
    if (tool && tool !== 'all') {
      activity = activity.filter(a => a.tool === tool);
    }
    
    // Filter by date range
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      activity = activity.filter(a => new Date(a.timestamp) >= fromDate);
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      activity = activity.filter(a => new Date(a.timestamp) <= toDate);
    }
    
    // Filter by search
    if (search) {
      activity = activity.filter(a => {
        const searchStr = JSON.stringify(a).toLowerCase();
        return searchStr.includes(search);
      });
    }
    
    const total = activity.length;
    const paginated = activity.slice(offset, offset + limit);
    
    res.json({
      activity: paginated,
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get activity statistics
 */
app.get('/api/stats', (req, res) => {
  try {
    const activity = getAllActivity(SESSIONS_DIR, 10000);
    
    // Analyze all activity
    const analyzed = activity.map(a => ({
      ...a,
      risk: analyzeRisk(a),
      category: categorize(a.tool),
    }));
    
    // Count by tool
    const byTool = {};
    for (const a of analyzed) {
      byTool[a.tool] = (byTool[a.tool] || 0) + 1;
    }
    
    // Count by category
    const byCategory = {};
    for (const a of analyzed) {
      byCategory[a.category] = (byCategory[a.category] || 0) + 1;
    }
    
    // Count by risk level
    const byRisk = {};
    for (const a of analyzed) {
      byRisk[a.risk.level] = (byRisk[a.risk.level] || 0) + 1;
    }
    
    // High risk items
    const highRiskItems = analyzed
      .filter(a => a.risk.level === RiskLevel.HIGH)
      .slice(0, 20);
    
    // Most accessed paths (for file operations)
    const pathCounts = {};
    for (const a of analyzed) {
      const path = a.arguments?.path || a.arguments?.file_path;
      if (path) {
        pathCounts[path] = (pathCounts[path] || 0) + 1;
      }
    }
    const topPaths = Object.entries(pathCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));
    
    // Activity over time (by hour) - format: YYYY-MM-DDTHH for heatmap compatibility
    const byHour = {};
    for (const a of analyzed) {
      const date = new Date(a.timestamp);
      // Use local timezone for proper day alignment
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const key = `${year}-${month}-${day}T${hour}`;
      byHour[key] = (byHour[key] || 0) + 1;
    }
    
    res.json({
      total: activity.length,
      byTool,
      byCategory,
      byRisk,
      highRiskItems,
      topPaths,
      byHour,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get tool categories and risk levels (for filter dropdowns)
 */
app.get('/api/meta', (req, res) => {
  res.json({
    categories: Object.values(ToolCategory),
    riskLevels: Object.values(RiskLevel),
    categoryIcons: Object.fromEntries(
      Object.values(ToolCategory).map(c => [c, getCategoryIcon(c)])
    ),
    riskColors: Object.fromEntries(
      Object.values(RiskLevel).map(r => [r, getRiskColor(r)])
    ),
  });
});

/**
 * Get current configuration
 */
app.get('/api/config', (req, res) => {
  res.json({
    version: '0.3.0',
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

/**
 * Update configuration
 */
app.use(express.json());

app.post('/api/config', (req, res) => {
  try {
    const updates = req.body;
    
    // Update config object
    if (updates.port !== undefined) config.port = updates.port;
    if (updates.sessionsPath !== undefined) config.sessionsPath = updates.sessionsPath;
    
    // Alerts
    if (updates.alerts) {
      config.alerts = { ...config.alerts, ...updates.alerts };
      alertConfig.enabled = updates.alerts.enabled ?? alertConfig.enabled;
      alertConfig.webhookUrl = updates.alerts.webhookUrl ?? alertConfig.webhookUrl;
      alertConfig.telegramChatId = updates.alerts.telegramChatId ?? alertConfig.telegramChatId;
      alertConfig.onRiskLevels = updates.alerts.onRiskLevels ?? alertConfig.onRiskLevels;
      alertConfig.onSequences = updates.alerts.onSequences ?? alertConfig.onSequences;
    }
    
    // UI
    if (updates.ui) {
      config.ui = { ...config.ui, ...updates.ui };
    }
    
    // Detection
    if (updates.detection) {
      config.detection = { ...config.detection, ...updates.detection };
    }
    
    // Save to file
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

/**
 * Detect suspicious sequences of actions
 * Patterns that indicate potential malicious behavior
 */
app.get('/api/sequences', (req, res) => {
  try {
    const activity = getAllActivity(SESSIONS_DIR, 5000);
    
    // Sort by timestamp (oldest first for sequence detection)
    const sorted = [...activity].sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );
    
    const sequences = [];
    const windowMs = SEQUENCE_WINDOW_MS;
    
    // Detect credential read followed by network activity
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      const args = current.arguments || {};
      
      // Pattern 1: Read sensitive file → curl/network
      if ((current.tool === 'read' || current.tool === 'Read') && 
          isSensitivePath(args.path || args.file_path)) {
        // Look ahead for network activity
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          const timeDiff = new Date(next.timestamp) - new Date(current.timestamp);
          if (timeDiff > windowMs) break;
          
          if (next.tool === 'exec' && isNetworkCommand(next.arguments?.command)) {
            sequences.push({
              type: 'Credential Access → Network',
              description: `Read ${args.path || args.file_path} then executed network command`,
              reason: 'Sensitive file was read shortly before network activity, potential data exfiltration',
              timestamp: current.timestamp,
              actions: [
                { tool: current.tool, timestamp: current.timestamp, summary: args.path || args.file_path },
                { tool: next.tool, timestamp: next.timestamp, summary: next.arguments?.command?.substring(0, 100) }
              ]
            });
            break;
          }
          
          if (next.tool === 'web_fetch') {
            sequences.push({
              type: 'Credential Access → Web Fetch',
              description: `Read ${args.path || args.file_path} then fetched ${next.arguments?.url}`,
              reason: 'Sensitive file was read shortly before external request, potential credential leak',
              timestamp: current.timestamp,
              actions: [
                { tool: current.tool, timestamp: current.timestamp, summary: args.path || args.file_path },
                { tool: next.tool, timestamp: next.timestamp, summary: next.arguments?.url }
              ]
            });
            break;
          }
        }
      }
      
      // Pattern 2: Multiple high-risk operations in quick succession
      if (current.tool === 'exec') {
        const cmd = args.command || '';
        if (isSudoCommand(cmd) || isDestructiveCommand(cmd)) {
          const nearby = [];
          for (let j = i - 3; j <= i + 3 && j < sorted.length; j++) {
            if (j < 0 || j === i) continue;
            const other = sorted[j];
            const timeDiff = Math.abs(new Date(other.timestamp) - new Date(current.timestamp));
            if (timeDiff <= windowMs && other.tool === 'exec') {
              const otherCmd = other.arguments?.command || '';
              if (isSudoCommand(otherCmd) || isDestructiveCommand(otherCmd)) {
                nearby.push(other);
              }
            }
          }
          
          if (nearby.length >= 2) {
            sequences.push({
              type: 'Multiple Privileged Operations',
              description: `${nearby.length + 1} dangerous commands executed in quick succession`,
              reason: 'Rapid execution of privileged/destructive commands may indicate automated attack or mistake',
              timestamp: current.timestamp,
              actions: [current, ...nearby].map(a => ({
                tool: a.tool,
                timestamp: a.timestamp,
                summary: a.arguments?.command?.substring(0, 100)
              }))
            });
          }
        }
      }
      
      // Pattern 3: Edit .env or config → restart/deploy
      if ((current.tool === 'edit' || current.tool === 'Edit' || 
           current.tool === 'write' || current.tool === 'Write') &&
          isConfigFile(args.path || args.file_path)) {
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          const timeDiff = new Date(next.timestamp) - new Date(current.timestamp);
          if (timeDiff > windowMs) break;
          
          if (next.tool === 'gateway' && 
              (next.arguments?.action === 'restart' || next.arguments?.action === 'config.apply')) {
            sequences.push({
              type: 'Config Change → Restart',
              description: `Modified ${args.path || args.file_path} then triggered gateway restart`,
              reason: 'Configuration change followed by restart - verify the changes were intentional',
              timestamp: current.timestamp,
              actions: [
                { tool: current.tool, timestamp: current.timestamp, summary: args.path || args.file_path },
                { tool: next.tool, timestamp: next.timestamp, summary: `gateway ${next.arguments?.action}` }
              ]
            });
            break;
          }
        }
      }
      
      // Pattern 4: Outbound message with sensitive data
      if (current.tool === 'message' && args.action === 'send') {
        const message = args.message || '';
        if (containsSensitivePatterns(message)) {
          sequences.push({
            type: 'Potential Data Leak via Message',
            description: `Message sent containing sensitive patterns`,
            reason: 'Outbound message contains patterns that look like credentials or API keys',
            timestamp: current.timestamp,
            actions: [
              { tool: current.tool, timestamp: current.timestamp, summary: `message to ${args.target}` }
            ]
          });
        }
      }
      
      // Pattern 5: SSH key access → SSH connection
      if ((current.tool === 'read' || current.tool === 'Read') && 
          isSSHKeyPath(args.path || args.file_path)) {
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          const timeDiff = new Date(next.timestamp) - new Date(current.timestamp);
          if (timeDiff > windowMs) break;
          
          if (next.tool === 'exec' && /\bssh\s+\w+@/i.test(next.arguments?.command || '')) {
            sequences.push({
              type: 'SSH Key Access → Connection',
              description: `Read SSH key then initiated SSH connection`,
              reason: 'SSH key was accessed before establishing connection - verify this was authorized',
              timestamp: current.timestamp,
              actions: [
                { tool: current.tool, timestamp: current.timestamp, summary: args.path || args.file_path },
                { tool: next.tool, timestamp: next.timestamp, summary: next.arguments?.command?.substring(0, 80) }
              ]
            });
            break;
          }
        }
      }
      
      // Pattern 6: Git clone → npm/pip install (supply chain risk)
      if (current.tool === 'exec' && /\bgit\s+clone\b/i.test(args.command || '')) {
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          const timeDiff = new Date(next.timestamp) - new Date(current.timestamp);
          if (timeDiff > windowMs * 2) break; // Longer window for installs
          
          if (next.tool === 'exec' && 
              /\b(npm\s+install|pip\s+install|yarn\s+install|pnpm\s+install)\b/i.test(next.arguments?.command || '')) {
            sequences.push({
              type: 'Clone → Package Install',
              description: `Cloned repository then ran package install`,
              reason: 'Installing dependencies from cloned repo - potential supply chain risk if repo is untrusted',
              timestamp: current.timestamp,
              actions: [
                { tool: current.tool, timestamp: current.timestamp, summary: args.command?.substring(0, 80) },
                { tool: next.tool, timestamp: next.timestamp, summary: next.arguments?.command?.substring(0, 80) }
              ]
            });
            break;
          }
        }
      }
      
      // Pattern 7: Download → Execute
      if (current.tool === 'exec' && isDownloadCommand(args.command || '')) {
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          const timeDiff = new Date(next.timestamp) - new Date(current.timestamp);
          if (timeDiff > windowMs) break;
          
          if (next.tool === 'exec' && isExecuteCommand(next.arguments?.command || '')) {
            sequences.push({
              type: 'Download → Execute',
              description: `Downloaded file then executed something`,
              reason: 'File was downloaded and executed shortly after - classic malware pattern',
              timestamp: current.timestamp,
              actions: [
                { tool: current.tool, timestamp: current.timestamp, summary: args.command?.substring(0, 80) },
                { tool: next.tool, timestamp: next.timestamp, summary: next.arguments?.command?.substring(0, 80) }
              ]
            });
            break;
          }
        }
      }
      
      // Pattern 8: Password manager access → any outbound
      if (current.tool === 'exec' && isPasswordManagerCommand(args.command || '')) {
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          const timeDiff = new Date(next.timestamp) - new Date(current.timestamp);
          if (timeDiff > windowMs) break;
          
          if ((next.tool === 'exec' && isNetworkCommand(next.arguments?.command)) ||
              next.tool === 'web_fetch' ||
              (next.tool === 'message' && next.arguments?.action === 'send')) {
            sequences.push({
              type: 'Password Manager → Outbound',
              description: `Accessed password manager then sent data externally`,
              reason: 'Credentials were accessed from password manager before outbound activity',
              timestamp: current.timestamp,
              actions: [
                { tool: current.tool, timestamp: current.timestamp, summary: args.command?.substring(0, 60) },
                { tool: next.tool, timestamp: next.timestamp, summary: getSummary(next) }
              ]
            });
            break;
          }
        }
      }
      
      // Pattern 9: Bulk file enumeration (many reads in short time)
      if (current.tool === 'read' || current.tool === 'Read') {
        const readsInWindow = [];
        for (let j = i; j < sorted.length && j < i + 20; j++) {
          const other = sorted[j];
          const timeDiff = new Date(other.timestamp) - new Date(current.timestamp);
          if (timeDiff > 60000) break; // 1 minute window for enumeration
          
          if (other.tool === 'read' || other.tool === 'Read') {
            readsInWindow.push(other);
          }
        }
        
        if (readsInWindow.length >= 10) {
          // Check if we already flagged this
          const alreadyFlagged = sequences.some(s => 
            s.type === 'Bulk File Enumeration' && 
            Math.abs(new Date(s.timestamp) - new Date(current.timestamp)) < 60000
          );
          
          if (!alreadyFlagged) {
            sequences.push({
              type: 'Bulk File Enumeration',
              description: `${readsInWindow.length} files read in under 1 minute`,
              reason: 'Rapid file access may indicate reconnaissance or data harvesting',
              timestamp: current.timestamp,
              actions: readsInWindow.slice(0, 5).map(a => ({
                tool: a.tool,
                timestamp: a.timestamp,
                summary: a.arguments?.path || a.arguments?.file_path
              }))
            });
          }
        }
      }
      
      // Pattern 10: Persistence attempt (cron/launchd creation)
      if (current.tool === 'exec') {
        const cmd = args.command || '';
        if (/\bcrontab\b/i.test(cmd) || 
            /launchctl\s+load/i.test(cmd) ||
            /systemctl\s+(enable|start)/i.test(cmd)) {
          sequences.push({
            type: 'Persistence Mechanism',
            description: `Created scheduled task or service`,
            reason: 'Agent created a persistence mechanism - verify this was intentional',
            timestamp: current.timestamp,
            actions: [
              { tool: current.tool, timestamp: current.timestamp, summary: cmd.substring(0, 100) }
            ]
          });
        }
      }
      
      // Pattern 11: Write to LaunchAgents/cron.d (persistence via file)
      if ((current.tool === 'write' || current.tool === 'Write') &&
          isPersistencePath(args.path || args.file_path)) {
        sequences.push({
          type: 'Persistence via File',
          description: `Wrote to startup/scheduled task location`,
          reason: 'File written to persistence location - will run automatically',
          timestamp: current.timestamp,
          actions: [
            { tool: current.tool, timestamp: current.timestamp, summary: args.path || args.file_path }
          ]
        });
      }
      
      // Pattern 12: Camera/Screen capture
      if (current.tool === 'exec') {
        const cmd = args.command || '';
        if (/\b(imagesnap|screencapture|ffmpeg.*avfoundation|afrecord)\b/i.test(cmd)) {
          sequences.push({
            type: 'Media Capture',
            description: `Captured camera, screen, or audio`,
            reason: 'Agent accessed camera/microphone/screen - verify this was requested',
            timestamp: current.timestamp,
            actions: [
              { tool: current.tool, timestamp: current.timestamp, summary: cmd.substring(0, 100) }
            ]
          });
        }
      }
      
      // Pattern 13: Keychain access
      if (current.tool === 'exec') {
        const cmd = args.command || '';
        if (/\bsecurity\s+(find-generic-password|find-internet-password|dump-keychain)\b/i.test(cmd)) {
          sequences.push({
            type: 'Keychain Access',
            description: `Extracted credentials from system keychain`,
            reason: 'Agent accessed macOS Keychain - high sensitivity operation',
            timestamp: current.timestamp,
            actions: [
              { tool: current.tool, timestamp: current.timestamp, summary: cmd.substring(0, 100) }
            ]
          });
        }
      }
    }
    
    // Deduplicate and limit
    const unique = sequences.filter((seq, i, arr) => 
      arr.findIndex(s => s.type === seq.type && s.timestamp === seq.timestamp) === i
    );
    
    res.json({
      sequences: unique.slice(0, 20),
      total: unique.length,
    });
  } catch (error) {
    console.error('Failed to analyze sequences:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper functions for sequence detection
function isSensitivePath(path) {
  if (!path) return false;
  const patterns = [
    /\.env/i, /\.ssh/i, /\.aws/i, /\.gnupg/i,
    /password/i, /secret/i, /credential/i, /token/i,
    /keychain/i, /id_rsa/i, /\.pem$/i, /\.key$/i,
    /1password/i, /bitwarden/i, /lastpass/i,
  ];
  return patterns.some(p => p.test(path));
}

function isNetworkCommand(cmd) {
  if (!cmd) return false;
  return /\b(curl|wget|nc|netcat|ssh|scp|rsync)\b/i.test(cmd);
}

function isSudoCommand(cmd) {
  if (!cmd) return false;
  return /\bsudo\b/i.test(cmd);
}

function isDestructiveCommand(cmd) {
  if (!cmd) return false;
  return /\b(rm\s+-rf|chmod\s+777|dd\s+if=|mkfs)\b/i.test(cmd);
}

function isConfigFile(path) {
  if (!path) return false;
  return /\.(env|json|ya?ml|toml|ini|conf|config)$/i.test(path) ||
         /config/i.test(path);
}

function containsSensitivePatterns(text) {
  if (!text) return false;
  // Look for things that look like API keys, tokens, passwords
  const patterns = [
    /sk-[a-zA-Z0-9]{20,}/,  // OpenAI-style key
    /[a-zA-Z0-9]{40,}/,     // Long hex/base64 strings
    /password\s*[:=]\s*\S+/i,
    /api[_-]?key\s*[:=]\s*\S+/i,
    /token\s*[:=]\s*\S+/i,
    /secret\s*[:=]\s*\S+/i,
  ];
  return patterns.some(p => p.test(text));
}

function isSSHKeyPath(path) {
  if (!path) return false;
  return /\.(ssh|gnupg)\/(id_|authorized_keys|known_hosts|config)/i.test(path) ||
         /id_(rsa|ed25519|ecdsa|dsa)/i.test(path);
}

function isDownloadCommand(cmd) {
  if (!cmd) return false;
  return /\b(curl\s+(-O|--output|-o)|wget|aria2c)\b/i.test(cmd);
}

function isExecuteCommand(cmd) {
  if (!cmd) return false;
  return /\b(bash|sh|zsh|chmod\s+\+x|\.\/|python|node|ruby|perl)\s/i.test(cmd);
}

function isPasswordManagerCommand(cmd) {
  if (!cmd) return false;
  return /\b(op\s+(read|get|item)|bw\s+(get|list)|security\s+find-(generic|internet)-password|pass\s+show)\b/i.test(cmd);
}

function isPersistencePath(path) {
  if (!path) return false;
  return /LaunchAgents|LaunchDaemons|cron\.d|systemd|autostart|init\.d/i.test(path);
}

function getSummary(item) {
  const args = item.arguments || {};
  switch (item.tool) {
    case 'exec': return args.command?.substring(0, 60) || '(command)';
    case 'web_fetch': return args.url || '(url)';
    case 'message': return `${args.action} to ${args.target || args.channel}`;
    default: return JSON.stringify(args).substring(0, 60);
  }
}

// ============================================
// EXPORT ENDPOINTS
// ============================================

/**
 * Export activity as JSON
 */
app.get('/api/export/json', (req, res) => {
  try {
    const activity = getAllActivity(SESSIONS_DIR, 10000);
    const analyzed = activity.map(a => ({
      ...a,
      risk: analyzeRisk(a),
      category: categorize(a.tool),
    }));
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=clawdbot-activity.json');
    res.json({
      exportedAt: new Date().toISOString(),
      totalRecords: analyzed.length,
      activity: analyzed,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Export activity as CSV
 */
app.get('/api/export/csv', (req, res) => {
  try {
    const activity = getAllActivity(SESSIONS_DIR, 10000);
    
    const headers = ['timestamp', 'tool', 'category', 'risk_level', 'risk_flags', 'arguments', 'session_id'];
    const rows = activity.map(a => {
      const risk = analyzeRisk(a);
      return [
        a.timestamp,
        a.tool,
        categorize(a.tool),
        risk.level,
        risk.flags.join('; '),
        JSON.stringify(a.arguments).replace(/"/g, '""'),
        a.sessionId,
      ].map(v => `"${v}"`).join(',');
    });
    
    const csv = [headers.join(','), ...rows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=clawdbot-activity.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// KILL SWITCH ENDPOINTS
// ============================================

/**
 * Get Clawdbot gateway status
 */
app.get('/api/gateway/status', (req, res) => {
  try {
    // Check if clawdbot gateway is running
    let isRunning = false;
    let pid = null;
    
    try {
      const result = execSync('pgrep -f "clawdbot.*gateway" || true', { encoding: 'utf-8' });
      if (result.trim()) {
        isRunning = true;
        pid = result.trim().split('\n')[0];
      }
    } catch (e) {
      // pgrep returns non-zero if no match
    }
    
    // Also check via clawdbot CLI if available
    let cliStatus = null;
    try {
      cliStatus = execSync('clawdbot gateway status 2>&1 || true', { encoding: 'utf-8', timeout: 5000 });
    } catch (e) {
      cliStatus = 'CLI check failed';
    }
    
    res.json({
      isRunning,
      pid,
      cliStatus: cliStatus?.trim(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * KILL SWITCH - Stop Clawdbot gateway immediately
 */
app.post('/api/gateway/kill', (req, res) => {
  try {
    console.log('⚠️  KILL SWITCH ACTIVATED');
    
    const results = {
      timestamp: new Date().toISOString(),
      actions: [],
    };
    
    // Method 1: Try clawdbot CLI
    try {
      execSync('clawdbot gateway stop 2>&1', { encoding: 'utf-8', timeout: 10000 });
      results.actions.push({ method: 'clawdbot CLI', success: true });
    } catch (e) {
      results.actions.push({ method: 'clawdbot CLI', success: false, error: e.message });
    }
    
    // Method 2: Kill by process name
    try {
      execSync('pkill -f "clawdbot.*gateway" || true', { encoding: 'utf-8' });
      results.actions.push({ method: 'pkill gateway', success: true });
    } catch (e) {
      results.actions.push({ method: 'pkill gateway', success: false, error: e.message });
    }
    
    // Method 3: Kill node processes running clawdbot
    try {
      execSync('pkill -f "node.*clawdbot" || true', { encoding: 'utf-8' });
      results.actions.push({ method: 'pkill node clawdbot', success: true });
    } catch (e) {
      results.actions.push({ method: 'pkill node clawdbot', success: false, error: e.message });
    }
    
    // Verify it's actually stopped
    setTimeout(() => {
      try {
        const check = execSync('pgrep -f "clawdbot.*gateway" || echo "stopped"', { encoding: 'utf-8' });
        results.verified = check.trim() === 'stopped';
      } catch (e) {
        results.verified = true; // pgrep returns error if no match
      }
    }, 1000);
    
    results.message = 'Kill switch executed - OpenClaw gateway termination attempted';
    
    // Broadcast to all connected clients
    const killMessage = JSON.stringify({
      type: 'kill_switch',
      timestamp: new Date().toISOString(),
      message: 'KILL SWITCH ACTIVATED - Gateway terminated',
    });
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(killMessage);
      }
    }
    
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Restart Clawdbot gateway (for recovery after kill)
 */
app.post('/api/gateway/restart', (req, res) => {
  try {
    console.log('🔄 Gateway restart requested');
    
    let result;
    try {
      result = execSync('clawdbot gateway start 2>&1', { encoding: 'utf-8', timeout: 15000 });
    } catch (e) {
      result = e.message;
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      message: 'Gateway restart attempted',
      output: result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ALERT WEBHOOK ENDPOINTS  
// ============================================

/**
 * Get alert configuration
 */
app.get('/api/alerts/config', (req, res) => {
  res.json(alertConfig);
});

/**
 * Update alert configuration
 */
app.post('/api/alerts/config', express.json(), (req, res) => {
  try {
    const { enabled, webhookUrl, telegramChatId, alertOnHighRisk, alertOnCategories, onRiskLevels } = req.body;
    
    if (typeof enabled === 'boolean') alertConfig.enabled = enabled;
    if (webhookUrl !== undefined) alertConfig.webhookUrl = webhookUrl;
    if (telegramChatId !== undefined) alertConfig.telegramChatId = telegramChatId;
    if (Array.isArray(onRiskLevels)) alertConfig.onRiskLevels = onRiskLevels;
    if (Array.isArray(alertOnCategories)) alertConfig.alertOnCategories = alertOnCategories;
    // Legacy: convert alertOnHighRisk boolean to onRiskLevels if provided
    if (typeof alertOnHighRisk === 'boolean' && !onRiskLevels) {
      alertConfig.onRiskLevels = alertOnHighRisk ? ['high', 'critical'] : ['low', 'medium', 'high', 'critical'];
    }
    
    res.json({ success: true, config: alertConfig });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Test alert webhook
 */
app.post('/api/alerts/test', express.json(), async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    const url = webhookUrl || alertConfig.webhookUrl;
    
    if (!url) {
      return res.status(400).json({ error: 'No webhook URL configured' });
    }
    
    const testPayload = {
      type: 'test',
      message: '🧪 ClawGuard alert test',
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

// ============================================
// STREAMING ENDPOINTS (External Log Sink)
// ============================================

/**
 * Get streaming configuration and status
 */
app.get('/api/streaming', (req, res) => {
  res.json({
    config: {
      enabled: streamingConfig.enabled,
      endpoint: streamingConfig.endpoint ? '***configured***' : null,
      batchSize: streamingConfig.batchSize,
      flushIntervalMs: streamingConfig.flushIntervalMs,
    },
    stats: {
      ...streamingStats,
      bufferSize: streamBuffer.length,
    },
  });
});

/**
 * Update streaming configuration
 */
app.post('/api/streaming', express.json(), (req, res) => {
  try {
    const updates = req.body;
    
    if (updates.enabled !== undefined) streamingConfig.enabled = updates.enabled;
    if (updates.endpoint !== undefined) streamingConfig.endpoint = updates.endpoint;
    if (updates.authHeader !== undefined) streamingConfig.authHeader = updates.authHeader;
    if (updates.batchSize !== undefined) streamingConfig.batchSize = updates.batchSize;
    if (updates.flushIntervalMs !== undefined) streamingConfig.flushIntervalMs = updates.flushIntervalMs;
    
    // Update config file
    config.streaming = {
      enabled: streamingConfig.enabled,
      endpoint: streamingConfig.endpoint,
      authHeader: streamingConfig.authHeader,
      batchSize: streamingConfig.batchSize,
      flushIntervalMs: streamingConfig.flushIntervalMs,
    };
    saveConfig(config);
    
    // Restart streaming interval with new settings
    startStreamingInterval();
    
    res.json({ 
      success: true, 
      message: streamingConfig.enabled ? 'Streaming enabled' : 'Streaming disabled',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Test streaming endpoint
 */
app.post('/api/streaming/test', express.json(), async (req, res) => {
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
      message: response.ok ? 'Test successful - endpoint reachable' : `Endpoint returned ${response.status}`,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: 'Failed to reach endpoint',
    });
  }
});

/**
 * Force flush streaming buffer
 */
app.post('/api/streaming/flush', async (req, res) => {
  if (!streamingConfig.enabled) {
    return res.json({ success: false, message: 'Streaming not enabled' });
  }
  
  const beforeCount = streamBuffer.length;
  await flushStreamBuffer();
  
  res.json({
    success: true,
    flushed: beforeCount,
    remaining: streamBuffer.length,
  });
});

// ============================================
// SESSION DUMP ENDPOINTS (Full Session Export)
// ============================================

/**
 * Dump a single session to external endpoint
 */
app.post('/api/dump/session/:id', express.json(), async (req, res) => {
  const endpoint = req.body.endpoint || streamingConfig.endpoint;
  const authHeader = req.body.authHeader || streamingConfig.authHeader;
  
  if (!endpoint) {
    return res.status(400).json({ error: 'No endpoint configured. Set streaming endpoint or provide one in request.' });
  }
  
  try {
    const sessions = listSessions(SESSIONS_DIR);
    const sessionInfo = sessions.find(s => s.id === req.params.id);
    
    if (!sessionInfo) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const session = parseSession(sessionInfo.path);
    const activity = extractActivity(session);
    
    // Analyze risk for each activity
    const analyzedActivity = activity.map(a => ({
      ...a,
      risk: analyzeRisk(a),
      category: categorize(a.tool),
    }));
    
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
        type: 'session_dump',
        timestamp: new Date().toISOString(),
        session: {
          id: sessionInfo.id,
          name: sessionInfo.name,
          modified: sessionInfo.modified,
          metadata: session?.metadata,
        },
        activityCount: analyzedActivity.length,
        activity: analyzedActivity,
      }),
    });
    
    if (response.ok) {
      res.json({
        success: true,
        sessionId: req.params.id,
        activityCount: analyzedActivity.length,
        message: `Session dumped successfully (${analyzedActivity.length} activities)`,
      });
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Dump all sessions to external endpoint
 */
app.post('/api/dump/all', express.json(), async (req, res) => {
  const endpoint = req.body.endpoint || streamingConfig.endpoint;
  const authHeader = req.body.authHeader || streamingConfig.authHeader;
  const sendAsIndividual = req.body.individual !== false; // Default: send each session separately
  
  if (!endpoint) {
    return res.status(400).json({ error: 'No endpoint configured. Set streaming endpoint or provide one in request.' });
  }
  
  try {
    const sessions = listSessions(SESSIONS_DIR);
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'ClawGuard/0.2.0',
    };
    if (authHeader) headers['Authorization'] = authHeader;
    
    const results = {
      success: true,
      totalSessions: sessions.length,
      totalActivity: 0,
      sent: 0,
      failed: 0,
      errors: [],
    };
    
    for (const sessionInfo of sessions) {
      try {
        const session = parseSession(sessionInfo.path);
        const activity = extractActivity(session);
        
        const analyzedActivity = activity.map(a => ({
          ...a,
          risk: analyzeRisk(a),
          category: categorize(a.tool),
        }));
        
        results.totalActivity += analyzedActivity.length;
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            source: 'clawguard',
            type: 'session_dump',
            timestamp: new Date().toISOString(),
            session: {
              id: sessionInfo.id,
              name: sessionInfo.name,
              modified: sessionInfo.modified,
              metadata: session?.metadata,
            },
            activityCount: analyzedActivity.length,
            activity: analyzedActivity,
          }),
        });
        
        if (response.ok) {
          results.sent++;
        } else {
          results.failed++;
          results.errors.push({ session: sessionInfo.id, error: `HTTP ${response.status}` });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({ session: sessionInfo.id, error: error.message });
      }
    }
    
    results.success = results.failed === 0;
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get dump status/preview (how many sessions, total activity)
 */
app.get('/api/dump/preview', (req, res) => {
  try {
    const sessions = listSessions(SESSIONS_DIR);
    let totalActivity = 0;
    
    const sessionPreviews = sessions.map(sessionInfo => {
      const session = parseSession(sessionInfo.path);
      const activity = extractActivity(session);
      totalActivity += activity.length;
      
      return {
        id: sessionInfo.id,
        name: sessionInfo.name,
        modified: sessionInfo.modified,
        activityCount: activity.length,
      };
    });
    
    res.json({
      totalSessions: sessions.length,
      totalActivity,
      sessions: sessionPreviews,
      endpoint: streamingConfig.endpoint ? '***configured***' : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send alert (internal function)
 */
async function sendAlert(activity, risk) {
  if (!alertConfig.enabled || !alertConfig.webhookUrl) return;
  
  // Only alert if the risk level is in the configured onRiskLevels list (e.g. ['high', 'critical'])
  if (!alertConfig.onRiskLevels.includes(risk.level)) {
    return;
  }
  
  // Check for Telegram
  const isTelegram = alertConfig.webhookUrl.includes('api.telegram.org');
  let body;
  
  if (isTelegram) {
    // Telegram requires 'chat_id' and 'text' fields
    if (!alertConfig.telegramChatId) {
      console.error('Telegram alert skipped: telegramChatId not configured');
      return;
    }
    const message = `⚠️ ${risk.level.toUpperCase()} RISK: ${activity.tool}\n\nFlags: ${risk.flags.join(', ')}\nArgs: ${JSON.stringify(activity.arguments).substring(0, 100)}`;
    body = JSON.stringify({
      chat_id: alertConfig.telegramChatId,
      text: message,
      parse_mode: 'Markdown'
    });
  } else {
    // Standard webhook payload
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

// WebSocket for live updates
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected for live updates');
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });
});

// Watch for file changes and broadcast updates
const watcher = watch(SESSIONS_DIR, {
  ignoreInitial: true,
  persistent: true,
});

watcher.on('change', (path) => {
  console.log('Session file changed:', path);
  
  // Process for streaming (external log sink)
  if (path.endsWith('.jsonl')) {
    processNewLogEntries(path);
  }
  
  // Broadcast to all connected clients
  const message = JSON.stringify({
    type: 'update',
    file: path,
    timestamp: new Date().toISOString(),
  });
  
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`\n🛡️  ClawGuard v0.3.0`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🌐 Dashboard:  http://localhost:${PORT}`);
  console.log(`📁 Sessions:   ${SESSIONS_DIR}`);
  console.log(`📋 Config:     ${config._configPath}`);
  console.log(`🔔 Alerts:     ${alertConfig.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`📤 Streaming:  ${streamingConfig.enabled ? streamingConfig.endpoint : 'Disabled'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
  // Start streaming if enabled
  startStreamingInterval();
});
