#!/usr/bin/env node
/**
 * Build the request body for the monskills verification API
 * (https://agents.devnads.com/v1/verify), fully offline.
 *
 * `forge verify-contract --show-standard-json-input` needs to reach
 * binaries.soliditylang.org, which this container cannot, so the standard JSON
 * input is assembled from `out/build-info/*.json` instead — that file records
 * the exact input forge handed to solc — narrowed to the contract's own
 * dependency tree via the artifact metadata.
 *
 *   node scripts/make-verify-payload.mjs CampaignFactory 0xADDRESS [outfile] [constructorArgsHexNo0x]
 *
 * Requires `forge build --build-info` (a plain `forge build` writes a slim
 * build-info with no `input`, which no contract can be matched against).
 *
 * Before writing anything the local artifact's runtime bytecode is compared
 * against `eth_getCode` at the target address, because `contracts/out` is
 * gitignored and can trivially be a different build than what is deployed —
 * publishing those sources would be a false verification. Set
 * VERIFY_SKIP_ONCHAIN_CHECK=1 only when the RPC is genuinely unreachable and
 * you have confirmed the match some other way.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractsDir = path.join(root, "contracts");

const [, , name, address, outfile, ctorArgs] = process.argv;
if (!name || !address) {
  console.error("usage: make-verify-payload.mjs <ContractName> <0xaddress> [outfile]");
  process.exit(1);
}

const artifactPath = path.join(contractsDir, "out", `${name}.sol`, `${name}.json`);
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const metadata = artifact.metadata;

const biDir = path.join(contractsDir, "out", "build-info");
const biFiles = fs.readdirSync(biDir).filter((f) => f.endsWith(".json"));

let buildInfo = null;
for (const f of biFiles) {
  const candidate = JSON.parse(fs.readFileSync(path.join(biDir, f), "utf8"));
  // `input` is absent on slim build-info files, so optional-chain through it —
  // otherwise this throws and the helpful message below is unreachable.
  if (Object.keys(metadata.sources).every((s) => candidate.input?.sources?.[s])) {
    buildInfo = candidate;
    break;
  }
}
if (!buildInfo) {
  console.error("No build-info covers this contract's sources — run `forge build --build-info`.");
  process.exit(1);
}

// Keep only the sources this contract actually depends on.
const sources = {};
for (const src of Object.keys(metadata.sources)) {
  sources[src] = { content: buildInfo.input.sources[src].content };
}

const standardJsonInput = {
  language: buildInfo.input.language,
  sources,
  settings: buildInfo.input.settings,
};

const solcLong = buildInfo.solcLongVersion ?? buildInfo.solcVersion;
const compilerVersion = `v${solcLong.includes("+") ? solcLong : `${solcLong}+commit.7893614a`}`;

const payload = {
  chainId: 10143,
  contractAddress: address,
  contractName: `src/${name}.sol:${name}`,
  compilerVersion,
  standardJsonInput,
  foundryMetadata: metadata,
};

// ABI-encoded constructor args, WITHOUT the 0x prefix.
if (ctorArgs) payload.constructorArgs = ctorArgs.replace(/^0x/, "");

// Refuse to publish sources that don't correspond to the code actually at the
// address. `out/` is gitignored, so "it built here" proves nothing on its own.
if (process.env.VERIFY_SKIP_ONCHAIN_CHECK !== "1") {
  const rpc = process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz";
  let onchain;
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    onchain = String(json.result || "").toLowerCase();
  } catch (err) {
    console.error(
      `eth_getCode against ${rpc} failed: ${err.message}\n` +
        "Set VERIFY_SKIP_ONCHAIN_CHECK=1 to bypass, but only if you have verified the match another way.",
    );
    process.exit(1);
  }

  const local = String(artifact.deployedBytecode?.object ?? "").toLowerCase();
  if (onchain === "0x" || onchain === "") {
    console.error(`No code at ${address} on chain 10143 — wrong address or wrong network.`);
    process.exit(1);
  }
  if (local !== onchain) {
    console.error(
      `Local build does not match the deployed runtime at ${address}.\n` +
        `  local:   ${local.length - 2} hex chars, ${local.slice(0, 20)}…\n` +
        `  onchain: ${onchain.length - 2} hex chars, ${onchain.slice(0, 20)}…\n` +
        "Rebuild from the exact pinned deps (`make -C contracts install && forge build --build-info`) before verifying.",
    );
    process.exit(1);
  }
  console.log(`deployedBytecode matches eth_getCode at ${address}`);
}

// A fixed /tmp/verify-<name>.json is guessable, so on a shared box anyone can
// pre-plant a symlink there and have this write clobber whatever it points at.
// mkdtemp hands back a fresh 0700 directory instead; the path is printed below.
const target = outfile ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "monfund-verify-")), `${name}.json`);
fs.writeFileSync(target, JSON.stringify(payload), { mode: 0o600 });
console.log(
  `wrote ${target}  (${fs.statSync(target).size} bytes, ${Object.keys(sources).length} sources, ${compilerVersion})`,
);
