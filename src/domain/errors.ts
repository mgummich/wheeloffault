/** Stable machine codes for DomainError, shipped as {code} over HTTP so the
 * web layer can localize without parsing English messages. */
export type ErrorCode =
  | 'name_empty'
  | 'name_too_long'
  | 'name_invalid'
  | 'member_name_conflict'
  | 'unknown_policy_member'
  | 'pool_name_conflict'
  | 'pool_not_found'
  | 'no_immunity'
  | 'spin_not_revealed'
  | 'appeal_already_filed'
  | 'no_appeal'
  | 'appeal_already_decided'
  | 'unknown_event_type'
  | 'member_not_found'
  | 'spin_not_found'
  | 'no_participants'
  | 'duplicate_member_id'
  | 'invalid_weight'
  | 'all_weights_zero'
  | 'spin_without_result'
  | 'spin_already_pending'
  | 'spin_already_revealed'
  | 'commitment_mismatch'
  | 'no_active_members'
  | 'invalid_modifier_factor'
  | 'policy_invalid'
  | 'invalid_hex'
  | 'body_not_object'
  | 'field_not_string'
  | 'field_too_long'
  | 'field_not_string_array'
  | 'field_too_many_items'
  | 'invalid_id'
  | 'invalid_url'
  | 'team_not_found'
  | 'team_version_conflict';

type Status = 'invalid' | 'not_found' | 'conflict';

const STATUS_BY_CODE: Record<ErrorCode, Status> = {
  name_empty: 'invalid',
  name_too_long: 'invalid',
  name_invalid: 'invalid',
  member_name_conflict: 'conflict',
  unknown_policy_member: 'invalid',
  pool_name_conflict: 'conflict',
  pool_not_found: 'not_found',
  no_immunity: 'not_found',
  spin_not_revealed: 'invalid',
  appeal_already_filed: 'conflict',
  no_appeal: 'invalid',
  appeal_already_decided: 'conflict',
  unknown_event_type: 'invalid',
  member_not_found: 'not_found',
  spin_not_found: 'not_found',
  no_participants: 'invalid',
  duplicate_member_id: 'invalid',
  invalid_weight: 'invalid',
  all_weights_zero: 'invalid',
  spin_without_result: 'invalid',
  spin_already_pending: 'conflict',
  spin_already_revealed: 'conflict',
  commitment_mismatch: 'conflict',
  no_active_members: 'invalid',
  invalid_modifier_factor: 'invalid',
  policy_invalid: 'invalid',
  invalid_hex: 'invalid',
  body_not_object: 'invalid',
  field_not_string: 'invalid',
  field_too_long: 'invalid',
  field_not_string_array: 'invalid',
  field_too_many_items: 'invalid',
  invalid_id: 'invalid',
  invalid_url: 'invalid',
  team_not_found: 'not_found',
  team_version_conflict: 'conflict',
};

/**
 * Thrown by domain functions on invalid transitions. `status` (derived from
 * `code`) maps to an HTTP status by the server; `code` is the stable,
 * machine-readable identity the web layer localizes; `message` is an
 * English, developer/API-facing description.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly status: Status;
  readonly details: Record<string, unknown>;

  constructor(message: string, code: ErrorCode, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
