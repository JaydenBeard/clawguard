/**
 * ClawGuard Risk Analyzer
 * Comprehensive security analysis for OpenClaw activity
 */

/**
 * Risk levels
 */
export const RiskLevel = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

/**
 * Tool categories
 */
export const ToolCategory = {
  SHELL: 'shell',
  FILE: 'file',
  NETWORK: 'network',
  MESSAGE: 'message',
  SYSTEM: 'system',
  MEMORY: 'memory',
  BROWSER: 'browser',
  OTHER: 'other',
};

/**
 * Categorize a tool by name
 */
export function categorize(toolName) {
  const categories = {
    // Shell commands
    exec: ToolCategory.SHELL,
    process: ToolCategory.SHELL,

    // File operations
    read: ToolCategory.FILE,
    write: ToolCategory.FILE,
    edit: ToolCategory.FILE,
    Read: ToolCategory.FILE,
    Write: ToolCategory.FILE,
    Edit: ToolCategory.FILE,

    // Network
    web_fetch: ToolCategory.NETWORK,
    web_search: ToolCategory.NETWORK,

    // Browser
    browser: ToolCategory.BROWSER,

    // Messaging
    message: ToolCategory.MESSAGE,
    tts: ToolCategory.MESSAGE,

    // System
    cron: ToolCategory.SYSTEM,
    gateway: ToolCategory.SYSTEM,
    sessions_spawn: ToolCategory.SYSTEM,
    sessions_send: ToolCategory.SYSTEM,
    sessions_list: ToolCategory.SYSTEM,
    sessions_history: ToolCategory.SYSTEM,
    session_status: ToolCategory.SYSTEM,
    agents_list: ToolCategory.SYSTEM,
    nodes: ToolCategory.SYSTEM,
    canvas: ToolCategory.SYSTEM,

    // Memory
    memory_search: ToolCategory.MEMORY,
    memory_get: ToolCategory.MEMORY,
  };

  return categories[toolName] || ToolCategory.OTHER;
}

/**
 * CRITICAL-risk patterns - immediate security concern
 */
const CRITICAL_SHELL_PATTERNS = [
  { pattern: /\bsudo\s+/i, desc: 'Privileged command execution' },
  {
    pattern: /\brm\s+(-rf?|--recursive)\s+[/~]/i,
    desc: 'Recursive deletion of system/home paths',
  },
  { pattern: /\bcurl\s+.*\|\s*(ba)?sh/i, desc: 'Remote code execution via pipe to shell' },
  { pattern: /\bwget\s+.*\|\s*(ba)?sh/i, desc: 'Remote code execution via pipe to shell' },
  {
    pattern: /\bsecurity\s+find-(generic|internet)-password/i,
    desc: 'Keychain password extraction',
  },
  { pattern: /\bsecurity\s+dump-keychain/i, desc: 'Full keychain dump' },
  { pattern: /\bop\s+(read|get|item)/i, desc: '1Password credential access' },
  { pattern: /\bbw\s+(get|list)\s+(password|item)/i, desc: 'Bitwarden credential access' },
  { pattern: /\bdd\s+if=.*of=\/dev\//i, desc: 'Direct disk write (potential disk wipe)' },
  { pattern: /\bmkfs\b/i, desc: 'Filesystem creation (destructive)' },
  { pattern: />\s*\/dev\/sd[a-z]/i, desc: 'Direct write to disk device' },
];

/**
 * HIGH-risk patterns - significant security concern
 */
const HIGH_RISK_SHELL_PATTERNS = [
  // Destructive commands
  { pattern: /\brm\s+-rf?\b/i, desc: 'Recursive file deletion' },
  { pattern: /\bchmod\s+777\b/i, desc: 'World-writable permissions' },
  { pattern: /\beval\b/i, desc: 'Dynamic code evaluation' },
  { pattern: /\bkillall\b/i, desc: 'Mass process termination' },

  // Email & external communication
  { pattern: /\bgog\s+gmail\s+send\b/i, desc: 'Sending email via Gmail' },
  { pattern: /\bhimalaya\s+(send|write|reply|forward)\b/i, desc: 'Sending email via Himalaya' },
  { pattern: /\bwacli\s+send\b/i, desc: 'Sending WhatsApp message' },
  { pattern: /\bimsg\s+send\b/i, desc: 'Sending iMessage/SMS' },
  { pattern: /\bbird\s+(post|tweet|reply)\b/i, desc: 'Posting to Twitter/X' },

  // Cloud CLIs - can do serious damage
  { pattern: /\baws\s+(s3|ec2|iam|lambda|rds)\b/i, desc: 'AWS cloud operations' },
  { pattern: /\bgcloud\s+/i, desc: 'Google Cloud operations' },
  { pattern: /\baz\s+(vm|storage|keyvault|ad)\b/i, desc: 'Azure cloud operations' },
  { pattern: /\bterraform\s+(apply|destroy)\b/i, desc: 'Infrastructure modification' },
  { pattern: /\bkubectl\s+(delete|apply|exec)\b/i, desc: 'Kubernetes cluster operations' },

  // Git with potential secret exposure
  { pattern: /\bgit\s+push\s+.*--force\b/i, desc: 'Force push (can overwrite history)' },
  { pattern: /\bgit\s+push\s+origin\s+(main|master)\b/i, desc: 'Pushing to main branch' },

  // Camera, microphone, screen recording
  { pattern: /\bimagesnap\b/i, desc: 'Camera capture' },
  { pattern: /\bffmpeg\s+.*-f\s+avfoundation/i, desc: 'Audio/video recording' },
  { pattern: /\bscreencapture\b/i, desc: 'Screen capture' },
  { pattern: /\bafrecord\b/i, desc: 'Audio recording' },

  // System control
  { pattern: /\breboot\b/i, desc: 'System reboot' },
  { pattern: /\bshutdown\b/i, desc: 'System shutdown' },
  { pattern: /\bsystemctl\s+(stop|disable|mask)\b/i, desc: 'Disabling system services' },
  { pattern: /\blaunchctl\s+(unload|remove)\b/i, desc: 'Removing launch agents' },

  // Persistence mechanisms
  { pattern: /\blaunchctl\s+load\b/i, desc: 'Loading launch agent (persistence)' },
  { pattern: /\bcrontab\s+-e?\b/i, desc: 'Modifying cron jobs (persistence)' },
  { pattern: />\s*~\/Library\/LaunchAgents\//i, desc: 'Creating launch agent (persistence)' },

  // Credential/secret patterns in commands
  {
    pattern: /\bexport\s+\w*(_API_KEY|_SECRET|_TOKEN|_PASSWORD)=/i,
    desc: 'Exporting credentials to environment',
  },
  {
    pattern: /\becho\s+.*\b(password|secret|token|api.?key)\b.*>/i,
    desc: 'Writing credentials to file',
  },

  // Network listeners
  { pattern: /\bnc\s+-l/i, desc: 'Opening network listener' },
  { pattern: /\bnetcat\s+-l/i, desc: 'Opening network listener' },
  { pattern: /\bsocat\b.*LISTEN/i, desc: 'Opening network listener' },

  // Docker with elevated access
  { pattern: /\bdocker\s+run\s+.*--privileged/i, desc: 'Privileged Docker container' },
  { pattern: /\bdocker\s+run\s+.*-v\s+\/:/i, desc: 'Docker mounting host root' },
  { pattern: /\bdocker\s+exec\s+.*\/bin\/(ba)?sh/i, desc: 'Docker container shell access' },
];

/**
 * MEDIUM-risk patterns - notable but not immediately dangerous
 */
const MEDIUM_RISK_SHELL_PATTERNS = [
  // Network tools
  { pattern: /\bcurl\s+(-O|--output)\b/i, desc: 'Downloading file' },
  { pattern: /\bwget\b/i, desc: 'Downloading file' },
  { pattern: /\bssh\s+\w+@/i, desc: 'SSH connection' },
  { pattern: /\bscp\b/i, desc: 'Secure copy' },
  { pattern: /\brsync\b/i, desc: 'Remote sync' },

  // File permission changes
  { pattern: /\bchmod\b/i, desc: 'Changing file permissions' },
  { pattern: /\bchown\b/i, desc: 'Changing file ownership' },

  // Package installation
  { pattern: /\bpip\s+install\b/i, desc: 'Python package installation' },
  { pattern: /\bnpm\s+install\s+-g\b/i, desc: 'Global npm package installation' },
  { pattern: /\bbrew\s+install\b/i, desc: 'Homebrew package installation' },

  // Git operations
  { pattern: /\bgit\s+push\b/i, desc: 'Git push' },
  { pattern: /\bgit\s+clone\b/i, desc: 'Git clone' },

  // Clipboard access
  { pattern: /\bpbpaste\b/i, desc: 'Reading clipboard' },
  { pattern: /\bpbcopy\b/i, desc: 'Writing to clipboard' },

  // Process manipulation
  { pattern: /\bkill\s+-9\b/i, desc: 'Force killing process' },
  { pattern: /\bpkill\b/i, desc: 'Pattern-based process kill' },

  // Docker
  { pattern: /\bdocker\s+(run|build|pull)\b/i, desc: 'Docker operations' },

  // Database access
  { pattern: /\bsqlite3\b/i, desc: 'SQLite database access' },
  { pattern: /\bpsql\b/i, desc: 'PostgreSQL access' },
  { pattern: /\bmysql\b/i, desc: 'MySQL access' },

  // Encryption/encoding tools
  { pattern: /\bopenssl\b/i, desc: 'OpenSSL operations' },
  { pattern: /\bbase64\b/i, desc: 'Base64 encoding/decoding' },
  { pattern: /\bgpg\b/i, desc: 'GPG operations' },
];

/**
 * Sensitive file paths - accessing these is HIGH risk
 */
const SENSITIVE_PATHS = [
  // SSH & crypto
  { pattern: /\.ssh\//i, desc: 'SSH keys/config' },
  { pattern: /\.gnupg\//i, desc: 'GPG keys' },
  { pattern: /id_rsa/i, desc: 'RSA private key' },
  { pattern: /id_ed25519/i, desc: 'ED25519 private key' },
  { pattern: /\.pem$/i, desc: 'PEM certificate/key' },
  { pattern: /\.key$/i, desc: 'Private key file' },
  { pattern: /\.p12$/i, desc: 'PKCS12 keystore' },
  { pattern: /\.pfx$/i, desc: 'PFX certificate' },

  // Cloud credentials
  { pattern: /\.aws\//i, desc: 'AWS credentials' },
  { pattern: /\.azure\//i, desc: 'Azure credentials' },
  { pattern: /\.kube\//i, desc: 'Kubernetes config' },
  { pattern: /\.docker\/config\.json/i, desc: 'Docker credentials' },
  { pattern: /gcloud\/credentials/i, desc: 'Google Cloud credentials' },

  // Password managers
  { pattern: /1password/i, desc: '1Password data' },
  { pattern: /lastpass/i, desc: 'LastPass data' },
  { pattern: /bitwarden/i, desc: 'Bitwarden data' },
  { pattern: /\.password-store\//i, desc: 'pass password store' },

  // Keychains
  { pattern: /keychain/i, desc: 'Keychain file' },
  { pattern: /\.keychain-db/i, desc: 'Keychain database' },

  // Environment & config with secrets
  { pattern: /\.env$/i, desc: 'Environment file' },
  { pattern: /\.env\.[a-z]+$/i, desc: 'Environment file' },
  { pattern: /\.netrc$/i, desc: 'Netrc credentials' },
  { pattern: /\.npmrc$/i, desc: 'NPM config (may contain tokens)' },
  { pattern: /\.pypirc$/i, desc: 'PyPI credentials' },

  // Generic sensitive patterns
  { pattern: /password/i, desc: 'Password-related file' },
  { pattern: /secret/i, desc: 'Secret-related file' },
  { pattern: /credential/i, desc: 'Credential file' },
  { pattern: /token/i, desc: 'Token file' },
  { pattern: /api[_-]?key/i, desc: 'API key file' },

  // System files
  { pattern: /\/etc\/passwd/i, desc: 'System passwd file' },
  { pattern: /\/etc\/shadow/i, desc: 'System shadow file' },
  { pattern: /\/etc\/sudoers/i, desc: 'Sudoers file' },
];

/**
 * System paths that shouldn't be written to
 */
const SYSTEM_PATHS = [
  { pattern: /^\/etc\//, desc: 'System configuration' },
  { pattern: /^\/usr\//, desc: 'System binaries' },
  { pattern: /^\/bin\//, desc: 'Essential binaries' },
  { pattern: /^\/sbin\//, desc: 'System binaries' },
  { pattern: /^\/var\//, desc: 'Variable data' },
  { pattern: /^\/System\//, desc: 'macOS System' },
  { pattern: /^\/Library\//, desc: 'macOS Library' },
  { pattern: /^\/Applications\//, desc: 'Applications folder' },
];

/**
 * Sensitive browser URLs - HIGH risk
 */
const SENSITIVE_URLS = [
  { pattern: /banking|bank\./i, desc: 'Banking website' },
  { pattern: /paypal\.com/i, desc: 'PayPal' },
  { pattern: /stripe\.com/i, desc: 'Stripe' },
  { pattern: /accounts\.google\.com/i, desc: 'Google Account' },
  { pattern: /login\.|signin\.|auth\./i, desc: 'Authentication page' },
  { pattern: /oauth/i, desc: 'OAuth flow' },
  { pattern: /portal\.azure\.com/i, desc: 'Azure Portal' },
  { pattern: /console\.aws\.amazon\.com/i, desc: 'AWS Console' },
  { pattern: /github\.com\/settings/i, desc: 'GitHub Settings' },
  { pattern: /icloud\.com/i, desc: 'iCloud' },
];

/**
 * Analyze risk level for an activity
 */
export function analyzeRisk(activity) {
  const { tool, arguments: args } = activity;
  const category = categorize(tool);

  let riskLevel = RiskLevel.LOW;
  const flags = [];

  // Analyze based on tool type
  switch (category) {
    case ToolCategory.SHELL: {
      const command = args?.command || '';

      // Check CRITICAL patterns first
      for (const { pattern, desc } of CRITICAL_SHELL_PATTERNS) {
        if (pattern.test(command)) {
          riskLevel = RiskLevel.CRITICAL;
          flags.push(`CRITICAL: ${desc}`);
        }
      }

      // Check HIGH-risk patterns
      if (riskLevel !== RiskLevel.CRITICAL) {
        for (const { pattern, desc } of HIGH_RISK_SHELL_PATTERNS) {
          if (pattern.test(command)) {
            riskLevel = RiskLevel.HIGH;
            flags.push(`HIGH: ${desc}`);
          }
        }
      }

      // Check MEDIUM-risk patterns if not already high
      if (riskLevel === RiskLevel.LOW) {
        for (const { pattern, desc } of MEDIUM_RISK_SHELL_PATTERNS) {
          if (pattern.test(command)) {
            riskLevel = RiskLevel.MEDIUM;
            flags.push(`${desc}`);
          }
        }
      }
      break;
    }

    case ToolCategory.FILE: {
      const path = args?.path || args?.file_path || '';
      const content = args?.content || '';

      // Check for sensitive paths
      for (const { pattern, desc } of SENSITIVE_PATHS) {
        if (pattern.test(path)) {
          riskLevel = RiskLevel.HIGH;
          flags.push(`HIGH: Sensitive file: ${desc}`);
        }
      }

      // Check for system path writes
      if (tool === 'write' || tool === 'Write' || tool === 'edit' || tool === 'Edit') {
        for (const { pattern, desc } of SYSTEM_PATHS) {
          if (pattern.test(path)) {
            riskLevel = RiskLevel.HIGH;
            flags.push(`HIGH: System path modification: ${desc}`);
          }
        }

        // Check for secrets being written
        if (/(_API_KEY|_SECRET|_TOKEN|_PASSWORD)\s*[=:]/i.test(content)) {
          riskLevel = RiskLevel.HIGH;
          flags.push(`HIGH: Writing credentials to file`);
        }

        // Large writes are medium risk
        if (content.length > 10000 && riskLevel === RiskLevel.LOW) {
          riskLevel = RiskLevel.MEDIUM;
          flags.push(`Large file write: ${content.length} bytes`);
        }
      }

      // Files outside home directory are medium risk
      if (
        riskLevel === RiskLevel.LOW &&
        path &&
        !path.includes(process.env.HOME) &&
        !path.startsWith('.')
      ) {
        riskLevel = RiskLevel.MEDIUM;
        flags.push('File outside home directory');
      }
      break;
    }

    case ToolCategory.NETWORK: {
      const url = args?.url || '';

      // Check for sensitive URLs
      for (const { pattern, desc } of SENSITIVE_URLS) {
        if (pattern.test(url)) {
          riskLevel = RiskLevel.HIGH;
          flags.push(`HIGH: Sensitive site: ${desc}`);
        }
      }

      // Non-HTTPS is medium risk
      if (url.startsWith('http://') && riskLevel === RiskLevel.LOW) {
        riskLevel = RiskLevel.MEDIUM;
        flags.push('Non-HTTPS URL');
      }

      // IP addresses are high risk
      if (/https?:\/\/\d+\.\d+\.\d+\.\d+/.test(url)) {
        riskLevel = RiskLevel.HIGH;
        flags.push('HIGH: Direct IP address access');
      }
      break;
    }

    case ToolCategory.BROWSER: {
      const targetUrl = args?.url || args?.targetUrl || '';

      // Check for sensitive URLs in browser
      for (const { pattern, desc } of SENSITIVE_URLS) {
        if (pattern.test(targetUrl)) {
          riskLevel = RiskLevel.HIGH;
          flags.push(`HIGH: Browser accessing: ${desc}`);
        }
      }

      // Browser automation is medium risk by default
      if (riskLevel === RiskLevel.LOW) {
        riskLevel = RiskLevel.MEDIUM;
        flags.push('Browser automation');
      }
      break;
    }

    case ToolCategory.MESSAGE: {
      const target = args?.target || args?.to || '';
      const action = args?.action || '';

      // External messaging is HIGH risk
      if (action === 'send' && target) {
        riskLevel = RiskLevel.HIGH;
        flags.push(`HIGH: Outbound message to: ${target}`);
      }

      // Broadcast is HIGH risk
      if (action === 'broadcast') {
        riskLevel = RiskLevel.HIGH;
        flags.push('HIGH: Broadcast message');
      }

      // Other message actions are medium
      if (riskLevel === RiskLevel.LOW && action) {
        riskLevel = RiskLevel.MEDIUM;
        flags.push(`Message action: ${action}`);
      }
      break;
    }

    case ToolCategory.SYSTEM:
      if (tool === 'gateway') {
        const action = args?.action || '';
        if (action === 'config.apply' || action === 'restart' || action === 'update.run') {
          riskLevel = RiskLevel.HIGH;
          flags.push(`HIGH: Gateway modification: ${action}`);
        } else {
          riskLevel = RiskLevel.MEDIUM;
          flags.push(`Gateway: ${action}`);
        }
      }

      if (tool === 'cron') {
        const action = args?.action || '';
        if (action === 'add' || action === 'update') {
          riskLevel = RiskLevel.HIGH;
          flags.push(`HIGH: Scheduled task modification`);
        } else {
          riskLevel = RiskLevel.MEDIUM;
          flags.push(`Cron: ${action}`);
        }
      }

      if (tool === 'sessions_spawn') {
        riskLevel = RiskLevel.MEDIUM;
        flags.push('Spawning sub-agent');
      }

      if (tool === 'nodes') {
        const action = args?.action || '';
        if (action === 'camera_snap' || action === 'camera_clip' || action === 'screen_record') {
          riskLevel = RiskLevel.HIGH;
          flags.push(`HIGH: Node capture: ${action}`);
        }
      }
      break;
  }

  return {
    level: riskLevel,
    category,
    flags,
    score: riskScore(riskLevel),
  };
}

/**
 * Convert risk level to numeric score (for sorting)
 */
function riskScore(level) {
  const scores = {
    [RiskLevel.LOW]: 1,
    [RiskLevel.MEDIUM]: 2,
    [RiskLevel.HIGH]: 3,
    [RiskLevel.CRITICAL]: 4,
  };
  return scores[level] || 0;
}

/**
 * Get icon for tool category
 */
export function getCategoryIcon(category) {
  const icons = {
    [ToolCategory.SHELL]: '⚡',
    [ToolCategory.FILE]: '📄',
    [ToolCategory.NETWORK]: '🌐',
    [ToolCategory.BROWSER]: '🖥️',
    [ToolCategory.MESSAGE]: '✉️',
    [ToolCategory.SYSTEM]: '⚙️',
    [ToolCategory.MEMORY]: '🧠',
    [ToolCategory.OTHER]: '❓',
  };
  return icons[category] || '❓';
}

/**
 * Get color for risk level
 */
export function getRiskColor(level) {
  const colors = {
    [RiskLevel.LOW]: '#22c55e', // Green
    [RiskLevel.MEDIUM]: '#f59e0b', // Amber
    [RiskLevel.HIGH]: '#ef4444', // Red
    [RiskLevel.CRITICAL]: '#dc2626', // Dark red
  };
  return colors[level] || '#94a3b8';
}

/**
 * Get risk level display name
 */
export function getRiskLabel(level) {
  const labels = {
    [RiskLevel.LOW]: 'Low',
    [RiskLevel.MEDIUM]: 'Medium',
    [RiskLevel.HIGH]: 'High',
    [RiskLevel.CRITICAL]: '🚨 CRITICAL',
  };
  return labels[level] || 'Unknown';
}
