English → [motion.md](../en/motion.md) (kanonisch)

> Diese Übersetzung wird separat gepflegt und kann der kanonischen
> englischen Fassung hinterherhinken.

# Bewegungs-Verordnung

*Schuldrad-Betriebsamt — Direktion für Signal- und Fahrzeugwesen*

Diese Verordnung regelt, wie das bereits feststehende Ergebnis einer
Ziehung der Plattform *gezeigt* wird. Sie bindet jede Visualisierung
(`src/web/wheel/Wheel.tsx`, `src/web/wheel/stages.tsx`) und die
anschließende Ansage (`src/web/RevealName.tsx`).

## § 1 Zweck und unantastbare Reihenfolge

Bewegung ist Dekoration. Sie entscheidet nie etwas.

Der Gewinner steht durch das Commit/Reveal-Protokoll
(`docs/de/fairness.md`) fest, bevor auch nur ein Bild gezeichnet wird: Der
Server bindet sich an Seed und Gewichte, deckt dann ein Ergebnis auf, und
erst *danach* schaltet `SpinPage.draw()` (`src/web/views/SpinPage.tsx`) die
Phase auf `animating` — mit dem bereits bekannten Ergebnis in der Hand
(`src/web/draw.ts` → `performDraw`). Jede Visualisierung erhält das fertige
`result` als Prop beim Mounten und verbringt die folgenden Sekunden damit,
es *aufzuführen* — ein Rad bis zum Gewinnsegment drehen, einen Fahrplan bis
zur Gewinnzeile rollen, eine Nadel bis zur Gewinnposition schwenken. Keine
davon wählt etwas aus. Sollte diese Reihenfolge jemals umgekehrt werden —
sollte der eigene Zufall oder das Timing einer Visualisierung jemals
beeinflussen, wer gewinnt — ist das ein Fairness-Vorfall, kein
Bewegungsfehler.

## § 2 Dauerskala

| Stufe | Token | Bereich | Verwendung |
|---|---|---|---|
| Indikator | `--dur-indicator` | 150–180ms | Klapp-/Tick-Schnappen, Zeichen-für-Zeichen-Ansagen |
| Mechanische Latenz | `--dur-latency` | 120ms | Steuerungsquittung (Signalumschaltung, Hover-/Press-Feedback) |
| Mechanisches Einrasten | `--dur-settle` | 240–400ms | Stempelaufprall, Radsegment-Hervorhebung, Panel-Einblendung |
| Theatralische Enthüllung | `DURATION_MS` (`src/web/wheel/anim.ts`) | 6,5s | die gesamte Ziehungs-Aufführung, vom Commit bis zur Ansage |

Die theatralische Enthüllung ist eine einzige Konstante, die sich alle
sechs Nicht-Rad-Visualisierungen und die Spin-Dauer des Rades teilen —
damit fühlen sich alle sieben gleich lang an ("der Zug entscheidet noch"):
ein Wechsel der Visualisierung darf sich nicht auf das Zeitgefühl einer
Ziehung auswirken.

## § 2a Easing-Tokens

Definiert in `src/web/styles.css` unter `:root`:

- `--ease-mechanical` (`cubic-bezier(.2,.8,.2,1)`) — scharfer Antritt,
  gedämpftes Einrasten. Der Standard für alles, was "ankommt": Panels,
  Stempel, Verzierungen.
- `--ease-damped` (`cubic-bezier(.3,.7,.3,1)`) — langsamerer Antritt,
  schwebendes Einrasten. Für schwerere Objekte, die landen (Dialoge,
  Drop-ins).
- `--ease-sharp` (`cubic-bezier(.4,0,.2,1)`) — entschieden, ohne
  Nachschwingen. Für Schnapp-Bewegungen und Quittungen.

Keines davon ist eine Feder-/Bounce-Kurve. Ein Bahnrelais schwingt nicht
nach, bevor es einrastet — es klackt in Position und bleibt dort. Wo
Überschwingen verwendet wird (§ 5), geschieht das über eine explizite
Zweiphasenkurve (über das Ziel hinaus, dann zurück), nie als physikalische
Feder-Simulation.

Die Spin-Easing-Kurven des Rades selbst leben im Code, nicht in CSS, weil
sie für die SVG-Rotation bei jedem Frame neu berechnet werden müssen:
`ease(style, t)` in `src/web/wheel/anim.ts`, getestet in `anim.test.ts`.
Ihre Kurven sind das kanonische "mechanische" Vokabular dieser Verordnung:

- `standard` — reine gedämpfte kubische Ease-out-Kurve ohne Überschwingen:
  die Standardkurve "das Rad dreht sich aus wie ein Rad".
- `overshoot` — schießt über das Ziel hinaus und pendelt zurück, siehe § 5.
- `windup` — schwingt zunächst rückwärts (Antizipation, § 4), dann
  vorwärts.
- `stopp` — exponentieller Abfall, liest sich als harte mechanische
  Bremsung.
- `lang` — die Standardkurve über die doppelte Distanz (kein anderes
  Gefühl, nur längere effektive Strecke).

## § 3 Mechanische Latenz

Ein echtes Relais-Stellwerk schaltet ein Signal nicht in dem Moment um, in
dem der Hebel gezogen wird — es gibt einen Takt, bis der Mechanismus
nachzieht. `--dur-latency` (120ms) ist dieser Takt: Der
Arm-/Licht-Hintergrundübergang in `SignalStage` nutzt ihn, damit das Licht
nicht zwischen Zuständen teleportiert.

## § 4 Antizipation

Ein kurzer Vorlauf vor einer großen Enthüllung liest sich physikalisch,
nicht fehlerhaft:

- Der `windup`-Spin-Stil des Rades schwingt vor dem eigentlichen Vorwärts-
  Spin rund 3,5° zurück (Fall `windup` in `ease()`).
- `SignalStage` blinkt den heißen Indikator (nutzt das bestehende
  `.blink`-Keyframe), solange ein Name noch durchläuft, bevor der finale
  Stopp-Zustand einrastet — ein Warnblinken vor dem soliden Rot.
- `StampStage` hebt das heiße Ticket kurz an, bevor der Stempel fällt — ein
  expliziter Vorlauf statt einer Transform, die nur beim Aufprall animiert.

## § 5 Einrasten (Überschwingen + gedämpfte Rückkehr)

Wo eine Visualisierung ein physisches, zur Ruhe kommendes Objekt
modelliert, schwingt sie über und pendelt gedämpft zurück, statt abrupt
zu stoppen:

- Der `overshoot`-Spin-Stil des Rades überfährt das Gewinnsegment und
  schwingt zurück (kubische Überschwing-Formel in `ease()`).
- Der Ticketstempel (`sr-stamp`/`sr-stampin`-Keyframes) landet überdimensioniert,
  staucht sich unter 1× und rastet dann ein — Tintengewicht, das aufs
  Papier trifft.
- Die Standard-Radkurve (`standard`) ist ein gedämpftes Ease-out *ohne*
  Überschwingen: Nicht jede Visualisierung braucht ein Federn, und ein
  erzwungenes Federn überall würde sich wie eine Cartoon-Feder statt wie
  ein Bahnmechanismus lesen.

## § 6 Abbruch

"Überspringen" (`data-testid="skip-animation"`, `spin.skipButton`) spult
eine laufende Animation weder zurück noch pausiert oder beschleunigt es
sie — es rastet sofort im bereits feststehenden Ergebnis ein:

- `SpinPage.finish()` schaltet die Phase direkt auf `announced`.
- `Wheel.tsx` besitzt einen an `announced` gebundenen Effekt, der die
  `rotation` — falls die Spin-Schleife noch läuft — sofort auf das
  vorab berechnete Ziel setzt und `finished` markiert: Der nächste Frame
  zeigt die finale Pose, keine interpolierte.
- Jede andere Bühne leitet `currentId` in ihrem `useNameTicker` zuerst aus
  `announced` ab: Sobald angesagt wurde, *ist* der angezeigte Name
  `result.reveal.selectedMemberId`, unabhängig davon, welchen Tick die
  RAF-Schleife erreicht hatte. Es gibt keinen Rückspul-Pfad — ein Abbruch
  springt immer nur vorwärts zum feststehenden Endzustand.

## § 7 Reduzierte Bewegung

`prefers-reduced-motion: reduce` erhält ein sofortiges Ergebnis, kein
schnelles. Zwei Ebenen setzen das durch (`src/web/styles.css`):

1. Jede Visualisierung prüft `reduced` zu Beginn ihrer eigenen
   RAF-Schleife und ruft `finish()`/`onFinished()` synchron statt Frames
   zu planen — sowohl der Spin-Effekt in `Wheel.tsx` als auch
   `useNameTicker` in `stages.tsx` tun das, sodass `animating` bereits
   `false` ist, bevor ein CSS-Übergang/-Animation überhaupt Gelegenheit
   zum Laufen hätte.
2. Eine universelle Reduced-Motion-Regel kollabiert jede CSS-Animation
   oder jeden Übergang, der trotzdem feuert (Klapp-Schnappen,
   Stempelaufprall, Panel-Einblendungen, Toasts), auf praktisch
   Nulldauer — als Absicherung ohne Aufzählung pro Komponente.

Die Ansage erfolgt in beiden Fällen weiterhin: Die
`aria-live="assertive"`-Region in `SpinPage.tsx` ist dauerhaft gemountet,
ihr Text hängt an `announced`/`result`, nicht am Ende einer Animation —
reduzierte Bewegung überspringt nicht die Ansage, nur die Show davor.

## § 8 Hinweise je Visualisierung

| Visualisierung | Was sie in diesen Begriffen tut |
|---|---|
| **Rad** (`Wheel.tsx`) | Dreht über die JS-berechneten `ease()`-Kurven (§ 2a); ein "Kick" des Zeigers (22°-Impuls, klingt über 140ms ab) feuert bei jeder Segmentgrenze — ein günstiger, taktil wirkender Reiz pro Tick. Das Einrasten hängt vom gewählten `spinStyle` ab (§ 5). |
| **Split-Flap-Tafel** (`BoardStage`) | Jede Klappe schnappt binnen `--dur-indicator`; die Kacheln sind von links nach rechts leicht zeitversetzt, sodass die Zeile wie eine Kaskade unabhängiger Mechanismen wirkt, nicht wie ein neu gezeichneter String. |
| **Signal** (`SignalStage`) | Arm-/Lichtwechsel durchlaufen `--dur-latency`, bevor sie einrasten; ein Blinken antizipiert den finalen Stopp (§ 4), statt direkt auf Rot zu springen. |
| **Ticketstempel** (`StampStage`) | Anheben (Antizipation) → schneller Aufprall → überdimensionierte, dann eingerastete Tinte (§ 5), via `sr-stamp`. |
| **Zugeinfahrt** (`TrainStage`) | Nähert sich über eine vorn beschleunigende, dann abflachende kubische Bezierkurve, die sich als Bremsen liest; der Name löst sich erst nach dem vollständigen Halt auf. |
| **Fahrplan-Rolle** (`TimetableStage`) | Rollt über mehrere Extra-Umläufe, bevor sie auf der Ergebniszeile landet — gedämpfter Stopp über dieselbe Brems-Kurvenfamilie wie der Zug. |
| **Gewichtslinie** (`LineStage`) | Die Nadel schwenkt über dieselbe gedämpfte Stopp-Kurve zur Position des Gewinners und hält dort, sobald angesagt wurde. |

Rad, Zug, Fahrplan und Linie hatten gedämpfte Brems-Kurven bereits vor
dieser Verordnung; nur die Kaskaden-Verzögerung der Tafel, das
Antizipations-Blinken des Signals und der Anheben-Übergang des Stempels
wurden neu ergänzt.
