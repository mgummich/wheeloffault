Deutsch → [fairness.md](../de/fairness.md)

# Fairness Regulation (Commit/Reveal)

*Schuldrad Operations Bureau — Directorate of Random Selection*

This regulation governs the drawing procedure by which responsibility is
assigned. It is binding for the server, the browser verifier, and any
inspector who wishes to recompute a draw by hand.

## § 1 Purpose

A draw ("Spin") must have a result that is fixed *before* the wheel turns,
and that can be independently recomputed afterward by anyone holding the
published proof. This is achieved with a two-phase commit/reveal protocol,
not with a "trust me" wheel.

## § 2 Participants and weights

Before a draw, the server computes:

1. **Eligible participants** — active members of the team, intersected with
   the selected pool (or all active members, if no pool is selected).
2. **Weights** — an integer per participant, base `1000` representing a
   `1.000×` multiplier (`FACTOR_ONE` in `src/domain/fairness/modifiers.ts`).
   Every participant starts at `1000`; enabled modifiers apply in this fixed
   order, each rounding to an integer before the next runs:

   | Order | Modifier | Effect |
   |---|---|---|
   | 1 | `pity` | `+X %` per draw without a hit since this member's last guilt |
   | 2 | `cooldown` | weight `0` for `N` draws after a hit. If this would exclude everyone, cooldown is skipped for this draw only and logged with factor `1000` for the affected members |
   | 3 | `exhaustion` | `−X %` per hit within the last `N` draws |
   | 4 | `newcomer` | `×factor` for members with fewer than `N` participations |
   | 5 | `manual` | explicit per-member factor set by an operator |
   | 6 | `immunity` | weight `0` if an immunity is active (consumed by this spin) |

   Modifier order is part of the fairness contract: it is fixed in code
   (`modifierOrder` in `modifiers.ts`), not configurable per team, and every
   applied factor is recorded per participant in the `SpinCommitted` event —
   an inspector can see exactly why each weight ended up what it did.
   Gamification (achievements, streaks, guilt points) never touches weights;
   it is read-only reporting layered on top of the same event history.

## § 3 Commit

The server:

1. Draws `serverSeed` — 32 random bytes from `crypto.getRandomValues`.
2. Computes

   ```
   commitment = SHA256( canonicalJson({ serverSeed, nonce, participants }) )
   ```

   where `participants` is the array of `{ memberId, weight }` sorted by
   `memberId` (stable order, part of what the commitment binds), `nonce` is
   the 1-based index of this spin within the team's history, and
   `canonicalJson` serializes with object keys sorted, so both sides of the
   protocol hash identical bytes (`src/domain/fairness/draw.ts`).
3. Persists `SpinCommitted { commitment, nonce, participants, modifiers,
   serverSeed, poolId, spinId }`.

The `serverSeed` is stored inside the event itself — otherwise a commit that
crashes before reveal could never be resumed after a restart — but it is
never served over HTTP before the matching `SpinRevealed` exists
(`src/domain/views.ts` strips it). The commitment, however, is public
immediately: this is what lets anyone confirm, after the reveal, that the
server could not have chosen its seed to fit a desired outcome.

## § 4 Reveal

1. The client supplies `clientSeed` — any string; the UI defaults to 16
   random bytes, hex-encoded.
2. The server computes

   ```
   digest = HMAC-SHA256(key = serverSeed, message = `${commitment}:${clientSeed}:${nonce}`)
   ```

3. **Selection.** The first 64 bits of `digest` (`digest[0..16]` as hex,
   i.e. the first 8 bytes), interpreted as an unsigned integer, are reduced
   modulo the sum of all weights. Participants are walked in `memberId`
   order, accumulating weight; the first participant whose cumulative
   weight exceeds the reduced value is selected. This is the "cumulative
   weight line": each participant owns an interval proportional to their
   weight, and the reduced digest picks a point on that line.
4. The server persists `SpinRevealed { serverSeed, clientSeed, digest,
   selectedMemberId }` and the animation drives to this already-decided
   result — the wheel never "decides" anything, it dramatizes a foregone
   conclusion.

## § 5 Verification

`verifySpin()` in `src/domain/fairness/draw.ts` recomputes commitment,
digest, and selection from a published proof and compares them against the
persisted values. This is exactly the same function used by the server and
by the browser's Web Crypto-based verifier — there is no separate,
possibly-diverging client implementation to audit. Three checks, all must
pass:

* `commitmentMatches` — the published `serverSeed`, `nonce`, and
  `participants` hash to the published `commitment`.
* `digestMatches` — HMAC of the published `commitment`, `clientSeed`, and
  `nonce`, keyed with the published `serverSeed`, equals the published
  `digest`.
* `selectionMatches` — applying § 4's selection rule to the published
  `digest` and `participants` yields the published `selectedMemberId`.

## § 6 What this protocol proves, and what it does not

**Proves:** given a published commitment, the server could not have chosen
a `serverSeed` after seeing the `clientSeed` to steer the outcome — the
commitment was fixed first. It also proves the published result is the one
actually computed from the published seeds, not a substituted one; and
because events are immutable (see [events.md](events.md) § 2), a stored
commit or reveal cannot be silently edited after the fact — changing a
`serverSeed`, `nonce`, or participant weight breaks *that spin's own*
commitment check. This is per-record tamper-evidence, not a hash chain
across the event history: each commitment binds only its own spin, not
the spin before it.

**Does not prove, § 6a — static (GitHub Pages) mode.** In static mode there
is no server. The "server" role — generating `serverSeed`, computing the
commitment, storing both — runs in the same browser tab as the participant
who will later verify it, using the identical event store
(`src/web/sessionApi.ts`, `localStorage`). Before the reveal, the seed sits
in the same browser's storage as the party being drawn against. Commit/reveal
in static mode is **self-auditing theatre**: it proves the math is internally
consistent, and it stops a browser extension or a curious teammate glancing
at the DevTools console from "predicting" the draw mid-flight by reading a
seed that was chosen before they looked — but it does not protect anyone
from the person running the browser. If you are the operator and you also
control the browser that ran the commit, you could, in principle, inspect or
discard an unfavorable `serverSeed` before revealing. Static mode is fair
*against onlookers*, not against its own operator. Server mode closes this
gap: the seed lives in a database the participants do not control (see
[deployment.md](deployment.md) and [SECURITY.md](../../SECURITY.md)).

**Does not prove, § 6b — modulo bias.** Reducing a 64-bit value modulo a
total weight introduces a small bias toward low remainders when the total
weight does not evenly divide 2⁶⁴: outcomes just above the last full
multiple of the total weight are unreachable, so the participants whose
intervals sit lowest on the cumulative-weight line are fractionally more
likely to be picked. At realistic weight magnitudes (weights on the order of
`1000` per participant, teams of single-digit-to-dozens of members, so
totals rarely exceeding a few hundred thousand against a 2⁶⁴ modulus) this
bias is smaller than one part in 10¹⁴ — negligible relative to floating
imprecision in any statistic a human would compute by hand, and far smaller
than the deliberate bias introduced on purpose by § 2's modifiers. It is
disclosed here, not hidden, because "negligible" is a claim that should be
checkable, not asserted.

## § 7 Invariants

Enforced by deterministic and property-based tests
(`src/domain/fairness/*.test.ts`):

```
same inputs             = same result
inactive member         = cannot be drawn
weight 0                = cannot be drawn
weights finite, ≥ 0
all weights 0           = error, no spin
participant order       stable
modifier order           deterministic (fixed list in modifiers.ts)
commitment binds seed + weights
reveal reproduces commitment
browser verifier reproduces server
```

## § 8 Standalone verification

Anyone with the published values of a draw — `nonce`, `commitment`,
`participants`, `serverSeed`, `clientSeed`, `digest`, `selectedMemberId`, all
shown on that spin's detail page (`src/web/views/SpinDetailPage.tsx`) —
can recompute the entire draw without running Schuldrad at all, using
`scripts/verify-draw.mjs`. It is a zero-dependency Node script that
re-implements § 3–§ 4 from this document independently; it does not import
`src/domain/fairness/draw.ts`, so it cannot silently inherit a bug from the
application it is checking.

Copy the values shown on the spin's detail page into a JSON file:

```json
{
  "serverSeed": "…",
  "clientSeed": "…",
  "nonce": 1,
  "participants": [{ "memberId": "…", "weight": 1000 }],
  "commitment": "…",
  "digest": "…",
  "selectedMemberId": "…"
}
```

Then run:

```
node scripts/verify-draw.mjs --file draw.json
# or: pnpm verify:draw -- --file draw.json
```

Values can also be passed individually as flags instead of `--file`:
`--server-seed`, `--client-seed`, `--nonce`, `--participants '<json>'`,
`--commitment`, `--digest`, `--selected-member-id`. The script prints a
Prüfprotokoll (verification record) with one ✓/✗ line per check —
commitment, digest, selection — and exits `0` only if all three pass, `1`
otherwise, so it composes with CI or a shell `&&`.
