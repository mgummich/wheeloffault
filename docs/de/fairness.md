English → [fairness.md](../en/fairness.md) (kanonisch)

> Diese Übersetzung wird separat gepflegt und kann der kanonischen
> englischen Fassung hinterherhinken.

# Fairness-Verordnung (Commit/Reveal)

*Schuldrad-Betriebsamt — Direktion für Zufallsauswahl*

Diese Verordnung regelt das Ziehungsverfahren, mit dem Verantwortung
zugewiesen wird. Sie ist bindend für den Server, den Browser-Verifier und
jeden Prüfer, der eine Ziehung von Hand nachrechnen möchte.

## § 1 Zweck

Eine Ziehung („Spin“) muss ein Ergebnis haben, das feststeht, *bevor* sich
das Rad dreht, und das im Nachhinein von jedem, der den veröffentlichten
Beweis besitzt, unabhängig nachgerechnet werden kann. Dies wird durch ein
zweiphasiges Commit/Reveal-Protokoll erreicht, nicht durch ein Rad nach dem
Prinzip „vertrau mir“.

## § 2 Teilnehmer und Gewichte

Vor einer Ziehung berechnet der Server:

1. **Teilnahmeberechtigte** — aktive Mitglieder des Teams, geschnitten mit
   dem gewählten Pool (oder alle aktiven Mitglieder, wenn kein Pool gewählt
   ist).
2. **Gewichte** — eine ganze Zahl pro Teilnehmer, Basis `1000` entspricht
   dem Faktor `1,000×` (`FACTOR_ONE` in `src/domain/fairness/modifiers.ts`).
   Jeder Teilnehmer startet bei `1000`; aktivierte Modifikatoren wirken in
   dieser festen Reihenfolge, jeweils auf eine ganze Zahl gerundet, bevor
   der nächste läuft:

   | Reihenfolge | Modifikator | Wirkung |
   |---|---|---|
   | 1 | `pity` | `+X %` pro Ziehung ohne Treffer seit der letzten Schuld dieses Mitglieds |
   | 2 | `cooldown` | Gewicht `0` für `N` Ziehungen nach einem Treffer. Würde dies alle ausschließen, wird cooldown nur für diese eine Ziehung übersprungen und für die betroffenen Mitglieder mit Faktor `1000` protokolliert |
   | 3 | `exhaustion` | `−X %` pro Treffer innerhalb der letzten `N` Ziehungen |
   | 4 | `newcomer` | `×Faktor` für Mitglieder mit weniger als `N` Teilnahmen |
   | 5 | `manual` | expliziter, von einem Bediener gesetzter Faktor pro Mitglied |
   | 6 | `immunity` | Gewicht `0`, wenn eine Immunität aktiv ist (wird durch diesen Spin verbraucht) |

   Die Modifikator-Reihenfolge ist Teil des Fairness-Vertrags: sie ist im
   Code fest verdrahtet (`modifierOrder` in `modifiers.ts`), nicht pro Team
   konfigurierbar, und jeder angewendete Faktor wird pro Teilnehmer im
   `SpinCommitted`-Event protokolliert — ein Prüfer sieht genau, warum jedes
   Gewicht so ausgefallen ist, wie es ausgefallen ist. Gamification
   (Achievements, Streaks, Schuldpunkte) ändert nie Gewichte; sie ist eine
   reine Lese-Auswertung über dieselbe Event-Historie.

## § 3 Commit

Der Server:

1. Zieht `serverSeed` — 32 Zufallsbytes aus `crypto.getRandomValues`.
2. Berechnet

   ```
   commitment = SHA256( canonicalJson({ serverSeed, nonce, participants }) )
   ```

   wobei `participants` das nach `memberId` sortierte Array `{ memberId,
   weight }` ist (stabile Reihenfolge, Teil dessen, was das Commitment
   bindet), `nonce` der 1-basierte Index dieses Spins in der Team-Historie
   ist und `canonicalJson` mit sortierten Objektschlüsseln serialisiert,
   damit beide Seiten des Protokolls identische Bytes hashen
   (`src/domain/fairness/draw.ts`).
3. Persistiert `SpinCommitted { commitment, nonce, participants, modifiers,
   serverSeed, poolId, spinId }`.

Der `serverSeed` liegt im Event selbst — sonst könnte ein Commit, der vor
dem Reveal abstürzt, nach einem Neustart nie fortgesetzt werden — wird aber
vor dem passenden `SpinRevealed` nie über HTTP ausgeliefert
(`src/domain/views.ts` entfernt ihn). Das Commitment hingegen ist sofort
öffentlich: genau das erlaubt es, nach dem Reveal zu bestätigen, dass der
Server seinen Seed nicht passend zu einem gewünschten Ergebnis wählen
konnte.

## § 4 Reveal

1. Der Client liefert `clientSeed` — ein beliebiger String; die
   Oberfläche setzt standardmäßig 16 Zufallsbytes, hex-kodiert.
2. Der Server berechnet

   ```
   digest = HMAC-SHA256(key = serverSeed, message = `${commitment}:${clientSeed}:${nonce}`)
   ```

3. **Auswahl.** Die ersten 64 Bit von `digest` (`digest[0..16]` als Hex,
   also die ersten 8 Bytes), als vorzeichenlose Ganzzahl interpretiert,
   werden modulo der Summe aller Gewichte reduziert. Die Teilnehmer werden
   in `memberId`-Reihenfolge durchlaufen und die Gewichte aufsummiert; der
   erste Teilnehmer, dessen kumuliertes Gewicht den reduzierten Wert
   übersteigt, wird ausgewählt. Das ist die „kumulative Gewichtslinie“:
   jeder Teilnehmer besitzt ein Intervall proportional zu seinem Gewicht,
   und der reduzierte Digest wählt einen Punkt auf dieser Linie.
4. Der Server persistiert `SpinRevealed { serverSeed, clientSeed, digest,
   selectedMemberId }`, und die Animation fährt zu diesem bereits
   feststehenden Ergebnis — das Rad „entscheidet“ nie etwas, es
   dramatisiert eine bereits gefallene Entscheidung.

## § 5 Verifikation

`verifySpin()` in `src/domain/fairness/draw.ts` berechnet Commitment,
Digest und Auswahl aus einem veröffentlichten Beweis neu und vergleicht sie
mit den persistierten Werten. Dies ist exakt dieselbe Funktion, die vom
Server und vom Web-Crypto-basierten Verifier im Browser genutzt wird — es
gibt keine separate, möglicherweise abweichende Client-Implementierung zu
prüfen. Drei Prüfungen, alle müssen bestehen:

* `commitmentMatches` — der veröffentlichte `serverSeed`, `nonce` und
  `participants` hashen zum veröffentlichten `commitment`.
* `digestMatches` — HMAC des veröffentlichten `commitment`, `clientSeed`
  und `nonce`, mit dem veröffentlichten `serverSeed` als Schlüssel, ergibt
  den veröffentlichten `digest`.
* `selectionMatches` — die Auswahlregel aus § 4, angewendet auf den
  veröffentlichten `digest` und die `participants`, ergibt die
  veröffentlichte `selectedMemberId`.

## § 6 Was dieses Protokoll beweist — und was nicht

**Beweist:** Bei einem veröffentlichten Commitment konnte der Server keinen
`serverSeed` erst nach Kenntnis des `clientSeed` wählen, um das Ergebnis zu
steuern — das Commitment stand zuerst fest. Es beweist außerdem, dass das
veröffentlichte Ergebnis tatsächlich aus den veröffentlichten Seeds
berechnet wurde und nicht nachträglich ausgetauscht wurde; und weil Events
unveränderlich sind (siehe [events.md](events.md) § 2), kann ein
gespeicherter Commit oder Reveal im Nachhinein nicht unbemerkt editiert
werden — eine Änderung an `serverSeed`, `nonce` oder einem Teilnehmer-
Gewicht bricht die Commitment-Prüfung *dieses einen Spins*. Das ist
Manipulationssicherheit pro Datensatz, keine Hash-Kette über die gesamte
Event-Historie: Jedes Commitment bindet nur seinen eigenen Spin, nicht den
vorangegangenen.

**Beweist nicht, § 6a — statischer Modus (GitHub Pages).** Im statischen
Modus gibt es keinen Server. Die „Server“-Rolle — `serverSeed` erzeugen,
Commitment berechnen, beides speichern — läuft im selben Browser-Tab wie
der Teilnehmer, der später verifiziert, mit demselben Event-Store
(`src/web/sessionApi.ts`, `localStorage`). Vor dem Reveal liegt der Seed im
Speicher desselben Browsers wie die Partei, gegen die gezogen wird.
Commit/Reveal im statischen Modus ist **selbstprüfendes Theater**: es
beweist, dass die Mathematik in sich konsistent ist, und es hindert eine
Browser-Erweiterung oder einen neugierigen Teamkollegen, der in die
DevTools-Konsole schaut, daran, die Ziehung während des Ablaufs zu
„erraten“, indem ein bereits vor dem Hinsehen feststehender Seed gelesen
wird — es schützt aber niemanden vor der Person, die den Browser bedient.
Wer Betreiber ist und zugleich den Browser kontrolliert, der den Commit
ausgeführt hat, könnte im Prinzip einen ungünstigen `serverSeed` vor dem
Reveal einsehen oder verwerfen. Der statische Modus ist fair *gegenüber
Zuschauern*, nicht gegenüber seinem eigenen Betreiber. Der Serverbetrieb
schließt diese Lücke: Der Seed liegt in einer Datenbank, die die Teilnehmer
nicht kontrollieren (siehe [deployment.md](deployment.md) und
[SECURITY.md](../../SECURITY.md)).

**Beweist nicht, § 6b — Modulo-Bias.** Die Reduktion eines 64-Bit-Werts
modulo einer Gewichtssumme führt zu einer kleinen Verzerrung zugunsten
niedriger Reste, wenn die Gewichtssumme 2⁶⁴ nicht glatt teilt: Ergebnisse
knapp oberhalb des letzten vollen Vielfachen der Gewichtssumme sind
unerreichbar, sodass die Teilnehmer mit den am niedrigsten liegenden
Intervallen auf der kumulativen Gewichtslinie geringfügig häufiger gezogen
werden. Bei realistischen Gewichtsgrößen (Gewichte in der Größenordnung von
`1000` pro Teilnehmer, Teams von einstelliger bis niedriger zweistelliger
Mitgliederzahl, Summen also selten über wenigen hunderttausend gegenüber
einem 2⁶⁴-Modulus) ist diese Verzerrung kleiner als ein Teil in 10¹⁴ —
vernachlässigbar gegenüber der Rundungsungenauigkeit jeder von Hand
berechneten Statistik und um Größenordnungen kleiner als die absichtliche
Verzerrung, die § 2s Modifikatoren bewusst einführen. Sie wird hier
offengelegt, nicht verschwiegen, weil „vernachlässigbar“ eine überprüfbare
Aussage sein soll, keine bloße Behauptung.

## § 7 Invarianten

Durchgesetzt durch deterministische und property-basierte Tests
(`src/domain/fairness/*.test.ts`):

```
gleiche Eingaben        = gleiches Ergebnis
inaktives Mitglied      = kann nicht gezogen werden
Gewicht 0               = kann nicht gezogen werden
Gewichte endlich, ≥ 0
alle Gewichte 0         = Fehler, kein Spin
Teilnehmerreihenfolge   stabil
Modifikatorreihenfolge  deterministisch (feste Liste in modifiers.ts)
Commitment bindet Seed + Gewichte
Reveal reproduziert Commitment
Browser-Verifier reproduziert Server
```

## § 8 Eigenständige Verifikation

Wer die veröffentlichten Werte einer Ziehung besitzt — `nonce`,
`commitment`, `participants`, `serverSeed`, `clientSeed`, `digest`,
`selectedMemberId`, alle auf der Detailseite dieses Spins angezeigt
(`src/web/views/SpinDetailPage.tsx`) — kann die gesamte Ziehung nachrechnen,
ohne Schuldrad überhaupt zu betreiben, mit `scripts/verify-draw.mjs`. Es
ist ein abhängigkeitsfreies Node-Skript, das § 3–§ 4 dieser Verordnung
eigenständig nachbildet; es importiert `src/domain/fairness/draw.ts` nicht,
kann also keinen Fehler der geprüften Anwendung stillschweigend erben.

Die auf der Detailseite angezeigten Werte in eine JSON-Datei kopieren:

```json
{
  "serverSeed": "…",
  "clientSeed": "…",
  "nonce": 0,
  "participants": [{ "memberId": "…", "weight": 1000 }],
  "commitment": "…",
  "digest": "…",
  "selectedMemberId": "…"
}
```

Dann ausführen:

```
node scripts/verify-draw.mjs --file draw.json
# oder: pnpm verify:draw -- --file draw.json
```

Die Werte können statt `--file` auch einzeln als Flags übergeben werden:
`--server-seed`, `--client-seed`, `--nonce`, `--participants '<json>'`,
`--commitment`, `--digest`, `--selected-member-id`. Das Skript gibt ein
Prüfprotokoll mit je einer ✓/✗-Zeile pro Prüfung aus — Commitment, Digest,
Auswahl — und liefert Exit-Code `0` nur, wenn alle drei bestehen, sonst `1`;
lässt sich also in CI oder eine Shell-`&&`-Kette einbinden.
