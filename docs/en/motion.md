Deutsch → [motion.md](../de/motion.md)

# Motion Regulation

*Schuldrad Operations Bureau — Directorate of Signal & Rolling Stock*

This regulation governs how a draw's already-decided result may be
*revealed* to the platform. It binds every visualization
(`src/web/wheel/Wheel.tsx`, `src/web/wheel/stages.tsx`) and the announcement
that follows it (`src/web/RevealName.tsx`).

## § 1 Purpose and non-negotiable ordering

Motion is decoration. It never decides anything.

The winner is fixed by the commit/reveal protocol
(`docs/en/fairness.md`) before a single frame is drawn: the server commits
to a seed and weights, then reveals a result, and only *then* does
`SpinPage.draw()` (`src/web/views/SpinPage.tsx`) switch the phase to
`animating` with that already-known result in hand
(`src/web/draw.ts` → `performDraw`). Every visualization receives the
finished `result` as a prop on mount and spends the following seconds
*performing* it — spinning a wheel to the winning segment, rolling a
timetable to the winning row, sweeping a needle to the winning position.
None of them pick anything. If this ordering is ever inverted — if a
visualization's own randomness or timing ever influenced who wins — that is
a fairness incident, not a motion bug.

## § 2 Duration scale

| Tier | Token | Range | Used for |
|---|---|---|---|
| Indicator | `--dur-indicator` | 150–180ms | flap/tick snaps, per-character reveals |
| Mechanical latency | `--dur-latency` | 80–120ms | control acknowledgement (signal light switching, hover/press feedback) |
| Mechanical settle | `--dur-settle` | 240–400ms | stamp impact, wheel segment highlight, panel pop-in |
| Theatrical reveal | `DURATION_MS` (`src/web/wheel/anim.ts`) | 6.5s | the full draw performance, commit to announcement |

The theatrical reveal is one constant shared by every non-wheel
visualization and the wheel's own spin duration, so all seven read as the
same length of "the train is deciding" — switching visualizations must not
change how long a draw feels.

## § 2a Easing tokens

Defined in `src/web/styles.css` under `:root`:

- `--ease-mechanical` (`cubic-bezier(.2,.8,.2,1)`) — sharp attack, damped
  settle. The default feel for anything that "arrives": panels, stamps,
  flourishes.
- `--ease-damped` (`cubic-bezier(.3,.7,.3,1)`) — slower attack, floaty
  settle. Used where a heavier object is landing (dialogs, drop-ins).
- `--ease-sharp` (`cubic-bezier(.4,0,.2,1)`) — decisive, no lingering.
  Snaps and acknowledgements.

None of these are spring/bounce curves. A railway relay does not oscillate
before it commits — it clacks into position and stays. Overshoot, where
used (§ 5), is expressed as an explicit two-phase curve (past the target,
then back), never as a physical spring simulation.

The wheel's own spin easing lives in code, not CSS, because it must be
sampled every frame to place the SVG rotation: `ease(style, t)` in
`src/web/wheel/anim.ts`, unit-tested in `anim.test.ts`. Its curves are the
canonical "mechanical" vocabulary this document describes in prose:

- `standard` — pure damped cubic ease-out, no overshoot: the default "wheel
  spins down like a wheel" curve.
- `overshoot` — passes the target and eases back, for the settle behavior
  in § 5.
- `windup` — dips backward first (anticipation, § 4), then eases forward.
- `stopp` — exponential decay, reads as a hard mechanical brake.
- `lang` — the standard curve over twice the distance (used with a longer
  effective travel, not a different feel).

## § 3 Mechanical latency

A real relay interlocking doesn't switch a signal the instant a lever is
pulled — there's a beat while the mechanism catches up. `--dur-latency`
(100–120ms) is that beat: `SignalStage`'s arm-light background transition
uses it so the light doesn't teleport between states.

## § 4 Anticipation

A brief wind-up before a big reveal reads as physical, not glitchy:

- The wheel's `windup` spin style dips backward ~3.5° before committing to
  the forward spin (`ease()`'s `windup` case).
- `SignalStage` blinks the hot indicator (reusing the existing `.blink`
  keyframe) while a name is still cycling, before the final stop state
  snaps in — a warning flash before the light goes solid red.
- `StampStage` lifts the hot ticket a couple of pixels before the stamp
  falls, an explicit wind-up rather than a transform that only ever
  animates on impact.

## § 5 Settling (overshoot + damped return)

Where a visualization models a physical object coming to rest, it
overshoots and eases back rather than stopping dead:

- The wheel's `overshoot` spin style passes the winning segment and swings
  back (cubic overshoot formula in `ease()`).
- The ticket stamp (`sr-stamp`/`sr-stampin` keyframes) lands oversized,
  compresses past 1×, then settles — ink weight landing on paper.
- The default wheel curve (`standard`) is a damped ease-out with *no*
  overshoot: not every visualization needs a bounce, and forcing one
  everywhere would read as a cartoon spring rather than a railway
  mechanism.

## § 6 Cancellation

"Skip" (`data-testid="skip-animation"`, `spin.skipButton`) does not rewind,
pause, or fast-forward an animation — it commits to the already-decided
result immediately:

- `SpinPage.finish()` moves the phase straight to `announced`.
- `Wheel.tsx` has an effect keyed on `announced` that, if the spin loop is
  still running, snaps `rotation` to the precomputed target and marks
  `finished` — the next frame renders the final pose, not an interpolated
  one.
- Every other stage's `useNameTicker` derives `currentId` from `announced`
  first: once announced, the displayed name *is* `result.reveal
  .selectedMemberId`, regardless of which tick the RAF loop had reached.
  There is no rewind path — cancellation only ever jumps forward to the
  committed end state.

## § 7 Reduced motion

`prefers-reduced-motion: reduce` gets an instant result, not a fast one.
Two layers enforce this (`src/web/styles.css`):

1. Every visualization's own RAF loop checks `reduced` up front and calls
   its `finish()`/`onFinished()` synchronously instead of scheduling
   frames — `Wheel.tsx`'s spin effect and `stages.tsx`'s `useNameTicker`
   both do this, so `animating` becomes `false` before a CSS
   transition/animation would ever have a chance to run.
2. A universal reduced-motion rule collapses any CSS animation or
   transition that still fires (flap snaps, stamp impact, panel pop-ins,
   toasts) to effectively zero duration, as a backstop that needs no
   per-component enumeration.

The result is still announced in both cases: the `aria-live="assertive"`
region in `SpinPage.tsx` is permanently mounted and its text is driven by
`announced`/`result`, not by animation completion — reduced motion doesn't
skip the announcement, it just skips the show beforehand.

## § 8 Per-visualization notes

| Visualization | What it does, in these terms |
|---|---|
| **Wheel** (`Wheel.tsx`) | Spins via the JS-sampled `ease()` curves (§ 2a); a pointer "kick" (22° impulse decaying over 140ms) fires on every segment boundary — a cheap per-tick tactile cue. Settle behavior depends on the user's chosen `spinStyle` (§ 5). |
| **Split-flap board** (`BoardStage`) | Each flap snaps on `--dur-indicator`; tiles are staggered a few ms apart left-to-right so the row reads as a cascade of independent mechanisms, not one repainted string. |
| **Signal** (`SignalStage`) | Arm/light state changes cross `--dur-latency` before landing; a blink anticipates the final stop (§ 4) rather than snapping straight to red. |
| **Ticket stamp** (`StampStage`) | Lift (anticipation) → fast impact → oversized-then-settled ink (§ 5), via `sr-stamp`. |
| **Train arrival** (`TrainStage`) | Approaches on a front-loaded-then-flattening cubic-bezier that reads as braking; the name only resolves after the train has fully stopped. |
| **Timetable roll** (`TimetableStage`) | Rolls through several extra loops before landing on the result row, damped stop via the same braking-family bezier as the train. |
| **Weight line** (`LineStage`) | Needle sweeps to the winner's position on the same damped-stop curve, holding there once announced. |

Wheel, Train, Timetable, and Line already implemented damped/braking curves
before this regulation was written; only the Board's cascade stagger,
Signal's anticipation blink, and Stamp's lift transition were added.
