import { DomainError } from '../errors.ts';
import type { WeightedParticipant } from '../events.ts';

/**
 * Commit/reveal draw. Runs identically in Node and the browser via Web Crypto,
 * which is why the browser verifier can reproduce the server.
 */

const encoder = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new DomainError('Ungültiges Hex');
  return new Uint8Array((hex.match(/../g) ?? []).map((h) => Number.parseInt(h, 16)));
}

export function randomHex(bytes: number): string {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/** JSON with sorted object keys, so both sides hash the same bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : 1,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text));
  return toHex(new Uint8Array(buf));
}

export async function hmacSha256Hex(keyHex: string, message: string): Promise<string> {
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

export function sortParticipants(participants: WeightedParticipant[]): WeightedParticipant[] {
  return [...participants].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
}

export function commitmentOf(
  serverSeed: string,
  nonce: number,
  participants: WeightedParticipant[],
): Promise<string> {
  return sha256Hex(
    canonicalJson({ serverSeed, nonce, participants: sortParticipants(participants) }),
  );
}

export function drawMessage(commitment: string, clientSeed: string, nonce: number): string {
  return `${commitment}:${clientSeed}:${nonce}`;
}

export function assertValidWeights(participants: WeightedParticipant[]): void {
  if (participants.length === 0) throw new DomainError('Keine Teilnehmer');
  let total = 0;
  for (const p of participants) {
    if (!Number.isSafeInteger(p.weight) || p.weight < 0) {
      throw new DomainError(`Ungültiges Gewicht für ${p.memberId}: ${p.weight}`);
    }
    total += p.weight;
  }
  if (total === 0) throw new DomainError('Alle Gewichte sind 0');
}

/**
 * Deterministic selection: the first 64 bits of the digest, reduced modulo
 * the total weight, pick a point on the cumulative weight line. Participants
 * are visited in memberId order. Zero-weight participants own no interval.
 */
export function selectParticipant(digestHex: string, participants: WeightedParticipant[]): string {
  assertValidWeights(participants);
  const sorted = sortParticipants(participants);
  const total = sorted.reduce((sum, p) => sum + BigInt(p.weight), 0n);
  const point = BigInt(`0x${digestHex.slice(0, 16)}`) % total;
  let cumulative = 0n;
  for (const p of sorted) {
    cumulative += BigInt(p.weight);
    if (point < cumulative) return p.memberId;
  }
  throw new DomainError('Ziehung ohne Ergebnis – darf nicht passieren');
}

export type SpinProof = {
  nonce: number;
  commitment: string;
  participants: WeightedParticipant[];
  serverSeed: string;
  clientSeed: string;
  digest: string;
  selectedMemberId: string;
};

export type Verification = {
  commitmentMatches: boolean;
  digestMatches: boolean;
  selectionMatches: boolean;
  ok: boolean;
};

/** Recomputes everything from the published proof. Same code on server and in the browser. */
export async function verifySpin(proof: SpinProof): Promise<Verification> {
  const commitment = await commitmentOf(proof.serverSeed, proof.nonce, proof.participants);
  let digest = '';
  try {
    digest = await hmacSha256Hex(
      proof.serverSeed,
      drawMessage(proof.commitment, proof.clientSeed, proof.nonce),
    );
  } catch {
    // Non-hex server seed: nothing can match.
  }
  let selected: string | null = null;
  try {
    selected = selectParticipant(digest, proof.participants);
  } catch {
    selected = null;
  }
  const commitmentMatches = commitment === proof.commitment;
  const digestMatches = digest === proof.digest;
  const selectionMatches = selected === proof.selectedMemberId;
  return {
    commitmentMatches,
    digestMatches,
    selectionMatches,
    ok: commitmentMatches && digestMatches && selectionMatches,
  };
}
