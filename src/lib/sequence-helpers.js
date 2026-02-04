/**
 * Helper functions for suspicious sequence detection.
 */

export function isSensitivePath(path) {
  if (!path) return false;
  const patterns = [
    /\.env/i,
    /\.ssh/i,
    /\.aws/i,
    /\.gnupg/i,
    /password/i,
    /secret/i,
    /credential/i,
    /token/i,
    /keychain/i,
    /id_rsa/i,
    /\.pem$/i,
    /\.key$/i,
    /1password/i,
    /bitwarden/i,
    /lastpass/i,
  ];
  return patterns.some((p) => p.test(path));
}

export function isNetworkCommand(cmd) {
  if (!cmd) return false;
  return /\b(curl|wget|nc|netcat|ssh|scp|rsync)\b/i.test(cmd);
}

export function isSudoCommand(cmd) {
  if (!cmd) return false;
  return /\bsudo\b/i.test(cmd);
}

export function isDestructiveCommand(cmd) {
  if (!cmd) return false;
  return /\b(rm\s+-rf|chmod\s+777|dd\s+if=|mkfs)\b/i.test(cmd);
}

export function isConfigFile(path) {
  if (!path) return false;
  return /\.(env|json|ya?ml|toml|ini|conf|config)$/i.test(path) || /config/i.test(path);
}

export function containsSensitivePatterns(text) {
  if (!text) return false;
  const patterns = [
    /sk-[a-zA-Z0-9]{20,}/,
    /[a-zA-Z0-9]{40,}/,
    /password\s*[:=]\s*\S+/i,
    /api[_-]?key\s*[:=]\s*\S+/i,
    /token\s*[:=]\s*\S+/i,
    /secret\s*[:=]\s*\S+/i,
  ];
  return patterns.some((p) => p.test(text));
}

export function isSSHKeyPath(path) {
  if (!path) return false;
  return (
    /\.(ssh|gnupg)\/(id_|authorized_keys|known_hosts|config)/i.test(path) ||
    /id_(rsa|ed25519|ecdsa|dsa)/i.test(path)
  );
}

export function isDownloadCommand(cmd) {
  if (!cmd) return false;
  return /\b(curl\s+(-O|--output|-o)|wget|aria2c)\b/i.test(cmd);
}

export function isExecuteCommand(cmd) {
  if (!cmd) return false;
  return /\b(bash|sh|zsh|chmod\s+\+x|\.\/|python|node|ruby|perl)\s/i.test(cmd);
}

export function isPasswordManagerCommand(cmd) {
  if (!cmd) return false;
  return /\b(op\s+(read|get|item)|bw\s+(get|list)|security\s+find-(generic|internet)-password|pass\s+show)\b/i.test(
    cmd,
  );
}

export function isPersistencePath(path) {
  if (!path) return false;
  return /LaunchAgents|LaunchDaemons|cron\.d|systemd|autostart|init\.d/i.test(path);
}

export function getSummary(item) {
  const args = item.arguments || {};
  switch (item.tool) {
    case 'exec':
      return args.command?.substring(0, 60) || '(command)';
    case 'web_fetch':
      return args.url || '(url)';
    case 'message':
      return `${args.action || '(action)'} to ${args.target || args.channel || '(target)'}`;
    case 'web_search':
      return args.query?.substring(0, 60) || '(query)';
    default:
      return JSON.stringify(args).substring(0, 60);
  }
}
