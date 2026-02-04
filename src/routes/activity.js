import { Router } from 'express';
import { getAllActivity } from '../lib/parser.js';
import {
  analyzeRisk,
  categorize,
  getCategoryIcon,
  getRiskColor,
  ToolCategory,
  RiskLevel,
} from '../lib/risk-analyzer.js';
import {
  isSensitivePath,
  isNetworkCommand,
  isSudoCommand,
  isDestructiveCommand,
  isConfigFile,
  containsSensitivePatterns,
  isSSHKeyPath,
  isDownloadCommand,
  isExecuteCommand,
  isPasswordManagerCommand,
  isPersistencePath,
  getSummary,
} from '../lib/sequence-helpers.js';
import { SESSIONS_DIR, SEQUENCE_WINDOW_MS } from '../lib/state.js';

const router = Router();

router.get('/activity', (req, res) => {
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
    activity = activity.map((a) => {
      const category = categorize(a.tool);
      return {
        ...a,
        risk: analyzeRisk(a),
        category,
        icon: getCategoryIcon(category),
      };
    });

    if (category && category !== 'all') activity = activity.filter((a) => a.category === category);
    if (riskLevel && riskLevel !== 'all')
      activity = activity.filter((a) => a.risk.level === riskLevel);
    if (tool && tool !== 'all') activity = activity.filter((a) => a.tool === tool);

    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      activity = activity.filter((a) => new Date(a.timestamp) >= fromDate);
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      activity = activity.filter((a) => new Date(a.timestamp) <= toDate);
    }

    if (search) {
      activity = activity.filter((a) => JSON.stringify(a).toLowerCase().includes(search));
    }

    const total = activity.length;
    const paginated = activity.slice(offset, offset + limit);
    res.json({ activity: paginated, total, offset, limit, hasMore: offset + limit < total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats', (req, res) => {
  try {
    const activity = getAllActivity(SESSIONS_DIR, 10000);
    const analyzed = activity.map((a) => ({
      ...a,
      risk: analyzeRisk(a),
      category: categorize(a.tool),
    }));

    const byTool = {};
    for (const a of analyzed) byTool[a.tool] = (byTool[a.tool] || 0) + 1;

    const byCategory = {};
    for (const a of analyzed) byCategory[a.category] = (byCategory[a.category] || 0) + 1;

    const byRisk = {};
    for (const a of analyzed) byRisk[a.risk.level] = (byRisk[a.risk.level] || 0) + 1;

    const highRiskItems = analyzed.filter((a) => a.risk.level === RiskLevel.HIGH).slice(0, 20);

    const pathCounts = {};
    for (const a of analyzed) {
      const path = a.arguments?.path || a.arguments?.file_path;
      if (path) pathCounts[path] = (pathCounts[path] || 0) + 1;
    }
    const topPaths = Object.entries(pathCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));

    const byHour = {};
    for (const a of analyzed) {
      const date = new Date(a.timestamp);
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

router.get('/meta', (req, res) => {
  res.json({
    categories: Object.values(ToolCategory),
    riskLevels: Object.values(RiskLevel),
    categoryIcons: Object.fromEntries(
      Object.values(ToolCategory).map((c) => [c, getCategoryIcon(c)]),
    ),
    riskColors: Object.fromEntries(Object.values(RiskLevel).map((r) => [r, getRiskColor(r)])),
  });
});

router.get('/sequences', (req, res) => {
  try {
    const activity = getAllActivity(SESSIONS_DIR, 5000);
    const sorted = [...activity].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const sequences = [];
    const windowMs = SEQUENCE_WINDOW_MS;

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      const args = current.arguments || {};

      // Pattern 1: Read sensitive file → curl/network
      if (
        (current.tool === 'read' || current.tool === 'Read') &&
        isSensitivePath(args.path || args.file_path)
      ) {
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          const timeDiff = new Date(next.timestamp) - new Date(current.timestamp);
          if (timeDiff > windowMs) break;
          if (next.tool === 'exec' && isNetworkCommand(next.arguments?.command)) {
            sequences.push({
              type: 'Credential Access → Network',
              description: `Read ${args.path || args.file_path} then executed network command`,
              reason:
                'Sensitive file was read shortly before network activity, potential data exfiltration',
              timestamp: current.timestamp,
              actions: [
                {
                  tool: current.tool,
                  timestamp: current.timestamp,
                  summary: args.path || args.file_path,
                },
                {
                  tool: next.tool,
                  timestamp: next.timestamp,
                  summary: next.arguments?.command?.substring(0, 100),
                },
              ],
            });
            break;
          }
          if (next.tool === 'web_fetch') {
            sequences.push({
              type: 'Credential Access → Web Fetch',
              description: `Read ${args.path || args.file_path} then fetched ${next.arguments?.url}`,
              reason:
                'Sensitive file was read shortly before external request, potential credential leak',
              timestamp: current.timestamp,
              actions: [
                {
                  tool: current.tool,
                  timestamp: current.timestamp,
                  summary: args.path || args.file_path,
                },
                { tool: next.tool, timestamp: next.timestamp, summary: next.arguments?.url },
              ],
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
              if (isSudoCommand(otherCmd) || isDestructiveCommand(otherCmd)) nearby.push(other);
            }
          }
          if (nearby.length >= 2) {
            sequences.push({
              type: 'Multiple Privileged Operations',
              description: `${nearby.length + 1} dangerous commands executed in quick succession`,
              reason:
                'Rapid execution of privileged/destructive commands may indicate automated attack or mistake',
              timestamp: current.timestamp,
              actions: [current, ...nearby].map((a) => ({
                tool: a.tool,
                timestamp: a.timestamp,
                summary: a.arguments?.command?.substring(0, 100),
              })),
            });
          }
        }
      }

      // Pattern 3: Edit .env or config → restart/deploy
      if (
        (current.tool === 'edit' ||
          current.tool === 'Edit' ||
          current.tool === 'write' ||
          current.tool === 'Write') &&
        isConfigFile(args.path || args.file_path)
      ) {
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          const timeDiff = new Date(next.timestamp) - new Date(current.timestamp);
          if (timeDiff > windowMs) break;
          if (
            next.tool === 'gateway' &&
            (next.arguments?.action === 'restart' || next.arguments?.action === 'config.apply')
          ) {
            sequences.push({
              type: 'Config Change → Restart',
              description: `Modified ${args.path || args.file_path} then triggered gateway restart`,
              reason:
                'Configuration change followed by restart - verify the changes were intentional',
              timestamp: current.timestamp,
              actions: [
                {
                  tool: current.tool,
                  timestamp: current.timestamp,
                  summary: args.path || args.file_path,
                },
                {
                  tool: next.tool,
                  timestamp: next.timestamp,
                  summary: `gateway ${next.arguments?.action}`,
                },
              ],
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
            description: 'Message sent containing sensitive patterns',
            reason: 'Outbound message contains patterns that look like credentials or API keys',
            timestamp: current.timestamp,
            actions: [
              {
                tool: current.tool,
                timestamp: current.timestamp,
                summary: `message to ${args.target}`,
              },
            ],
          });
        }
      }

      // Pattern 5: SSH key access → SSH connection
      if (
        (current.tool === 'read' || current.tool === 'Read') &&
        isSSHKeyPath(args.path || args.file_path)
      ) {
        for (let j = i + 1; j < sorted.length; j++) {
          const next = sorted[j];
          const timeDiff = new Date(next.timestamp) - new Date(current.timestamp);
          if (timeDiff > windowMs) break;
          if (next.tool === 'exec' && /\bssh\s+\w+@/i.test(next.arguments?.command || '')) {
            sequences.push({
              type: 'SSH Key Access → Connection',
              description: 'Read SSH key then initiated SSH connection',
              reason:
                'SSH key was accessed before establishing connection - verify this was authorized',
              timestamp: current.timestamp,
              actions: [
                {
                  tool: current.tool,
                  timestamp: current.timestamp,
                  summary: args.path || args.file_path,
                },
                {
                  tool: next.tool,
                  timestamp: next.timestamp,
                  summary: next.arguments?.command?.substring(0, 80),
                },
              ],
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
          if (timeDiff > windowMs * 2) break;
          if (
            next.tool === 'exec' &&
            /\b(npm\s+install|pip\s+install|yarn\s+install|pnpm\s+install)\b/i.test(
              next.arguments?.command || '',
            )
          ) {
            sequences.push({
              type: 'Clone → Package Install',
              description: 'Cloned repository then ran package install',
              reason:
                'Installing dependencies from cloned repo - potential supply chain risk if repo is untrusted',
              timestamp: current.timestamp,
              actions: [
                {
                  tool: current.tool,
                  timestamp: current.timestamp,
                  summary: args.command?.substring(0, 80),
                },
                {
                  tool: next.tool,
                  timestamp: next.timestamp,
                  summary: next.arguments?.command?.substring(0, 80),
                },
              ],
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
              description: 'Downloaded file then executed something',
              reason: 'File was downloaded and executed shortly after - classic malware pattern',
              timestamp: current.timestamp,
              actions: [
                {
                  tool: current.tool,
                  timestamp: current.timestamp,
                  summary: args.command?.substring(0, 80),
                },
                {
                  tool: next.tool,
                  timestamp: next.timestamp,
                  summary: next.arguments?.command?.substring(0, 80),
                },
              ],
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
          if (
            (next.tool === 'exec' && isNetworkCommand(next.arguments?.command)) ||
            next.tool === 'web_fetch' ||
            (next.tool === 'message' && next.arguments?.action === 'send')
          ) {
            sequences.push({
              type: 'Password Manager → Outbound',
              description: 'Accessed password manager then sent data externally',
              reason: 'Credentials were accessed from password manager before outbound activity',
              timestamp: current.timestamp,
              actions: [
                {
                  tool: current.tool,
                  timestamp: current.timestamp,
                  summary: args.command?.substring(0, 60),
                },
                { tool: next.tool, timestamp: next.timestamp, summary: getSummary(next) },
              ],
            });
            break;
          }
        }
      }

      // Pattern 9: Bulk file enumeration
      if (current.tool === 'read' || current.tool === 'Read') {
        const readsInWindow = [];
        for (let j = i; j < sorted.length && j < i + 20; j++) {
          const other = sorted[j];
          const timeDiff = new Date(other.timestamp) - new Date(current.timestamp);
          if (timeDiff > 60000) break;
          if (other.tool === 'read' || other.tool === 'Read') readsInWindow.push(other);
        }
        if (readsInWindow.length >= 10) {
          const alreadyFlagged = sequences.some(
            (s) =>
              s.type === 'Bulk File Enumeration' &&
              Math.abs(new Date(s.timestamp) - new Date(current.timestamp)) < 60000,
          );
          if (!alreadyFlagged) {
            sequences.push({
              type: 'Bulk File Enumeration',
              description: `${readsInWindow.length} files read in under 1 minute`,
              reason: 'Rapid file access may indicate reconnaissance or data harvesting',
              timestamp: current.timestamp,
              actions: readsInWindow.slice(0, 5).map((a) => ({
                tool: a.tool,
                timestamp: a.timestamp,
                summary: a.arguments?.path || a.arguments?.file_path,
              })),
            });
          }
        }
      }

      // Pattern 10: Persistence attempt (cron/launchd creation)
      if (current.tool === 'exec') {
        const cmd = args.command || '';
        if (
          /\bcrontab\b/i.test(cmd) ||
          /launchctl\s+load/i.test(cmd) ||
          /systemctl\s+(enable|start)/i.test(cmd)
        ) {
          sequences.push({
            type: 'Persistence Mechanism',
            description: 'Created scheduled task or service',
            reason: 'Agent created a persistence mechanism - verify this was intentional',
            timestamp: current.timestamp,
            actions: [
              { tool: current.tool, timestamp: current.timestamp, summary: cmd.substring(0, 100) },
            ],
          });
        }
      }

      // Pattern 11: Write to LaunchAgents/cron.d
      if (
        (current.tool === 'write' || current.tool === 'Write') &&
        isPersistencePath(args.path || args.file_path)
      ) {
        sequences.push({
          type: 'Persistence via File',
          description: 'Wrote to startup/scheduled task location',
          reason: 'File written to persistence location - will run automatically',
          timestamp: current.timestamp,
          actions: [
            {
              tool: current.tool,
              timestamp: current.timestamp,
              summary: args.path || args.file_path,
            },
          ],
        });
      }

      // Pattern 12: Camera/Screen capture
      if (current.tool === 'exec') {
        const cmd = args.command || '';
        if (/\b(imagesnap|screencapture|ffmpeg.*avfoundation|afrecord)\b/i.test(cmd)) {
          sequences.push({
            type: 'Media Capture',
            description: 'Captured camera, screen, or audio',
            reason: 'Agent accessed camera/microphone/screen - verify this was requested',
            timestamp: current.timestamp,
            actions: [
              { tool: current.tool, timestamp: current.timestamp, summary: cmd.substring(0, 100) },
            ],
          });
        }
      }

      // Pattern 13: Keychain access
      if (current.tool === 'exec') {
        const cmd = args.command || '';
        if (
          /\bsecurity\s+(find-generic-password|find-internet-password|dump-keychain)\b/i.test(cmd)
        ) {
          sequences.push({
            type: 'Keychain Access',
            description: 'Extracted credentials from system keychain',
            reason: 'Agent accessed macOS Keychain - high sensitivity operation',
            timestamp: current.timestamp,
            actions: [
              { tool: current.tool, timestamp: current.timestamp, summary: cmd.substring(0, 100) },
            ],
          });
        }
      }
    }

    // Deduplicate and limit
    const unique = sequences.filter(
      (seq, idx, arr) =>
        arr.findIndex((s) => s.type === seq.type && s.timestamp === seq.timestamp) === idx,
    );

    res.json({ sequences: unique.slice(0, 20), total: unique.length });
  } catch (error) {
    console.error('Failed to analyze sequences:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
