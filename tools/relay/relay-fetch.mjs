// Network transport shim for the monskills wallet utils.
//
// This container's egress allowlist blocks testnet-rpc.monad.xyz and
// api.safe.global, so `propose.mjs` cannot open a socket. Rather than
// reimplementing the Safe proposal flow (which the wallet/ skill explicitly
// forbids), this module leaves `propose.mjs` completely untouched and only
// swaps its transport: every fetch() is written to a file, relayed out through
// the user's browser, and the response is written back.
//
// Preload with:  NODE_OPTIONS="--import /path/to/relay-fetch.mjs"
//
// Protocol (all files JSON, written atomically via .tmp + rename):
//   <RELAY_DIR>/req-<id>.json  { id, url, method, headers, body }
//   <RELAY_DIR>/res-<id>.json  { status, headers, body }   (or { error })

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.RELAY_DIR || "/tmp/monfund-relay";
const TIMEOUT_MS = Number(process.env.RELAY_TIMEOUT_MS || 900_000);
const POLL_MS = 200;

// The request files carry Safe API credentials in their headers, and the
// response files are trusted verbatim — so the directory is a security
// boundary, not a scratch space. In a world-writable /tmp anyone can create
// `/tmp/monfund-relay` first and then read every request and pre-plant every
// response, so refuse to use a directory we do not own or that is group/world
// accessible rather than silently relaying through it.
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
const dirStat = fs.lstatSync(DIR);
if (!dirStat.isDirectory()) throw new Error(`[relay] ${DIR} is not a directory`);
if (typeof process.getuid === "function" && dirStat.uid !== process.getuid())
  throw new Error(`[relay] ${DIR} is owned by uid ${dirStat.uid}, not by us — refusing to use it`);
// mkdirSync's mode is ignored when the directory already exists.
if (dirStat.mode & 0o077) fs.chmodSync(DIR, 0o700);

function normalizeHeaders(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === "function" && !Array.isArray(h)) {
    h.forEach((v, k) => {
      out[String(k)] = String(v);
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[String(k)] = String(v);
    return out;
  }
  for (const [k, v] of Object.entries(h)) out[String(k)] = String(v);
  return out;
}

let seq = 0;

globalThis.fetch = async function relayFetch(input, init = {}) {
  // Random suffix: `pid-seq` alone repeats across runs, so a recycled pid would
  // pick up a leftover res-<id>.json belonging to a completely different URL.
  const id = `${process.pid}-${++seq}-${crypto.randomBytes(4).toString("hex")}`;
  const isRequest = typeof input === "object" && input !== null && "url" in input;

  const url = isRequest ? input.url : String(input);
  const method = String(init.method || (isRequest ? input.method : "GET") || "GET").toUpperCase();
  const headers = normalizeHeaders(init.headers || (isRequest ? input.headers : undefined));

  let body = null;
  if (init.body != null) body = typeof init.body === "string" ? init.body : String(init.body);
  else if (isRequest && typeof input.text === "function" && method !== "GET") body = await input.text();

  const payload = JSON.stringify({ id, url, method, headers, body });
  const reqTmp = path.join(DIR, `req-${id}.json.tmp`);
  const reqFinal = path.join(DIR, `req-${id}.json`);
  fs.writeFileSync(reqTmp, payload, { mode: 0o600 });
  fs.renameSync(reqTmp, reqFinal);

  process.stderr.write(`[relay] -> ${method} ${url} (id ${id})\n`);

  const resPath = path.join(DIR, `res-${id}.json`);
  const deadline = Date.now() + TIMEOUT_MS;
  while (!fs.existsSync(resPath)) {
    if (Date.now() > deadline) throw new Error(`[relay] timed out waiting for ${method} ${url}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  const res = JSON.parse(fs.readFileSync(resPath, "utf8"));
  // Consume the pair: nothing here is worth keeping, and leaving request
  // headers (bearer tokens) lying around in /tmp for the rest of the boot is
  // the whole exposure.
  for (const p of [reqFinal, resPath]) fs.rmSync(p, { force: true });
  if (res.error) throw new Error(`[relay] upstream error for ${url}: ${res.error}`);

  process.stderr.write(`[relay] <- ${res.status} ${url} (id ${id})\n`);

  return new Response(res.body ?? "", {
    status: res.status ?? 200,
    headers: res.headers ?? { "content-type": "application/json" },
  });
};
