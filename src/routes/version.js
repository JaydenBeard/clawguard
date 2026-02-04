/**
 * Version and update check route.
 */

import { Router } from 'express';
import { pkg } from '../lib/pkg.js';

let updateCache = { latest: null, checkedAt: null };

async function checkForUpdate() {
  const ONE_HOUR = 60 * 60 * 1000;
  if (updateCache.checkedAt && Date.now() - updateCache.checkedAt < ONE_HOUR) {
    return updateCache;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://registry.npmjs.org/@jaydenbeard/clawguard/latest', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      updateCache = {
        current: pkg.version,
        latest: data.version,
        hasUpdate: data.version !== pkg.version,
        checkedAt: Date.now(),
      };
    }
  } catch {
    // Offline or registry error — keep stale cache
  }
  return { current: pkg.version, ...updateCache };
}

const router = Router();

router.get('/', async (req, res) => {
  const info = await checkForUpdate();
  res.json(info);
});

export default router;
