import { DomainError } from '../errors.ts';
import type { DomainEvent } from '../events.ts';
import { findSpin, pendingSpin, type TeamState } from '../team.ts';
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
    throw new DomainError('A draw is already running', 'spin_already_pending', {
      spinId: pending.spinId,
    });
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
  // Same clientSeed hygiene the HTTP boundary applies via `str()` (NUL check,
  // 200-char cap) — closed here too so static mode's direct localStorage
  // writes can't bypass it.
  if (input.clientSeed.includes('\u0000')) {
    throw new DomainError('clientSeed must not contain NUL', 'field_not_string');
  }
  const clientSeed = input.clientSeed.slice(0, 200);
  const spin = findSpin(state, input.spinId);
  if (spin.reveal) {
    if (spin.reveal.clientSeed === clientSeed) return [];
    throw new DomainError(
      'Draw was already revealed with a different client seed',
      'spin_already_revealed',
    );
  }
  // Defensive: history must be self-consistent before we build on it.
  const expected = await commitmentOf(spin.serverSeed, spin.nonce, spin.participants);
  if (expected !== spin.commitment) {
    throw new DomainError('Server seed does not match the commitment', 'commitment_mismatch');
  }
  const digest = await hmacSha256Hex(
    spin.serverSeed,
    drawMessage(spin.commitment, clientSeed, spin.nonce),
  );
  const selectedMemberId = selectParticipant(digest, spin.participants);
  return [
    {
      type: 'SpinRevealed',
      spinId: spin.spinId,
      serverSeed: spin.serverSeed,
      clientSeed,
      digest,
      selectedMemberId,
      at: input.now,
    },
  ];
}
