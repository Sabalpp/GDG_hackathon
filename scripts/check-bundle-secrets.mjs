#!/usr/bin/env node
// Fails if a built web bundle contains anything that looks like a server secret.
// Run after `npm run build` in apps/web:  node scripts/check-bundle-secrets.mjs [dir]

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2] ?? 'apps/web/dist';
const patterns = [
  { name: 'Google API key', regex: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'GEMINI_API_KEY reference', regex: /GEMINI_API_KEY/ },
  { name: 'private key block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'service account JSON', regex: /"type":\s*"service_account"/ },
];

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

try {
  await stat(root);
} catch {
  console.log(`No bundle at ${root}; build apps/web first.`);
  process.exit(0);
}

let leaks = 0;
for await (const file of files(root)) {
  const text = await readFile(file, 'utf8').catch(() => '');
  for (const { name, regex } of patterns) {
    if (regex.test(text)) {
      leaks += 1;
      console.error(`LEAK  ${name} in ${file}`);
    }
  }
}
console.log(leaks ? `${leaks} possible secret(s) in the browser bundle` : `No secrets found in ${root}`);
process.exitCode = leaks ? 1 : 0;
