#!/usr/bin/env node

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const command = process.argv[2] || 'start';

// Get PID file path
const pidFile = join(process.env.HOME, '.clawguard.pid');

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

switch (command) {
  case 'start':
  case 'run':
    if (isRunning()) {
      console.log('ClawGuard is already running (pid:', getPid(), ')');
      process.exit(1);
    }
    
    if (process.argv.includes('--background') || process.argv.includes('-b')) {
      // Background mode
      const child = spawn('node', [join(ROOT, 'src/server.js')], {
        detached: true,
        stdio: 'ignore',
        cwd: ROOT
      });
      child.unref();
      console.log('🛡️  ClawGuard started in background (pid:', child.pid, ')');
    } else {
      // Foreground mode
      const child = spawn('node', [join(ROOT, 'src/server.js')], {
        stdio: 'inherit',
        cwd: ROOT
      });
      child.on('exit', (code) => process.exit(code));
    }
    break;

  case 'stop':
    const pid = getPid();
    if (pid) {
      process.kill(pid, 'SIGTERM');
      console.log('🛑 ClawGuard stopped (pid:', pid, ')');
    } else {
      console.log('ClawGuard is not running');
    }
    break;

  case 'restart':
    const runningPid = getPid();
    if (runningPid) {
      process.kill(runningPid, 'SIGTERM');
      console.log('Stopped pid:', runningPid);
    }
    setTimeout(() => {
      const child = spawn('node', [join(ROOT, 'src/server.js')], {
        detached: true,
        stdio: 'ignore',
        cwd: ROOT
      });
      child.unref();
      console.log('🛡️  ClawGuard restarted (pid:', child.pid, ')');
    }, 500);
    break;

  case 'status':
    if (isRunning()) {
      console.log('🟢 ClawGuard is running (pid:', getPid(), ')');
    } else {
      console.log('🔴 ClawGuard is not running');
    }
    break;

  case 'version':
  case '-v':
  case '--version':
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    console.log('ClawGuard v' + pkg.version);
    break;

  case 'update':
  case '--update': {
    const updatePkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    console.log(`Current version: v${updatePkg.version}`);
    console.log('Checking for updates...');
    try {
      const latest = execSync('npm view @jaydenbeard/clawguard version', { encoding: 'utf-8' }).trim();
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
  start, run    Start the dashboard (foreground)
  start -b      Start in background
  stop          Stop background process
  restart       Restart service
  status        Check if running
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
