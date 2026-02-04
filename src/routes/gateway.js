import { Router } from 'express';
import { execSync } from 'child_process';
import {
  findGatewayProcess,
  killGatewayProcesses,
  detectGatewayCli,
  GATEWAY_NAMES,
} from '../lib/gateway.js';
import { clients } from '../lib/state.js';

const router = Router();

router.get('/status', (req, res) => {
  try {
    const { pid } = findGatewayProcess();
    const isRunning = !!pid;
    const cli = detectGatewayCli();
    let cliStatus = null;
    if (cli) {
      try {
        cliStatus = execSync(cli + ' gateway status 2>&1 || true', {
          encoding: 'utf-8',
          timeout: 5000,
        });
      } catch (e) {
        cliStatus = 'CLI check failed';
      }
    } else {
      cliStatus = 'No gateway CLI found';
    }
    res.json({
      isRunning,
      pid,
      cli: cli || 'none',
      cliStatus: cliStatus?.trim(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/kill', async (req, res) => {
  try {
    console.log('\u26a0\ufe0f  KILL SWITCH ACTIVATED');
    const results = { timestamp: new Date().toISOString(), actions: [] };
    const cli = detectGatewayCli();
    if (cli) {
      try {
        execSync(cli + ' gateway stop 2>&1', { encoding: 'utf-8', timeout: 10000 });
        results.actions.push({ method: cli + ' CLI', success: true });
      } catch (e) {
        results.actions.push({ method: cli + ' CLI', success: false, error: e.message });
      }
    }
    const killResults = killGatewayProcesses();
    results.actions.push(...killResults);
    await new Promise((r) => setTimeout(r, 1000));
    const { pid: checkPid } = findGatewayProcess();
    results.verified = !checkPid;
    results.message = 'Kill switch executed - OpenClaw gateway termination attempted';
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

router.post('/restart', (req, res) => {
  try {
    console.log('\ud83d\udd04 Gateway restart requested');
    const cli = detectGatewayCli();
    let result;
    if (cli) {
      try {
        result = execSync(cli + ' gateway start 2>&1', { encoding: 'utf-8', timeout: 15000 });
      } catch (e) {
        result = e.message;
      }
    } else {
      result = 'No gateway CLI found (tried: ' + GATEWAY_NAMES.join(', ') + ')';
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

export default router;
