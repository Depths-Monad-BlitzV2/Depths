// Salin ABI hasil `forge build` ke apps/web/abi dan apps/keeper/abi (CLAUDE.md aturan 7).
// Menulis <Name>.json (ABI mentah) dan <Name>.ts (`as const` untuk typing viem). Jangan edit hasilnya manual.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS = ['Depths'];
const TARGETS = ['apps/web/abi', 'apps/keeper/abi'];

const missing = CONTRACTS.filter((name) => !existsSync(join(root, 'contracts/out', `${name}.sol`, `${name}.json`)));
if (missing.length > 0) {
  console.error(`abi:sync: artifact tidak ada untuk ${missing.join(', ')}. Jalankan \`forge build\` di contracts/ dulu.`);
  process.exit(1);
}

for (const name of CONTRACTS) {
  const { abi } = JSON.parse(readFileSync(join(root, 'contracts/out', `${name}.sol`, `${name}.json`), 'utf8'));
  const json = `${JSON.stringify(abi, null, 2)}\n`;
  const ts = `// Di-generate oleh \`pnpm abi:sync\`. Jangan edit manual.\nexport const ${name.toLowerCase()}Abi = ${JSON.stringify(abi, null, 2)} as const;\n`;
  for (const target of TARGETS) {
    const dir = join(root, target);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.json`), json);
    writeFileSync(join(dir, `${name}.ts`), ts);
    console.log(`abi:sync: ${target}/${name}.{json,ts}`);
  }
}
