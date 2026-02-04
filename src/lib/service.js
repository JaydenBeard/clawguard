/**
 * Cross-platform service installer for ClawGuard.
 *
 * - macOS: LaunchAgent (~~/Library/LaunchAgents/)
 * - Linux: systemd user service (~/.config/systemd/user/)
 * - Windows: Task Scheduler (schtasks)
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { platform } from 'os';

const SERVICE_LABEL = 'com.clawguard';
const SERVICE_NAME = 'ClawGuard';

function getNodePath() {
  return process.execPath;
}

function getServerPath(root) {
  return join(root, 'src', 'server.js');
}

// ── macOS ──────────────────────────────────────────────

function macosInstall(root) {
  const plistDir = join(process.env.HOME, 'Library', 'LaunchAgents');
  const plistPath = join(plistDir, `${SERVICE_LABEL}.plist`);
  const nodePath = getNodePath();
  const serverPath = getServerPath(root);

  if (!existsSync(plistDir)) mkdirSync(plistDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${serverPath}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${root}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/clawguard.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/clawguard.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>${process.env.HOME}</string>
    </dict>
</dict>
</plist>`;

  writeFileSync(plistPath, plist);

  // Unload first if already loaded (ignore errors)
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { encoding: 'utf-8' });
  } catch {
    // not loaded yet
  }

  execSync(`launchctl load "${plistPath}"`, { encoding: 'utf-8' });
  return plistPath;
}

function macosUninstall() {
  const plistPath = join(process.env.HOME, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
  if (!existsSync(plistPath)) return false;

  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { encoding: 'utf-8' });
  } catch {
    // already unloaded
  }
  unlinkSync(plistPath);
  return true;
}

function macosIsInstalled() {
  return existsSync(join(process.env.HOME, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`));
}

// ── Linux ──────────────────────────────────────────────

function linuxInstall(root) {
  const serviceDir = join(process.env.HOME, '.config', 'systemd', 'user');
  const servicePath = join(serviceDir, 'clawguard.service');
  const nodePath = getNodePath();
  const serverPath = getServerPath(root);

  if (!existsSync(serviceDir)) mkdirSync(serviceDir, { recursive: true });

  const unit = `[Unit]
Description=${SERVICE_NAME} - Activity Monitor for OpenClaw
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${serverPath}
WorkingDirectory=${root}
Restart=on-failure
RestartSec=5
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=HOME=${process.env.HOME}

[Install]
WantedBy=default.target
`;

  writeFileSync(servicePath, unit);
  execSync('systemctl --user daemon-reload', { encoding: 'utf-8' });
  execSync('systemctl --user enable clawguard.service', { encoding: 'utf-8' });
  execSync('systemctl --user start clawguard.service', { encoding: 'utf-8' });
  return servicePath;
}

function linuxUninstall() {
  const servicePath = join(process.env.HOME, '.config', 'systemd', 'user', 'clawguard.service');
  if (!existsSync(servicePath)) return false;

  try {
    execSync('systemctl --user stop clawguard.service 2>/dev/null', { encoding: 'utf-8' });
    execSync('systemctl --user disable clawguard.service 2>/dev/null', { encoding: 'utf-8' });
  } catch {
    // already stopped
  }
  unlinkSync(servicePath);
  execSync('systemctl --user daemon-reload', { encoding: 'utf-8' });
  return true;
}

function linuxIsInstalled() {
  return existsSync(join(process.env.HOME, '.config', 'systemd', 'user', 'clawguard.service'));
}

// ── Windows ────────────────────────────────────────────

function windowsInstall(root) {
  const nodePath = getNodePath();
  const serverPath = getServerPath(root);
  const taskName = SERVICE_NAME;

  // Remove existing task if present
  try {
    execSync(`schtasks /Delete /TN "${taskName}" /F 2>nul`, { encoding: 'utf-8' });
  } catch {
    // didn't exist
  }

  execSync(
    `schtasks /Create /SC ONLOGON /TN "${taskName}" /TR "\\"${nodePath}\\" \\"${serverPath}\\"" /RL LIMITED /F`,
    { encoding: 'utf-8' },
  );

  // Start it now too
  execSync(`schtasks /Run /TN "${taskName}"`, { encoding: 'utf-8' });
  return taskName;
}

function windowsUninstall() {
  try {
    execSync(`schtasks /Delete /TN "${SERVICE_NAME}" /F`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

function windowsIsInstalled() {
  try {
    execSync(`schtasks /Query /TN "${SERVICE_NAME}" 2>nul`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

// ── Public API ─────────────────────────────────────────

export function install(root) {
  const os = platform();
  switch (os) {
    case 'darwin':
      return { path: macosInstall(root), platform: 'macOS (LaunchAgent)' };
    case 'linux':
      return { path: linuxInstall(root), platform: 'Linux (systemd)' };
    case 'win32':
      return { path: windowsInstall(root), platform: 'Windows (Task Scheduler)' };
    default:
      throw new Error(`Unsupported platform: ${os}`);
  }
}

export function uninstall() {
  const os = platform();
  switch (os) {
    case 'darwin':
      return macosUninstall();
    case 'linux':
      return linuxUninstall();
    case 'win32':
      return windowsUninstall();
    default:
      throw new Error(`Unsupported platform: ${os}`);
  }
}

export function isInstalled() {
  const os = platform();
  switch (os) {
    case 'darwin':
      return macosIsInstalled();
    case 'linux':
      return linuxIsInstalled();
    case 'win32':
      return windowsIsInstalled();
    default:
      return false;
  }
}
