English → [events.md](../en/events.md) (kanonisch)

> Diese Übersetzung wird separat gepflegt und kann der kanonischen
> englischen Fassung hinterherhinken.

# Event-Vertrag

*Schuldrad-Betriebsamt — Direktion für Aktenführung*

`src/domain/events.ts` definiert den persistierten Vertrag für Schuldrads
Event-Store. Dieses Dokument ist das Betriebsreglement zu diesem Vertrag:
was sich ändern darf, was sich nie ändern darf, und wie eine Migration
hinzugefügt wird, ohne bereits gespeicherte Historie zu brechen.

## § 1 Die 17 Event-Typen

Ein Event-Stream pro Team (`streamId` = Team-ID). Jedes Event trägt `type`,
seine typspezifische Nutzlast, `at` (ISO-8601-Zeitstempel) und — sobald
gespeichert — `streamId`, `version` (1-basiert, lückenlos pro Stream) und
`position` (global, monoton über alle Streams).

| # | Typ | Nutzlast |
|---|---|---|
| 1 | `TeamCreated` | `{ teamId, name }` |
| 2 | `MemberJoined` | `{ memberId, name }` |
| 3 | `MemberDeactivated` | `{ memberId }` |
| 4 | `MemberReactivated` | `{ memberId }` |
| 5 | `PoolCreated` | `{ poolId, name }` |
| 6 | `PoolMembershipChanged` | `{ poolId, memberIds }` |
| 7 | `PoolRenamed` | `{ poolId, name }` |
| 8 | `PoolDeleted` | `{ poolId }` |
| 9 | `FairnessPolicyChanged` | `{ policy }` |
| 10 | `SpinCommitted` | `{ spinId, poolId, nonce, commitment, participants: [{memberId, weight}], modifiers: [{name, factors}], serverSeed }` |
| 11 | `SpinRevealed` | `{ spinId, serverSeed, clientSeed, digest, selectedMemberId }` |
| 12 | `GuiltAppealed` | `{ spinId, reason }` |
| 13 | `AppealUpheld` | `{ spinId }` |
| 14 | `AppealRejected` | `{ spinId }` |
| 15 | `ImmunityGranted` | `{ memberId, reason }` |
| 16 | `ImmunityConsumed` | `{ memberId, spinId }` |
| 17 | `ImmunityRevoked` | `{ memberId }` |

Mitglieder werden nie gelöscht, nur deaktiviert/reaktiviert. Pools sind
löschbar, aber die Ziehungshistorie eines gelöschten Pools bleibt in den
Events erhalten, die auf ihn verweisen — das Löschen eines Pools entfernt
eine Gruppierung, keinen Datensatz.

## § 2 Unveränderlichkeitsregeln

Einmal angehängte Events sind historische Tatsache und werden nie editiert
oder gelöscht. Dies wird durch die Speicherschicht durchgesetzt
(`UNIQUE (stream_id, version)` plus reiner Append-Zugriff) sowie per
Konvention im Domänencode. Daraus folgen die Regeln:

1. **Der `type` eines gespeicherten Events wird nie umgedeutet.** Wenn sich
   Verhalten so ändern muss, dass sich die Bedeutung eines bereits
   gespeicherten Events dieses Typs ändern würde, ist das ein neuer
   Event-Typ, keine neue Bedeutung für den alten.
2. **Felder dürfen optional hinzukommen.** Ein neues optionales Feld ist
   sicher: alte Events haben es einfach nicht, und lesender Code muss das
   Fehlen als bedeutungsvoll behandeln (nicht als „fehlerhaft“).
3. **Felder werden nie entfernt oder umbenannt.** Ein Feld umzubenennen oder
   zu streichen ändert die Bedeutung alter, bereits persistierter Events,
   ohne deren Bytes zu ändern — das ist stille Korruption der Historie,
   schlimmer als ein Editierfehler, weil nichts einen Fehler wirft.
4. **Das Ergebnis eines Spins wird nie umgeschrieben.** Ein stattgegebener
   Einspruch (`AppealUpheld`) löscht oder ändert nicht `SpinCommitted`/
   `SpinRevealed`; er ist ein neues, darübergelegtes Event, das ändert, wie
   Projektionen den Spin *zählen* (ausgeschlossen aus
   Treffer-/Erwartungswert-Statistik — siehe [architektur.md](architektur.md)
   § 3), nicht was geschehen ist.

## § 3 Die Upcast-Nahtstelle

`upcast(event: DomainEvent): DomainEvent` in `src/domain/events.ts` ist die
**einzige** Stelle, an der alte, auf der Platte liegende Event-Formen an
den aktuellen In-Memory-Vertrag angepasst werden dürfen. Sie läuft einmal
pro Event beim Lesen aus dem Speicher, bevor `replay()` es in den Zustand
faltet. Zum jetzigen Zeitpunkt ist sie die Identitätsfunktion — seit v1 hat
sich nichts an der Form geändert —, existiert aber, damit eine künftige
Änderung genau eine Nahtstelle hat statt über jeden Leser verstreut zu
sein.

Was in `upcast` gehört und was nicht:

* **Gehört hinein:** einem alten Event einen Standardwert für ein Feld
  geben, das zur Zeit seiner Erstellung noch nicht existierte (z. B. ein
  neues optionales Feld, das Projektionen jetzt bedingungslos lesen —
  upcast füllt es, damit Projektionen nicht an jeder Aufrufstelle ein
  `?? default` brauchen).
* **Gehört nicht hinein:** Geschäftslogik, Validierung oder alles, was von
  anderen Events im Stream abhängt. `upcast` sieht ein einzelnes Event
  isoliert.

## § 4 Eine Migration hinzufügen

Eine „Migration“ hat hier zwei weitgehend unabhängige Ebenen: die
Domänen-Event-Form (`upcast`, § 3) und das Speicherschema (je nach
Dialekt, unten). Die meisten Änderungen brauchen nur eine davon.

### Domänenebene (Event-Form)

1. Das neue Feld als **optional** zur passenden Variante der
   `EventBody`-Union in `src/domain/events.ts` hinzufügen.
2. Die eventerzeugende Entscheidungsfunktion
   (`src/domain/decisions.ts` / `src/domain/fairness/spin.ts`) so ändern,
   dass sie das neue Feld künftig immer setzt.
3. Brauchen Projektionen das Feld auch für *alte* Events, `upcast` einen
   Fall für diesen Event-Typ geben, der einen Standardwert liefert.
4. Nie Typ oder Payload-Form eines in § 1 beschriebenen Events so ändern,
   dass sich die Bedeutung einer *alten, gespeicherten* Instanz ändert.

### Speicherebene: SQLite und Postgres

`src/server/migrations.ts` enthält eine nummerierte, nur anhängbare Liste.
Jeder Eintrag ist `{ id, sql, pgSql }` — `sql` läuft gegen SQLite, `pgSql`
gegen Postgres —, wird einmal in eigener Transaktion angewendet und in
`schema_migrations` protokolliert, damit er nie zweimal läuft. Jeder Dialekt
wird wörtlich ausgeschrieben; es gibt keine Umschreibung zwischen ihnen. Zum
Hinzufügen:

```ts
{
  id: '002_irgendwas',
  sql: `ALTER TABLE events ADD COLUMN irgendwas TEXT;`,
  pgSql: `ALTER TABLE events ADD COLUMN irgendwas TEXT;`,
}
```

Einen neuen Eintrag mit der nächsten Nummer anhängen. **Eine bereits
ausgelieferte Migration wird nie editiert** — eine Migration, die auf
verschiedenen Deployments unterschiedlich gelaufen ist, ist schlimmer als
eine, die nie gelaufen ist. War eine ausgelieferte Migration falsch, wird
eine korrigierende Migration ausgeliefert. Siehe `EVENT_STORE=postgres` in
[deployment.md](deployment.md) dazu, wie der Dialekt zur Laufzeit gewählt
wird.

## § 5 Warum kein Snapshotting?

Ein Team sammelt über seine Lebensdauer einige tausend Events an; SQLite
liest und faltet (`replay()`) das in Millisekunden. Es gibt kein
Snapshotting, also auch kein Snapshot-Invalidierungsproblem und keinen
Zustand „Projektion ist veraltet, neu aufbauen“ zu verwalten — eine
Projektion ist immer nur die pure Faltung des vollständigen Event-Streams.
„Projektion neu aufbauen“ heißt: Seite neu laden.
