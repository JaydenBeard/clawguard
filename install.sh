#!/bin/bash
#
# ClawGuard Installer
# Tamper-resistant activity monitor for OpenClaw/Clawdbot
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/clawguard/main/install.sh | bash
#
# Or with options:
#   curl -fsSL ... | bash -s -- --no-autostart --port 3000
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default values
INSTALL_DIR="$HOME/.clawguard"
PORT=3847
SETUP_AUTOSTART=true
REPO_URL="https://github.com/YOUR_USERNAME/clawguard.git"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --no-autostart)
      SETUP_AUTOSTART=false
      shift
      ;;
    --help)
      echo "ClawGuard Installer"
      echo ""
      echo "Usage: install.sh [options]"
      echo ""
      echo "Options:"
      echo "  --dir PATH       Install directory (default: ~/.clawguard)"
      echo "  --port PORT      Dashboard port (default: 3847)"
      echo "  --no-autostart   Don't set up automatic startup"
      echo "  --help           Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo ""
echo -e "${CYAN}🦞 ClawGuard Installer${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Node.js
echo -e "${BLUE}▸ Checking Node.js...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js not found${NC}"
  echo ""
  echo "Please install Node.js 18 or later:"
  echo "  macOS:  brew install node"
  echo "  Linux:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo ""
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}✗ Node.js version $NODE_VERSION is too old (need 18+)${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# Check npm
echo -e "${BLUE}▸ Checking npm...${NC}"
if ! command -v npm &> /dev/null; then
  echo -e "${RED}✗ npm not found${NC}"
  exit 1
fi
echo -e "${GREEN}✓ npm $(npm -v)${NC}"

# Detect Clawdbot/OpenClaw sessions
echo -e "${BLUE}▸ Detecting OpenClaw/Clawdbot...${NC}"
SESSIONS_PATH=""
if [ -d "$HOME/.clawdbot/agents/main/sessions" ]; then
  SESSIONS_PATH="$HOME/.clawdbot/agents/main/sessions"
  echo -e "${GREEN}✓ Found Clawdbot sessions${NC}"
elif [ -d "$HOME/.openclaw/agents/main/sessions" ]; then
  SESSIONS_PATH="$HOME/.openclaw/agents/main/sessions"
  echo -e "${GREEN}✓ Found OpenClaw sessions${NC}"
else
  echo -e "${YELLOW}⚠ No session directory found${NC}"
  echo "  ClawGuard will prompt for the path on first run"
  SESSIONS_PATH="auto"
fi

# Create install directory
echo -e "${BLUE}▸ Installing to ${INSTALL_DIR}...${NC}"
if [ -d "$INSTALL_DIR" ]; then
  echo -e "${YELLOW}⚠ Directory exists, updating...${NC}"
  cd "$INSTALL_DIR"
  if [ -d ".git" ]; then
    git pull --quiet || true
  fi
else
  # For now, copy from local. In production, this would be git clone
  if [ -d "$(dirname "$0")/src" ]; then
    # Running from local directory
    mkdir -p "$INSTALL_DIR"
    cp -r "$(dirname "$0")"/* "$INSTALL_DIR/"
    echo -e "${GREEN}✓ Copied from local${NC}"
  else
    # Clone from git
    git clone --quiet --depth 1 "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
      echo -e "${RED}✗ Failed to clone repository${NC}"
      echo "  For local install, run this script from the ClawGuard directory"
      exit 1
    }
    echo -e "${GREEN}✓ Cloned from GitHub${NC}"
  fi
fi

cd "$INSTALL_DIR"

# Install dependencies
echo -e "${BLUE}▸ Installing dependencies...${NC}"
npm install --silent --no-fund --no-audit 2>/dev/null
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Create config file
echo -e "${BLUE}▸ Creating configuration...${NC}"
CONFIG_FILE="$INSTALL_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" << EOF
{
  "port": $PORT,
  "sessionsPath": "$SESSIONS_PATH",
  "alerts": {
    "enabled": false,
    "webhookUrl": null,
    "onRiskLevels": ["high", "critical"],
    "onSequences": true
  },
  "ui": {
    "theme": "dark",
    "defaultTimelineRange": 24,
    "activityLimit": 50
  },
  "detection": {
    "sequenceWindowMinutes": 5,
    "enableSequenceDetection": true
  }
}
EOF
  echo -e "${GREEN}✓ Config created${NC}"
else
  echo -e "${YELLOW}⚠ Config exists, keeping current settings${NC}"
fi

# Create shell command
echo -e "${BLUE}▸ Creating clawguard command...${NC}"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/clawguard" << EOF
#!/bin/bash
cd "$INSTALL_DIR"
case "\$1" in
  start)
    node src/server.js > "$INSTALL_DIR/clawguard.log" 2>&1 &
    echo "🦞 ClawGuard started at http://localhost:$PORT"
    echo "   Logs: $INSTALL_DIR/clawguard.log"
    ;;
  stop)
    pkill -f "node.*clawguard.*server" && echo "🛑 ClawGuard stopped" || echo "Not running"
    ;;
  status)
    if pgrep -f "node.*clawguard.*server" > /dev/null; then
      echo "🦞 ClawGuard is running"
      echo "   Dashboard: http://localhost:$PORT"
    else
      echo "🛑 ClawGuard is not running"
      echo "   Start with: clawguard start"
    fi
    ;;
  restart)
    "\$0" stop
    sleep 1
    "\$0" start
    ;;
  logs)
    tail -f "$INSTALL_DIR/clawguard.log" 2>/dev/null || echo "No logs found"
    ;;
  config)
    echo "Config: $INSTALL_DIR/config.json"
    cat "$INSTALL_DIR/config.json"
    ;;
  help|--help|-h)
    echo ""
    echo "🦞 ClawGuard - Activity Monitor for OpenClaw/Clawdbot"
    echo ""
    echo "Usage: clawguard [command]"
    echo ""
    echo "Commands:"
    echo "  (none)      Start dashboard in foreground"
    echo "  start       Start dashboard in background"
    echo "  stop        Stop background process"
    echo "  restart     Restart the dashboard"
    echo "  status      Check if ClawGuard is running"
    echo "  logs        Tail the log file"
    echo "  config      Show current configuration"
    echo "  help        Show this help message"
    echo ""
    echo "Dashboard: http://localhost:$PORT"
    echo "Config:    $INSTALL_DIR/config.json"
    echo ""
    ;;
  *)
    node src/server.js
    ;;
esac
EOF
chmod +x "$BIN_DIR/clawguard"

# Add to PATH if needed
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo -e "${YELLOW}⚠ Add this to your shell profile:${NC}"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
echo -e "${GREEN}✓ Command created: clawguard${NC}"

# Setup autostart (macOS launchd)
if [ "$SETUP_AUTOSTART" = true ] && [ "$(uname)" = "Darwin" ]; then
  echo -e "${BLUE}▸ Setting up autostart (launchd)...${NC}"
  PLIST_DIR="$HOME/Library/LaunchAgents"
  PLIST_FILE="$PLIST_DIR/com.clawguard.agent.plist"
  mkdir -p "$PLIST_DIR"
  
  cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.clawguard.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which node)</string>
    <string>$INSTALL_DIR/src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$INSTALL_DIR/clawguard.log</string>
  <key>StandardErrorPath</key>
  <string>$INSTALL_DIR/clawguard.log</string>
</dict>
</plist>
EOF
  
  # Load the service
  launchctl unload "$PLIST_FILE" 2>/dev/null || true
  launchctl load "$PLIST_FILE"
  echo -e "${GREEN}✓ Autostart configured${NC}"
fi

# Setup autostart (Linux systemd)
if [ "$SETUP_AUTOSTART" = true ] && [ "$(uname)" = "Linux" ] && command -v systemctl &> /dev/null; then
  echo -e "${BLUE}▸ Setting up autostart (systemd)...${NC}"
  SERVICE_DIR="$HOME/.config/systemd/user"
  SERVICE_FILE="$SERVICE_DIR/clawguard.service"
  mkdir -p "$SERVICE_DIR"
  
  cat > "$SERVICE_FILE" << EOF
[Unit]
Description=ClawGuard Activity Monitor
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) $INSTALL_DIR/src/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF
  
  systemctl --user daemon-reload
  systemctl --user enable clawguard
  systemctl --user start clawguard
  echo -e "${GREEN}✓ Autostart configured${NC}"
fi

# Done!
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ ClawGuard installed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${CYAN}Dashboard:${NC}  http://localhost:$PORT"
echo -e "  ${CYAN}Config:${NC}     $CONFIG_FILE"
echo -e "  ${CYAN}Install:${NC}    $INSTALL_DIR"
echo ""
echo "Commands:"
echo "  clawguard start     Start in background"
echo "  clawguard stop      Stop the dashboard"
echo "  clawguard status    Check if running"
echo "  clawguard help      Show all commands"
echo ""

# Start it now if not using autostart
if [ "$SETUP_AUTOSTART" = false ]; then
  echo "Start now with: clawguard start"
else
  echo -e "${GREEN}ClawGuard is now running!${NC}"
  echo "Open http://localhost:$PORT in your browser"
fi
echo ""
