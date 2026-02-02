# ClawGuard

🛡️ Activity monitor and security dashboard for [Clawdbot](https://github.com/clawdbot/clawdbot). See exactly what your AI agent has done, with real-time analytics and emergency kill switch.

![ClawGuard Dashboard](https://raw.githubusercontent.com/jaydenbeard/clawguard/main/docs/screenshot.png)

## Quick Install

```bash
# Via npm (recommended)
npm install -g clawguard
clawguard start

# Or clone manually
git clone https://github.com/jaydenbeard/clawguard.git
cd clawguard && npm install && npm start
```

After install, open http://localhost:3847

## Commands

```bash
clawguard           # Start dashboard (foreground)
clawguard start     # Start in background
clawguard stop      # Stop background process  
clawguard status    # Check if running
clawguard restart   # Restart service
```

## Features

### Real-time Monitoring
- Live activity feed with WebSocket updates
- Filter by category: Shell, File, Network, Browser, Message, System, Memory
- Filter by risk level: Low, Medium, High, Critical
- Full-text search across all activities
- Click-to-expand detail modal

### Risk Analysis
- **CRITICAL**: Keychain extraction, sudo commands, remote code execution, password manager access
- **HIGH**: Email sending, external messaging (WhatsApp, iMessage, Twitter), cloud CLI operations (AWS/GCP/Azure), camera/mic access, persistence mechanisms, credential file access
- **MEDIUM**: SSH connections, git push, clipboard access, Docker operations, package installation
- **LOW**: Standard file reads, web searches, memory operations

### Security Features
- 🛑 **Kill Switch**: Emergency stop for runaway agents
- 📥 **Export**: Full JSON/CSV export for external analysis
- 🔔 **Webhook Alerts**: Discord/Slack notifications on high-risk activity
- 📊 **Gateway Status**: Real-time monitoring of OpenClaw daemon

## Quick Start

```bash
cd ~/clawd/projects/clawguard
npm install
npm start
# Opens at http://localhost:3847
```

## Architecture

```
ClawGuard reads from:
~/.clawdbot/agents/main/sessions/*.jsonl

Dashboard components:
├── src/server.js              # Express + WebSocket server
├── src/lib/parser.js          # JSONL session log parser
├── src/lib/risk-analyzer.js   # Comprehensive risk detection
└── public/
    ├── index.html             # Dashboard UI
    └── app.js                 # Frontend logic
```

## Risk Detection

ClawGuard analyzes every tool call for potential security concerns:

| Category | Examples | Risk Level |
|----------|----------|------------|
| Privilege escalation | `sudo`, keychain access | CRITICAL |
| Credential access | `.ssh/`, `.aws/`, password managers | HIGH |
| External communication | Email, WhatsApp, Twitter posting | HIGH |
| Cloud operations | AWS/GCP/Azure CLI commands | HIGH |
| Camera/microphone | `imagesnap`, `ffmpeg` recording | HIGH |
| Persistence | Launch agents, crontab modification | HIGH |
| Network listeners | `nc -l`, `socat LISTEN` | HIGH |
| SSH/network | `ssh`, `scp`, `rsync` | MEDIUM |
| Package install | `npm install -g`, `brew install` | MEDIUM |
| Standard operations | File reads, web search | LOW |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/activities` | GET | List activities with filters |
| `/api/sessions` | GET | List available sessions |
| `/api/stats` | GET | Aggregate statistics |
| `/api/gateway/status` | GET | OpenClaw daemon status |
| `/api/gateway/kill` | POST | Emergency stop |
| `/api/gateway/restart` | POST | Restart daemon |
| `/api/export/json` | GET | Full JSON export |
| `/api/export/csv` | GET | CSV export |
| `/api/alerts/config` | GET/POST | Webhook configuration |

## Trust Model

**Important**: ClawGuard provides transparency for *cooperative* agents. It reads the same log files that the agent can potentially modify.

For truly adversarial protection, you need:
- Remote logging (ship logs off-machine in real-time)
- Separate audit user (run ClawGuard as a user the agent can't access)
- OS-level audit logs (macOS `log show` / audit facilities)

See `SECURITY.md` for detailed threat model discussion.

## Configuration

Create `config.json` to customize:

```json
{
  "port": 3847,
  "logPath": "~/.clawdbot/agents/main/sessions",
  "webhookUrl": "https://discord.com/api/webhooks/...",
  "alertOnHighRisk": true
}
```

## License

MIT - Created by Jayden Beard
