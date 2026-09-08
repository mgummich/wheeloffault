#!/usr/bin/env node
// PRÜFPROTOKOLL / VERIFICATION RECORD generator for a single Schuldrad draw.
//
// Zero-dependency, standalone re-implementation of the commit/reveal protocol
// documented in docs/en/fairness.md. Deliberately does NOT import
// src/domain/fairness/draw.ts — an inspector should be able to hold this one
// file, the spec, and a draw's published values, and reach the same verdict
// the application does, independently.
//
// Usage:
//   node scripts/verify-draw.mjs --file draw.json
//   node scripts/verify-draw.mjs --server-seed <hex> --client-seed <str> \
//     --nonce <n> --participants '[{"memberId":"a","weight":1000}]' \
//     --commitment <hex> --digest <hex> --selected-member-id <id>
//
// Exit 0 if every check passes ("bestanden"), exit 1 otherwise ("beanstandet").

import { readFileSync } from 'node:fs';

function usageAndExit(message) {
  if (message) console.error(`Fehler / Error: ${message}`);
  console.error(
    'Usage: node scripts/verify-draw.mjs --file <draw.json>\n' +
      '   or: node scripts/verify-draw.mjs --server-seed <hex> --client-seed <str> --nonce <n> ' +
      '--participants <json> --commitment <hex> --digest <hex> --selected-member-id <id>',
  );
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) usageAndExit(`unexpected argument "${arg}"`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined) usageAndExit(`missing value for --${key}`);
    out[key] = value;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

let record;
if (args.file) {
  record = JSON.parse(readFileSync(args.file, 'utf8'));
} else if (args['server-seed']) {
  record = {
    serverSeed: args['server-seed'],
    clientSeed: args['client-seed'],
    nonce: Number(args.nonce),
    participants: args.participants ? JSON.parse(args.participants) : undefined,
    commitment: args.commitment,
    digest: args.digest,
    selectedMemberId: args['selected-member-id'],
  };
} else {
  usageAndExit('provide --file <draw.json> or --server-seed and friends');
}

const {
  serverSeed,
  clientSeed,
  nonce,
  participants,
  commitment: expectedCommitment,
  digest: expectedDigest,
  selectedMemberId: expectedSelectedMemberId,
} = record;

for (const [field, value] of Object.entries({ serverSeed, clientSeed, nonce, participants })) {
  if (value === undefined) usageAndExit(`missing required field "${field}"`);
}
if (!Array.isArray(participants) || participants.length === 0) {
  usageAndExit('participants must be a non-empty array of { memberId, weight }');
}

// --- Protocol re-implementation (mirrors src/domain/fairness/draw.ts) -------

const encoder = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error(`invalid hex: ${hex}`);
  }
  return new Uint8Array((hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)));
}

/** JSON with sorted object keys (UTF-16 code unit order, i.e. plain `<`), so both sides hash the same bytes. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text));
  return toHex(new Uint8Array(buf));
}

async function hmacSha256Hex(keyHex, message) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    fromHex(keyHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(new Uint8Array(sig));
}

function sortParticipants(list) {
  return [...list].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
}

function commitmentOf(seed, n, list) {
  return sha256Hex(
    canonicalJson({ serverSeed: seed, nonce: n, participants: sortParticipants(list) }),
  );
}

function drawMessage(commitment, client, n) {
  return `${commitment}:${client}:${n}`;
}

function assertValidWeights(list) {
  let total = 0;
  for (const p of list) {
    if (!Number.isSafeInteger(p.weight) || p.weight < 0) {
      throw new Error(`invalid weight for ${p.memberId}: ${p.weight}`);
    }
    total += p.weight;
  }
  if (total === 0) throw new Error('all weights are 0');
}

/** First 64 bits of the digest, reduced modulo total weight, over the cumulative weight line. */
function selectParticipant(digestHex, list) {
  assertValidWeights(list);
  const sorted = sortParticipants(list);
  const total = sorted.reduce((sum, p) => sum + BigInt(p.weight), 0n);
  const point = BigInt(`0x${digestHex.slice(0, 16)}`) % total;
  let cumulative = 0n;
  for (const p of sorted) {
    cumulative += BigInt(p.weight);
    if (point < cumulative) return p.memberId;
  }
  throw new Error('draw without a result - must not happen');
}

// --- Run the checks ----------------------------------------------------------

async function main() {
  const checks = [];

  let commitment = null;
  try {
    commitment = await commitmentOf(serverSeed, nonce, participants);
  } catch (err) {
    checks.push({
      id: 'commitment',
      label: 'Commitment / Bindung',
      ok: false,
      detail: String(err),
    });
  }
  if (commitment !== null) {
    const ok = commitment === expectedCommitment;
    checks.push({
      id: 'commitment',
      label: 'Commitment / Bindung',
      ok,
      detail: ok ? commitment : `berechnet ${commitment} != erwartet ${expectedCommitment}`,
    });
  }

  let digest = null;
  try {
    digest = await hmacSha256Hex(
      serverSeed,
      drawMessage(expectedCommitment ?? commitment ?? '', clientSeed, nonce),
    );
  } catch (err) {
    checks.push({ id: 'digest', label: 'HMAC-Digest / Reveal', ok: false, detail: String(err) });
  }
  if (digest !== null) {
    const ok = digest === expectedDigest;
    checks.push({
      id: 'digest',
      label: 'HMAC-Digest / Reveal',
      ok,
      detail: ok ? digest : `berechnet ${digest} != erwartet ${expectedDigest}`,
    });
  }

  let selected = null;
  try {
    selected = selectParticipant(digest ?? expectedDigest ?? '', participants);
  } catch (err) {
    checks.push({
      id: 'selection',
      label: 'Gewinnerauswahl / Winner selection',
      ok: false,
      detail: String(err),
    });
  }
  if (selected !== null) {
    const ok = selected === expectedSelectedMemberId;
    checks.push({
      id: 'selection',
      label: 'Gewinnerauswahl / Winner selection',
      ok,
      detail: ok ? selected : `berechnet ${selected} != erwartet ${expectedSelectedMemberId}`,
    });
  }

  const allOk = checks.length === 3 && checks.every((c) => c.ok);

  console.log('======================================================================');
  console.log(' PRÜFPROTOKOLL / VERIFICATION RECORD');
  console.log(' Schuldrad Betriebsamt — Direktion für Zufallsauswahl');
  console.log(' Schuldrad Operations Bureau — Directorate of Random Selection');
  console.log('======================================================================');
  console.log(` Aktenzeichen / Reference .... nonce=${nonce}`);
  console.log(` Teilnehmer / Participants ... ${participants.length}`);
  console.log('----------------------------------------------------------------------');
  for (const check of checks) {
    console.log(` [${check.ok ? '✓' : '✗'}] ${check.label}`);
    console.log(`     ${check.detail}`);
  }
  console.log('----------------------------------------------------------------------');
  console.log(
    allOk
      ? ' BEFUND / VERDICT: bestanden — geprüft und für in Ordnung befunden. (PASS)'
      : ' BEFUND / VERDICT: beanstandet — Abweichung festgestellt. (FAIL)',
  );
  console.log('======================================================================');

  process.exit(allOk ? 0 : 1);
}

main();
