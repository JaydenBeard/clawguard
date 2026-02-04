/**
 * Input validation helpers.
 */

/**
 * Validate that a URL is safe for outbound requests (SSRF protection).
 * Only allows http/https, rejects private IPs and localhost.
 */
export function isAllowedEndpoint(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;

  try {
    const url = new URL(urlString);

    // Must be http or https
    if (!['http:', 'https:'].includes(url.protocol)) return false;

    // Block localhost and common private addresses
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.') ||
      hostname.endsWith('.local') ||
      hostname === '[::1]'
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a user-provided endpoint against the configured default.
 * Returns the endpoint to use, or null if invalid.
 */
export function resolveEndpoint(userEndpoint, configuredEndpoint) {
  // If no user override, use configured
  if (!userEndpoint) return configuredEndpoint || null;

  // Validate user-provided endpoint
  if (!isAllowedEndpoint(userEndpoint)) return null;

  return userEndpoint;
}
