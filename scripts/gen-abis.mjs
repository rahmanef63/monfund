#!/usr/bin/env node
// Regenerate web/src/lib/abis.ts from the Foundry build output.
//   cd contracts && forge build
//   cd ../web && npm run gen:abi

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "web/src/lib/abis.ts");

function abiOf(name) {
  const p = path.join(root, "contracts/out", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(p)) {
    console.error(`Missing ${p} — run \`forge build\` in contracts/ first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8")).abi;
}

const body =
  "// AUTO-GENERATED from contracts/out — do not edit by hand.\n" +
  "// Regenerate with:  npm run gen:abi   (after `forge build` in contracts/)\n\n" +
  `export const campaignFactoryAbi = ${JSON.stringify(abiOf("CampaignFactory"), null, 2)} as const;\n\n` +
  `export const campaignAbi = ${JSON.stringify(abiOf("Campaign"), null, 2)} as const;\n`;

fs.writeFileSync(out, body);
console.log(`wrote ${path.relative(root, out)}`);
