English → [motion.md](../en/motion.md) (kanonisch)

> Diese Übersetzung wird separat gepflegt und kann der kanonischen
> englischen Fassung hinterherhinken.

# Bewegungs-Verordnung

*Schuldrad-Betriebsamt — Direktion für Signal- und Fahrzeugwesen*

Diese Verordnung regelt, wie die Plattform das bereits feststehende
Ergebnis einer Ziehung *zeigt*. Sie bindet jede Visualisierung
(`src/web/wheel/Wheel.tsx`, `src/web/wheel/stages.tsx`) und die
anschließende Ansage (`src/web/RevealName.tsx`).

## § 1 Zweck und unantastbare Reihenfolge

Bewegung ist Dekoration. Sie entscheidet nie etwas.

Der Gewinner steht durch das Commit/Reveal-Protokoll
([fairness.md](fairness.md)) fest, bevor auch nur ein Bild gezeichnet wird: Der
Server legt sich auf Seed und Gewichte fest, deckt dann ein Ergebnis auf, und
erst *danach* schaltet der in `SpinPage` definierte `draw`-Callback
(`src/web/views/SpinPage.tsx`) die Phase auf `animating` — mit dem bereits
bekannten Ergebnis in der Hand (`src/web/draw.ts` → `performDraw`). Jede
Visualisierung wird mit `result={null}` gemountet und erhält das fertige
`result` als Prop erst, wenn die Phase auf `animating` wechselt
(`src/web/views/SpinPage.tsx`), und verbringt die folgenden Sekunden damit,
es *aufzuführen* — ein Rad bis zum Gewinnsegment drehen, einen Fahrplan bis
zur Gewinnzeile rollen, eine Nadel bis zur Gewinnposition schwenken. Keine
davon wählt etwas aus. Sollte diese Reihenfolge jemals umgekehrt werden —
sollte der Zufall oder das Timing einer Visualisierung selbst jemals
beeinflussen, wer gewinnt — ist das ein Fairness-Vorfall, kein
Bewegungsfehler.

## § 2 Dauerskala

| Stufe | Token | Bereich | Verwendung |
|---|---|---|---|
| Indikator | `--dur-indicator` | 160 ms | Klapp-Schnappen (`sr-flap`, `BoardStage` und `TrainStage`) |
| Mechanische Latenz | `--dur-latency` | 120 ms | Steuerungsquittung (Arm-/Licht-Übergänge in `SignalStage`, Rand/Transform in `StampStage`) |
| Mechanisches Einrasten | `--dur-settle` | 400 ms | Stempelaufprall (`sr-stamp`/`sr-stampin`) |
| Theatralische Enthüllung | `DURATION_MS` (`src/web/wheel/anim.ts`) | 6,5 s | die gesamte Ziehungs-Aufführung, vom Commit bis zur Ansage |

Die theatralische Enthüllung ist eine einzige Konstante, die sich alle
sechs Nicht-Rad-Visualisierungen und die Ziehungsdauer des Rades teilen —
damit fühlen sich alle sieben gleich lang an („der Zug entscheidet noch“):
ein Wechsel der Visualisierung darf sich nicht auf das Zeitgefühl einer
Ziehung auswirken.

## § 2a Easing-Tokens

Definiert in `src/web/styles.css` unter `:root`. `--ease-mechanical`
(`cubic-bezier(.2,.8,.2,1)`) ist das einzige Token: scharfer Antritt,
gedämpftes Einrasten, der Standard für alles, was „ankommt“. Seine drei
Verwendungen sind der Rand-/Transform-Übergang von `StampStage`,
dessen Aufprall-Animation (die `sr-stamp`-Animation in
`src/web/wheel/stages.tsx`) und die zugehörige `.reveal-stamp`-Regel in
`src/web/styles.css`.

Keine davon ist eine Feder-/Bounce-Kurve. Ein Bahnrelais schwingt nicht
nach, bevor es einrastet — es klackt in Position und bleibt dort. Wo
Überschwingen verwendet wird (§ 5), geschieht das über eine explizite
Zweiphasenkurve (über das Ziel hinaus, dann zurück), nie als physikalische
Feder-Simulation.

Die Ziehungs-Easing-Kurven des Rades selbst leben im Code, nicht in CSS, weil
sie für die SVG-Rotation bei jedem Frame neu berechnet werden müssen:
`ease(style, t)` in `src/web/wheel/anim.ts`, getestet in `anim.test.ts`.
Ihre Kurven sind das kanonische „mechanische“ Vokabular dieser Verordnung:

- `standard` — reine gedämpfte Ease-out-Kurve (Exponent 3,2) ohne
  Überschwingen: die Standardkurve „das Rad dreht sich aus wie ein Rad“.
- `overshoot` — schießt über das Ziel hinaus und pendelt zurück, siehe § 5.
- `windup` — schwingt zunächst rückwärts (Antizipation, § 4), dann
  vorwärts.
- `stopp` — exponentieller Abfall, liest sich als harte mechanische
  Bremsung.
- `lang` — eine weniger gedämpfte Ease-out-Kurve (Exponent 2,2 statt 3,2
  bei `standard`) über die doppelte Distanz (3600° statt 1800°): sowohl
  Kurve als auch Strecke unterscheiden sich von `standard`, was ein
  spürbar loseres, stärker auslaufendes Gefühl ergibt, nicht nur eine
  längere Version derselben Kurve.

## § 3 Mechanische Latenz

Ein echtes Relais-Stellwerk schaltet ein Signal nicht in dem Moment um, in
dem der Hebel gezogen wird — es gibt einen Takt, bis der Mechanismus
nachzieht. `--dur-latency` (120 ms) ist dieser Takt: Der
Arm-/Licht-Hintergrundübergang in `SignalStage` nutzt ihn, damit das Licht
nicht zwischen Zuständen teleportiert.

## § 4 Antizipation

Ein kurzer Vorlauf vor einer großen Enthüllung liest sich physikalisch,
nicht fehlerhaft:

- Der `windup`-Ziehungsstil des Rades schwingt vor dem eigentlichen
  Vorwärts-Spin um rund 3,5 % der gesamten Ziehungsstrecke zurück (Fall
  `windup` in `ease()`) — etwa 63° über die ~1800°-Mindeststrecke von
  `windup` selbst.
  Zum Vergleich: dieselben 3,5 % über die ~3600°-Strecke des `lang`-Stils
  wären ~126° (`lang` und `windup` sind eigenständige, nicht kombinierbare
  Ziehungsstile; `lang` selbst schwingt nicht zurück).
- `SignalStage` lässt den heißen Indikator blinken (nutzt das bestehende
  `.blink`-Keyframe), solange ein Name noch durchläuft, bevor der finale
  Stopp-Zustand einrastet — ein Warnblinken vor dem soliden Rot.
- `StampStage` hebt das heiße Ticket kurz an, bevor der Stempel fällt — ein
  expliziter Vorlauf statt einer Transform, die nur beim Aufprall animiert
  wird.

## § 5 Einrasten (Überschwingen + gedämpfte Rückkehr)

Wo eine Visualisierung ein physisches, zur Ruhe kommendes Objekt
modelliert, schwingt sie über und pendelt gedämpft zurück, statt abrupt
zu stoppen:

- Der `overshoot`-Ziehungsstil des Rades überfährt das Gewinnsegment und
  schwingt zurück (kubische Überschwing-Formel in `ease()`).
- Der Ticketstempel (`sr-stamp`/`sr-stampin`-Keyframes) landet überdimensioniert,
  staucht sich unter 1× und rastet dann ein — Tintengewicht, das aufs
  Papier trifft.
- Die Standard-Radkurve (`standard`) ist ein gedämpftes Ease-out *ohne*
  Überschwingen: Nicht jede Visualisierung braucht ein Federn, und ein
  erzwungenes Federn überall würde sich wie eine Cartoon-Feder statt wie
  ein Bahnmechanismus lesen.

## § 6 Abbruch

„Überspringen“ (`data-testid="skip-animation"`, `spin.skipButton`) spult
eine laufende Animation nicht zurück und pausiert oder beschleunigt sie
auch nicht — es rastet sofort im bereits feststehenden Ergebnis ein:

- Der in `SpinPage` definierte `finish`-Callback schaltet die Phase direkt
  auf `announced`.
- `Wheel.tsx` besitzt einen an `announced` gebundenen Effekt, der die
  `rotation` — falls die Ziehungsschleife noch läuft — sofort auf das
  vorab berechnete Ziel setzt und `finished` markiert: Der nächste Frame
  zeigt die finale Pose, keine interpolierte.
- Jede andere Visualisierung leitet `currentId` in ihrem `useNameTicker` zuerst aus
  `announced` ab: Sobald angesagt wurde, *ist* der angezeigte Name
  `result.reveal.selectedMemberId`, unabhängig davon, welchen Tick die
  RAF-Schleife erreicht hatte. (`LineStage` liest `currentId` gar nicht —
  sie steuert ihre Nadel direkt aus `result.reveal` — destrukturiert aber
  dasselbe `animating`-Flag aus `useNameTicker`, sodass dieselbe
  Nur-vorwärts-Garantie auch für sie gilt.) Es gibt keinen Rückspul-Pfad —
  ein Abbruch springt immer nur vorwärts zum feststehenden Endzustand.

## § 7 Reduzierte Bewegung

`prefers-reduced-motion: reduce` erhält ein sofortiges Ergebnis, kein
schnelles. Zwei Ebenen setzen das durch:

1. In JS prüft jede Visualisierung `reduced` zu Beginn ihrer eigenen
   RAF-Schleife und ruft `finish()`/`onFinished()` synchron auf, statt
   Frames zu planen — sowohl der Ziehungseffekt in `Wheel.tsx` als auch
   `useNameTicker` in `stages.tsx` tun das, sodass `animating` bereits
   `false` ist, bevor ein CSS-Übergang oder eine CSS-Animation überhaupt
   Gelegenheit zum Laufen hätte.
2. In CSS (`src/web/styles.css`) verkürzt eine universelle
   Reduced-Motion-Regel jede CSS-Animation oder jeden Übergang, der
   trotzdem ausgelöst wird (Klapp-Schnappen, Stempelaufprall,
   Panel-Einblendungen, Toasts), auf praktisch Nulldauer — als
   Absicherung ohne Aufzählung pro Komponente.

Die Ansage erfolgt in beiden Fällen weiterhin: Die
`aria-live="assertive"`-Region in `SpinPage.tsx` ist dauerhaft gemountet,
ihr Text hängt an `announced`/`result`, nicht am Ende einer Animation —
reduzierte Bewegung überspringt nicht die Ansage, nur die Show davor.

## § 8 Hinweise je Visualisierung

| Visualisierung | Was sie in diesen Begriffen tut |
|---|---|
| **Rad** (`Wheel.tsx`) | Dreht über die JS-berechneten `ease()`-Kurven (§ 2a); ein „Kick” des Zeigers (22°-Impuls, klingt über 140 ms ab) wird bei jeder Segmentgrenzüberquerung ausgelöst (`lastSeg` startet bei `-1`, sodass das anfängliche, im ersten Animationsframe identifizierte Segment — noch vor jeder Grenzüberquerung — nie kickt) — ein günstiger, taktil wirkender Reiz pro Tick. Das Einrasten hängt vom gewählten `spinStyle` ab (§ 5). |
| **Split-Flap-Tafel** (`BoardStage`) | Jede Klappe schnappt binnen `--dur-indicator`; die Kacheln sind um `(i % 8) * 12`ms versetzt — 0 bis 84 ms über die ersten 8 jeder 16-Zellen-Zeile hinweg, danach wiederholt sich dieselbe 0–84-ms-Kaskade für die zweiten 8 —, sodass jede Zeile (es gibt zwei — die Zuständigkeits- und die Namenszeile, beide über denselben `cell`-Helfer aufgebaut) wie unabhängige Mechanismen statt wie ein neu gezeichneter String wirkt, wobei die Kaskade auf halber Strecke neu beginnt. |
| **Signal** (`SignalStage`) | Arm-/Lichtwechsel durchlaufen `--dur-latency`, bevor sie einrasten; ein Blinken antizipiert den finalen Stopp (§ 4), statt direkt auf Rot zu springen. |
| **Ticketstempel** (`StampStage`) | Anheben (Antizipation) → schneller Aufprall → überdimensionierte, dann eingerastete Tinte (§ 5), via `sr-stamp`. |
| **Zugeinfahrt** (`TrainStage`) | Nähert sich über eine vorn beschleunigende, dann abflachende kubische Bézier-Kurve, die sich als Bremsen liest; die Zielanzeige läuft während der gesamten Annäherung durch Namen und landet genau mit dem Halt des Zuges auf dem Gewinner, nicht erst danach. |
| **Fahrplan-Rolle** (`TimetableStage`) | Rollt über mehrere Extra-Umläufe, bevor sie auf der Ergebniszeile landet — gedämpfter Stopp über dieselbe Brems-Kurvenfamilie wie der Zug. |
| **Gewichtslinie** (`LineStage`) | Die Nadel schwenkt über dieselbe gedämpfte Stopp-Kurve zur Position des Gewinners und hält dort, sobald angesagt wurde. |

Rad, Zug, Fahrplan und Linie hatten gedämpfte Brems-Kurven bereits vor
dieser Verordnung; nur die Kaskaden-Verzögerung der Tafel, das
Antizipations-Blinken des Signals und der Anheben-Übergang des Stempels
wurden neu ergänzt.
