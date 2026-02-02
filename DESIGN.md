# Clawdbot Activity Dashboard

## Overview
A local web dashboard for monitoring and auditing Clawdbot activity. Designed for security-conscious users who want transparency into what their AI assistant is doing.

## Target Users
- Clawdbot operators who want visibility
- Security-conscious users auditing AI actions
- Developers debugging agent behavior

## Core Features

### 1. Activity Timeline
- Chronological feed of all tool calls
- Expandable details for each action
- Color-coded by risk level
- Timestamps with relative time ("2 minutes ago")

### 2. Category Views
| Category | Tools | Risk Level |
|----------|-------|------------|
| **Shell Commands** | exec, process | High |
| **File Access** | read, write, edit | Medium-High |
| **Network** | web_fetch, web_search, browser | Medium |
| **Messaging** | message, tts | Medium |
| **System** | cron, gateway, sessions_spawn | Low-Medium |
| **Memory** | memory_search, memory_get | Low |

### 3. Security Highlights
Automatic flagging for sensitive operations:
- File access to `~/.ssh`, `~/.gnupg`, `~/.aws`, credentials
- Shell commands with `sudo`, `rm -rf`, `curl | sh`, etc.
- Network calls to unknown/suspicious domains
- 1Password, Keychain, or credential manager access
- Large file writes or bulk deletions

### 4. Session Management
- List all sessions with metadata
- Switch between sessions
- Show active vs archived sessions
- Session duration and token usage

### 5. Search & Filter
- Full-text search across all activity
- Filter by tool type, risk level, time range
- Export filtered results

### 6. Statistics Dashboard
- Tool usage breakdown (pie/bar chart)
- Activity over time (line chart)
- Risk distribution
- Most accessed files/paths
- Most common commands

## Technical Architecture

### Stack
- **Backend**: Node.js with Express
- **Frontend**: Vanilla JS + Tailwind CSS (no heavy frameworks, fast load)
- **Data**: Direct JSONL file parsing (no database needed)
- **Real-time**: Optional WebSocket for live tailing

### Data Flow
```
~/.clawdbot/agents/*/sessions/*.jsonl
          ↓
    [Parser/Indexer]
          ↓
    [REST API Server]
          ↓
    [Web Dashboard]
```

### API Endpoints
```
GET  /api/sessions              - List all sessions
GET  /api/sessions/:id          - Get session details
GET  /api/sessions/:id/activity - Get activity for session
GET  /api/activity              - Get all activity (paginated)
GET  /api/activity/search       - Search activity
GET  /api/stats                 - Get statistics
WS   /api/live                  - Live activity stream
```

### File Structure
```
clawdbot-dashboard/
├── src/
│   ├── server.js           # Express server
│   ├── parser.js           # JSONL parser
│   ├── indexer.js          # Activity indexer
│   ├── risk-analyzer.js    # Risk level detection
│   └── api/
│       ├── sessions.js
│       ├── activity.js
│       └── stats.js
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── package.json
└── README.md
```

## UI Design

### Layout
```
┌─────────────────────────────────────────────────────────────┐
│  🔍 Search...                    [Filter ▼]  [Session ▼]    │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐│
│ │  Total  │ │  Shell  │ │  Files  │ │ Network │ │  Alerts ││
│ │  1,247  │ │   733   │ │   388   │ │    37   │ │    12   ││
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ⚡ exec "git status" (2m ago)                         [Low]│
│  📄 read "/Users/jay/clawd/SOUL.md" (3m ago)          [Low]│
│  🔴 exec "rm -rf /tmp/old-cache" (5m ago)            [High]│
│  🌐 web_fetch "https://api.github.com/..." (7m ago) [Medium]│
│  ✉️ message to #alerts (10m ago)                      [Low]│
│  ...                                                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  [Load More]                              Showing 1-50 of 1247│
└─────────────────────────────────────────────────────────────┘
```

### Color Scheme
- **Background**: #0f172a (dark slate)
- **Cards**: #1e293b (lighter slate)
- **Accent**: #3b82f6 (blue)
- **Success/Low**: #22c55e (green)
- **Warning/Medium**: #f59e0b (amber)
- **Danger/High**: #ef4444 (red)
- **Text**: #f8fafc (white)
- **Muted**: #94a3b8 (gray)

## Risk Analysis Rules

### High Risk (Red)
- `exec` with: `sudo`, `rm -rf`, `chmod 777`, `curl | sh`, `eval`
- File access to: `~/.ssh/*`, `~/.gnupg/*`, `~/.aws/*`, `*password*`, `*secret*`, `*credential*`, `*token*`
- Any `1password`, `op` CLI, or keychain access
- `write` to system paths: `/etc/`, `/usr/`, `/bin/`
- Network calls to IP addresses (not domains)

### Medium Risk (Amber)
- `exec` with: `curl`, `wget`, network commands
- `write` to any file outside workspace
- `web_fetch` to non-HTTPS URLs
- `message` to external channels
- `browser` automation
- Large file operations (>1MB)

### Low Risk (Green)
- `read` within workspace
- `exec` with: `ls`, `cat`, `grep`, `git`, common dev tools
- `memory_search`, `memory_get`
- `web_search` queries

## Future Enhancements
- [ ] Alert notifications (desktop/webhook)
- [ ] Activity comparison between sessions
- [ ] Export to CSV/JSON
- [ ] Custom risk rules configuration
- [ ] Multi-agent support
- [ ] Authentication for remote access
- [ ] Activity replay/timeline scrubbing
