#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { install, uninstall, isInstalled } from '../src/lib/service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const command = process.argv[2] || 'start';

// PID file for tracking background process
const pidFile = join(process.env.HOME || '', '.clawguard.pid');

function getPid() {
  if (existsSync(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim());
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      return null;
    }
  }
  return null;
}

function isRunning() {
  return getPid() !== null;
}

function writePid(pid) {
  writeFileSync(pidFile, String(pid));
}

switch (command) {
  case 'start':
  case 'run': {
    if (isRunning()) {
      console.log('ClawGuard is already running (pid:', getPid(), ')');
      process.exit(1);
    }

    const foreground = process.argv.includes('--foreground') || process.argv.includes('-f');

    if (foreground) {
      // Foreground mode — attached to terminal
      const child = spawn('node', [join(ROOT, 'src/server.js')], {
        stdio: 'inherit',
        cwd: ROOT,
      });
      child.on('exit', (code) => process.exit(code));
    } else {
      // Background mode (default) — survives terminal close
      const child = spawn('node', [join(ROOT, 'src/server.js')], {
        detached: true,
        stdio: 'ignore',
        cwd: ROOT,
      });
      writePid(child.pid);
      child.unref();
      console.log('🛡️  ClawGuard started (pid:', child.pid, ')');
      console.log('   Dashboard: http://localhost:3847');
      console.log('   Stop with: clawguard stop');
    }
    break;
  }

  case 'stop': {
    const pid = getPid();
    if (pid) {
      process.kill(pid, 'SIGTERM');
      console.log('🛑 ClawGuard stopped (pid:', pid, ')');
    } else {
      console.log('ClawGuard is not running');
    }
    break;
  }

  case 'restart': {
    const runningPid = getPid();
    if (runningPid) {
      process.kill(runningPid, 'SIGTERM');
      console.log('Stopped pid:', runningPid);
    }
    setTimeout(() => {
      const child = spawn('node', [join(ROOT, 'src/server.js')], {
        detached: true,
        stdio: 'ignore',
        cwd: ROOT,
      });
      writePid(child.pid);
      child.unref();
      console.log('🛡️  ClawGuard restarted (pid:', child.pid, ')');
    }, 500);
    break;
  }

  case 'status':
    if (isRunning()) {
      console.log('🟢 ClawGuard is running (pid:', getPid(), ')');
    } else {
      console.log('🔴 ClawGuard is not running');
    }
    if (isInstalled()) {
      console.log('📦 Auto-start: enabled');
    }
    break;

  case 'install': {
    if (isInstalled()) {
      console.log('ClawGuard is already installed as a service.');
      console.log('Run "clawguard uninstall" first to reinstall.');
      process.exit(1);
    }
    try {
      const result = install(ROOT);
      console.log(`🛡️  ClawGuard installed as a system service`);
      console.log(`   Platform:  ${result.platform}`);
      console.log(`   Config:    ${result.path}`);
      console.log(`   Dashboard: http://localhost:3847`);
      console.log('');
      console.log('ClawGuard will now start automatically on login.');
      console.log('Manage with: clawguard status | stop | start | uninstall');
    } catch (error) {
      console.error('Failed to install:', error.message);
      process.exit(1);
    }
    break;
  }

  case 'uninstall': {
    const removed = uninstall();
    if (removed) {
      console.log('🛑 ClawGuard service removed. It will no longer auto-start on login.');
      console.log('   You can still run it manually with: clawguard start');
    } else {
      console.log('ClawGuard is not installed as a service.');
    }
    break;
  }

  case 'version':
  case '-v':
  case '--version': {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    console.log('ClawGuard v' + pkg.version);
    break;
  }

  case 'update':
  case '--update': {
    const updatePkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    console.log(`Current version: v${updatePkg.version}`);
    console.log('Checking for updates...');
    try {
      const latest = execSync('npm view @jaydenbeard/clawguard version', {
        encoding: 'utf-8',
      }).trim();
      if (latest !== updatePkg.version) {
        console.log(`\nNew version available: v${latest} (current: v${updatePkg.version})`);
        console.log('Updating...');
        execSync('npm update -g @jaydenbeard/clawguard', { stdio: 'inherit' });
        console.log(`\n✅ Updated to v${latest}. Restart ClawGuard to apply.`);
      } else {
        console.log(`\n✅ Already on the latest version (v${latest})`);
      }
    } catch (e) {
      console.error('Failed to check for updates:', e.message);
      process.exit(1);
    }
    break;
  }

  case 'help':
  case '-h':
  case '--help':
    console.log(`
🛡️  ClawGuard - Activity Monitor for OpenClaw

Usage: clawguard [command]

Commands:
  start         Start in background (default)
  start -f      Start in foreground (attached to terminal)
  stop          Stop the running instance
  restart       Restart the service
  status        Check if running + auto-start status
  install       Install as auto-start service (survives reboot)
  uninstall     Remove auto-start service
  update        Check for and install updates
  version       Show version
  help          Show this help

Dashboard: http://localhost:3847
`);
    break;

  default:
    console.log(`Unknown command: ${command}`);
    console.log('Run "clawguard help" for usage');
    process.exit(1);
}
