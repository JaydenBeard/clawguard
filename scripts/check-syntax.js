#!/usr/bin/env node

/**
 * Syntax check all source files. Used by `npm run check`.
 */

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { join } from 'path';

const files = [
  'src/server.js',
  'bin/clawguard.js',
  ...readdirSync('src/lib').map((f) => join('src/lib', f)),
  ...readdirSync('src/routes').map((f) => join('src/routes', f)),
];

let failed = false;
for (const file of files) {
  if (!file.endsWith('.js')) continue;
  try {
    execSync(`node --check ${file}`, { stdio: 'pipe' });
    console.log(`  ✅ ${file}`);
  } catch (e) {
    console.error(`  ❌ ${file}`);
    console.error(e.stderr?.toString() || e.message);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(`\n✅ All ${files.filter((f) => f.endsWith('.js')).length} files passed syntax check`);
