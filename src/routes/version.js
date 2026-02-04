import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));

let updateCache = { latest: null, checkedAt: null };

async function checkForUpdate() {
  const ONE_HOUR = 60 * 60 * 1000;
  if (updateCache.checkedAt && Date.now() - updateCache.checkedAt < ONE_HOUR) {
    return updateCache;
  }
  try {
    const res = await fetch('https://registry.npmjs.org/@jaydenbeard/clawguard/latest');
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
    // Offline or registry error
  }
  return { current: pkg.version, ...updateCache };
}

const router = Router();

router.get('/', async (req, res) => {
  const info = await checkForUpdate();
  res.json(info);
});

export default router;
