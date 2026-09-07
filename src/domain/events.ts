import type { FairnessPolicy } from './fairness/policy.ts';

/**
 * Persisted contract. Events are immutable history: never rename a type or a
 * field, never change a field's meaning. New meaning = new event type.
 */

export type WeightedParticipant = {
  memberId: string;
  weight: number; // integer, 1000 = 1.000×
};

export type AppliedModifier = {
  name: string;
  /** Per-member factor the modifier applied, keyed by memberId. 1000 = unchanged. */
  factors: Record<string, number>;
};

export type EventBody =
  | { type: 'TeamCreated'; teamId: string; name: string }
  | { type: 'MemberJoined'; memberId: string; name: string }
  | { type: 'MemberDeactivated'; memberId: string }
  | { type: 'MemberReactivated'; memberId: string }
  | { type: 'PoolCreated'; poolId: string; name: string }
  | { type: 'PoolMembershipChanged'; poolId: string; memberIds: string[] }
  | { type: 'PoolRenamed'; poolId: string; name: string }
  | { type: 'PoolDeleted'; poolId: string }
  | { type: 'FairnessPolicyChanged'; policy: FairnessPolicy }
  | {
      type: 'SpinCommitted';
      spinId: string;
      poolId: string | null;
      nonce: number;
      commitment: string;
      participants: WeightedParticipant[];
      modifiers: AppliedModifier[];
      /**
       * Persisted with the commit so a reveal survives restarts. The HTTP
       * layer never serves it before SpinRevealed exists (see views.ts).
       */
      serverSeed: string;
    }
  | {
      type: 'SpinRevealed';
      spinId: string;
      serverSeed: string;
      clientSeed: string;
      digest: string;
      selectedMemberId: string;
    }
  | { type: 'GuiltAppealed'; spinId: string; reason: string }
  | { type: 'AppealUpheld'; spinId: string }
  | { type: 'AppealRejected'; spinId: string }
  | { type: 'ImmunityGranted'; memberId: string; reason: string }
  | { type: 'ImmunityConsumed'; memberId: string; spinId: string }
  | { type: 'ImmunityRevoked'; memberId: string };

export type DomainEvent = EventBody & {
  /** ISO 8601 timestamp, set when the event is created. */
  at: string;
};

export type StoredEvent = DomainEvent & {
  streamId: string;
  version: number;
  position: number;
};

/**
 * The only place where old persisted shapes may be adapted to the current
 * contract. Currently nothing has changed since v1.
 */
export function upcast(event: DomainEvent): DomainEvent {
  return event;
}
