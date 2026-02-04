/**
 * ClawGuard Configuration Manager
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

// Config file locations (in order of priority)
const CONFIG_PATHS = [
  join(PROJECT_ROOT, 'config.json'),
  join(homedir(), '.clawguard', 'config.json'),
  join(homedir(), '.config', 'clawguard', 'config.json'),
];

const DEFAULT_CONFIG_PATH = join(PROJECT_ROOT, 'config.default.json');

/**
 * Deep merge two objects
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Auto-detect Clawdbot/OpenClaw sessions path
 */
function detectSessionsPath() {
  const possiblePaths = [
    join(homedir(), '.openclaw', 'agents', 'main', 'sessions'),
    join(homedir(), '.moltbot', 'agents', 'main', 'sessions'),
    join(homedir(), '.clawdbot', 'agents', 'main', 'sessions'),
    join(homedir(), '.openclaw', 'sessions'),
    join(homedir(), '.moltbot', 'sessions'),
    join(homedir(), '.clawdbot', 'sessions'),
  ];

  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }

  // Default fallback
  return possiblePaths[0];
}

/**
 * Load default config
 */
function loadDefaultConfig() {
  try {
    const content = readFileSync(DEFAULT_CONFIG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to load default config:', error.message);
    // Hardcoded fallback
    return {
      port: 3847,
      sessionsPath: 'auto',
      alerts: {
        enabled: false,
        webhookUrl: null,
        onRiskLevels: ['high', 'critical'],
        onSequences: true,
      },
      ui: {
        theme: 'dark',
        defaultTimelineRange: 24,
        activityLimit: 50,
      },
      detection: {
        sequenceWindowMinutes: 5,
        enableSequenceDetection: true,
      },
    };
  }
}

/**
 * Find and load user config
 */
function loadUserConfig() {
  for (const configPath of CONFIG_PATHS) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        console.log(`📋 Loaded config from: ${configPath}`);
        return { config: JSON.parse(content), path: configPath };
      } catch (error) {
        console.error(`Failed to parse config at ${configPath}:`, error.message);
      }
    }
  }
  return { config: null, path: null };
}

/**
 * Create default config file
 */
function createDefaultConfig(targetPath = CONFIG_PATHS[0]) {
  try {
    const defaultConfig = loadDefaultConfig();

    // Resolve auto sessions path
    defaultConfig.sessionsPath = detectSessionsPath();

    writeFileSync(targetPath, JSON.stringify(defaultConfig, null, 2));
    console.log(`📋 Created config file: ${targetPath}`);
    return defaultConfig;
  } catch (error) {
    console.error('Failed to create config file:', error.message);
    return loadDefaultConfig();
  }
}

/**
 * Load configuration (main entry point)
 */
export function loadConfig() {
  const defaultConfig = loadDefaultConfig();
  const { config: userConfig, path: configPath } = loadUserConfig();

  let config;
  if (userConfig) {
    // Merge user config with defaults
    config = deepMerge(defaultConfig, userConfig);
  } else {
    // No user config found, create one
    console.log('📋 No config file found, creating default...');
    config = createDefaultConfig();
  }

  // Resolve 'auto' sessions path
  if (config.sessionsPath === 'auto') {
    config.sessionsPath = detectSessionsPath();
  }

  // Expand ~ in paths
  if (config.sessionsPath.startsWith('~')) {
    config.sessionsPath = config.sessionsPath.replace('~', homedir());
  }

  return {
    ...config,
    _configPath: configPath || CONFIG_PATHS[0],
    _projectRoot: PROJECT_ROOT,
  };
}

/**
 * Save config to file
 */
export function saveConfig(config, targetPath = null) {
  const savePath = targetPath || config._configPath || CONFIG_PATHS[0];

  // Remove internal fields
  const { _configPath, _projectRoot, ...saveableConfig } = config;

  try {
    writeFileSync(savePath, JSON.stringify(saveableConfig, null, 2));
    console.log(`📋 Saved config to: ${savePath}`);
    return true;
  } catch (error) {
    console.error('Failed to save config:', error.message);
    return false;
  }
}

/**
 * Get config value by path (e.g., 'alerts.enabled')
 */
export function getConfigValue(config, path, defaultValue = null) {
  const parts = path.split('.');
  let value = config;

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return defaultValue;
    }
  }

  return value;
}
