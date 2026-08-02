#!/usr/bin/env node
// Operator side of the browser relay.
//
//   node relay-cli.mjs pending          -> print any queued outbound requests as JSON
//   node relay-cli.mjs respond <id> <fileWithJsonResponse>
//   node relay-cli.mjs clear
//
// The agent reads `pending`, performs the request from the user's browser, and
// feeds the result back with `respond`.

import fs from "node:fs";
import path from "node:path";

const DIR = process.env.RELAY_DIR || "/tmp/monfund-relay";
// 0700 to match relay-fetch.mjs — the queued requests carry Safe API bearer
// tokens, so neither end may leave this directory readable by other users.
// mkdirSync's mode only applies when it actually creates the directory, so the
// same ownership/permission guard relay-fetch.mjs uses has to be repeated here;
// otherwise the operator side still reads and writes through a directory an
// attacker pre-created in a world-writable /tmp.
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
const dirStat = fs.lstatSync(DIR);
if (!dirStat.isDirectory()) throw new Error(`[relay] ${DIR} is not a directory`);
if (typeof process.getuid === "function" && dirStat.uid !== process.getuid())
  throw new Error(`[relay] ${DIR} is owned by uid ${dirStat.uid}, not by us — refusing to use it`);
if (dirStat.mode & 0o077) fs.chmodSync(DIR, 0o700);

const [, , cmd, ...rest] = process.argv;

function pending() {
  const out = [];
  for (const f of fs.readdirSync(DIR).sort()) {
    const m = /^req-(.+)\.json$/.exec(f);
    if (!m) continue;
    if (fs.existsSync(path.join(DIR, `res-${m[1]}.json`))) continue;
    out.push(JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")));
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

function respond(id, file) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw); // fail fast on malformed operator input
  const tmp = path.join(DIR, `res-${id}.json.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(parsed), { mode: 0o600 });
  fs.renameSync(tmp, path.join(DIR, `res-${id}.json`));
  process.stdout.write(`responded to ${id}\n`);
}

switch (cmd) {
  case "pending":
    pending();
    break;
  case "respond":
    respond(rest[0], rest[1]);
    break;
  case "clear":
    for (const f of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, f));
    process.stdout.write("cleared\n");
    break;
  default:
    process.stderr.write("usage: relay-cli.mjs pending | respond <id> <file> | clear\n");
    process.exit(1);
}
