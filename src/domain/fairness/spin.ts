import { DomainError } from '../errors.ts';
import type { DomainEvent } from '../events.ts';
import { type Spin, type TeamState, findSpin, pendingSpin } from '../team.ts';
import { commitmentOf, drawMessage, hmacSha256Hex, selectParticipant } from './draw.ts';
import { calculateWeights, eligibleMembers } from './weights.ts';

export type CommitInput = {
  spinId: string;
  poolId: string | null;
  serverSeed: string;
  now: string;
};

export type CommitResult = { events: DomainEvent[]; spinId: string };

/**
 * Commit step. Returns no events if the spin id already exists (idempotent
 * retry). Throws `conflict` if another spin is still pending.
 */
export async function commitSpin(state: TeamState, input: CommitInput): Promise<CommitResult> {
  const existing = state.spins.find((s) => s.spinId === input.spinId);
  if (existing) return { events: [], spinId: existing.spinId };
  const pending = pendingSpin(state);
  if (pending) {
    throw new DomainError('Eine Ziehung läuft bereits', 'conflict', { spinId: pending.spinId });
  }
  const members = eligibleMembers(state, input.poolId);
  const { participants, modifiers } = calculateWeights(state, members);
  const nonce = state.spins.length + 1;
  const commitment = await commitmentOf(input.serverSeed, nonce, participants);
  const events: DomainEvent[] = [
    {
      type: 'SpinCommitted',
      spinId: input.spinId,
      poolId: input.poolId,
      nonce,
      commitment,
      participants,
      modifiers,
      serverSeed: input.serverSeed,
      at: input.now,
    },
  ];
  // Immunity is used up by the spin it protected from, whether or not the reveal happens.
  for (const p of participants) {
    if (state.immunities.some((i) => i.memberId === p.memberId)) {
      events.push({
        type: 'ImmunityConsumed',
        memberId: p.memberId,
        spinId: input.spinId,
        at: input.now,
      });
    }
  }
  return { events, spinId: input.spinId };
}

export type RevealInput = { spinId: string; clientSeed: string; now: string };

/** Reveal step. Idempotent for the same clientSeed; conflicting reveal is rejected. */
export async function revealSpin(state: TeamState, input: RevealInput): Promise<DomainEvent[]> {
  const spin = findSpin(state, input.spinId);
  if (spin.reveal) {
    if (spin.reveal.clientSeed === input.clientSeed) return [];
    throw new DomainError('Ziehung wurde bereits mit anderem Client-Seed aufgedeckt', 'conflict');
  }
  // Defensive: history must be self-consistent before we build on it.
  const expected = await commitmentOf(spin.serverSeed, spin.nonce, spin.participants);
  if (expected !== spin.commitment) {
    throw new DomainError('Server-Seed passt nicht zum Commitment', 'conflict');
  }
  const digest = await hmacSha256Hex(
    spin.serverSeed,
    drawMessage(spin.commitment, input.clientSeed, spin.nonce),
  );
  const selectedMemberId = selectParticipant(digest, spin.participants);
  return [
    {
      type: 'SpinRevealed',
      spinId: spin.spinId,
      serverSeed: spin.serverSeed,
      clientSeed: input.clientSeed,
      digest,
      selectedMemberId,
      at: input.now,
    },
  ];
}

export function proofOf(spin: Spin) {
  if (!spin.reveal) throw new DomainError('Ziehung noch nicht aufgedeckt');
  return {
    nonce: spin.nonce,
    commitment: spin.commitment,
    participants: spin.participants,
    serverSeed: spin.reveal.serverSeed,
    clientSeed: spin.reveal.clientSeed,
    digest: spin.reveal.digest,
    selectedMemberId: spin.reveal.selectedMemberId,
  };
}
