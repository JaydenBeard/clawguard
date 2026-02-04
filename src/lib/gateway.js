/**
 * Gateway CLI detection and process management.
 *
 * Supports openclaw, moltbot, and clawdbot gateway binaries.
 */

import { execSync } from 'child_process';

const GATEWAY_NAMES = ['openclaw', 'moltbot', 'clawdbot'];

// grep pattern — matches name-gateway, name.*gateway, and node.*name launch patterns
const PS_GREP_PATTERN = GATEWAY_NAMES.map((n) => `${n}-gateway|${n}.*gateway|node.*${n}`).join('|');

/**
 * Find running gateway process PID via ps + grep (more reliable than pgrep on macOS).
 * Returns { pid: string|null, match: string|null }
 */
export function findGatewayProcess() {
  try {
    const out = execSync(
      `ps aux | grep -Ei "(${PS_GREP_PATTERN})" | grep -v grep | awk '{print $2}'`,
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    if (out) {
      return { pid: out.split('\n')[0], match: out };
    }
  } catch {
    // no match
  }
  return { pid: null, match: null };
}

/**
 * Kill all known gateway processes using a combined pattern.
 */
export function killGatewayProcesses() {
  const results = [];
  try {
    execSync(`pkill -f "${PS_GREP_PATTERN}" 2>/dev/null || true`, {
      encoding: 'utf-8',
    });
    results.push({ pattern: PS_GREP_PATTERN, success: true });
  } catch (e) {
    results.push({ pattern: PS_GREP_PATTERN, success: false, error: e.message });
  }
  return results;
}

/**
 * Detect which gateway CLI binary is available on this system.
 * Returns the first match from GATEWAY_NAMES, or null if none found.
 */
export function detectGatewayCli() {
  for (const name of GATEWAY_NAMES) {
    try {
      execSync(`which ${name} 2>/dev/null`, { encoding: 'utf-8' });
      return name;
    } catch {
      // not found, try next
    }
  }
  return null;
}

export { GATEWAY_NAMES };
