import { type FormEvent, useEffect, useState } from 'react';
import type { FairnessPolicy } from '../../domain/fairness/policy.ts';
import type { TeamView } from '../../server/views.ts';
import { api, errorMessage } from '../api.ts';

type Props = { team: TeamView; setTeam: (t: TeamView) => void; reload: () => Promise<void> };

export function FairnessPage({ team, setTeam }: Props) {
  const [policy, setPolicy] = useState<FairnessPolicy>(team.policy);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another browser may save meanwhile (SSE refreshes `team`). Follow along
  // while this form is untouched, so saving never overwrites with stale values.
  useEffect(() => {
    if (!dirty) setPolicy(team.policy);
  }, [team.policy, dirty]);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      setTeam(await api.changePolicy(team.teamId, policy));
      setDirty(false);
      setSaved(true);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const update = <K extends keyof FairnessPolicy>(key: K, patch: Partial<FairnessPolicy[K]>) => {
    setSaved(false);
    setDirty(true);
    setPolicy((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  };

  return (
    <>
      <h1>Fairness</h1>
      <p className="lede">
        Jede Gewichtsänderung steht hier. Gamification, Punkte und Auszeichnungen ändern nie
        Wahrscheinlichkeiten. Die tatsächlichen Gewichte jeder Ziehung sind im Nachweis
        festgeschrieben.
      </p>
      <p className="notice policy-summary">{fairnessSummary(policy, team)}</p>

      <form onSubmit={save} className="stack policy">
        <fieldset>
          <legend>
            <label>
              <input
                type="checkbox"
                checked={policy.pity.enabled}
                onChange={(e) => update('pity', { enabled: e.target.checked })}
              />{' '}
              Pity
            </label>
          </legend>
          <p className="field-status">{policy.pity.enabled ? 'Aktiv' : 'Aus'}</p>
          <p className="muted">Gewicht steigt pro Ziehung ohne Schuld seit der letzten Schuld.</p>
          <NumberField
            label="% pro Ziehung"
            value={policy.pity.percentPerSpin}
            onChange={(n) => update('pity', { percentPerSpin: n })}
            min={0}
            max={1000}
          />
        </fieldset>

        <fieldset>
          <legend>
            <label>
              <input
                type="checkbox"
                checked={policy.cooldown.enabled}
                onChange={(e) => update('cooldown', { enabled: e.target.checked })}
              />{' '}
              Cooldown
            </label>
          </legend>
          <p className="field-status">{policy.cooldown.enabled ? 'Aktiv' : 'Aus'}</p>
          <p className="muted">Wer zuletzt schuldig war, hat für N Ziehungen Gewicht 0.</p>
          <NumberField
            label="Ziehungen"
            value={policy.cooldown.spins}
            onChange={(n) => update('cooldown', { spins: n })}
            min={0}
            max={100}
          />
        </fieldset>

        <fieldset>
          <legend>
            <label>
              <input
                type="checkbox"
                checked={policy.exhaustion.enabled}
                onChange={(e) => update('exhaustion', { enabled: e.target.checked })}
              />{' '}
              Erschöpfung
            </label>
          </legend>
          <p className="field-status">{policy.exhaustion.enabled ? 'Aktiv' : 'Aus'}</p>
          <p className="muted">Gewicht sinkt pro Schuldspruch innerhalb der letzten N Ziehungen.</p>
          <div className="row">
            <NumberField
              label="% pro Schuld"
              value={policy.exhaustion.percentPerSelection}
              onChange={(n) => update('exhaustion', { percentPerSelection: n })}
              min={0}
              max={100}
            />
            <NumberField
              label="Fenster"
              value={policy.exhaustion.window}
              onChange={(n) => update('exhaustion', { window: n })}
              min={1}
              max={100}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <label>
              <input
                type="checkbox"
                checked={policy.newcomer.enabled}
                onChange={(e) => update('newcomer', { enabled: e.target.checked })}
              />{' '}
              Neuzugang
            </label>
          </legend>
          <p className="field-status">{policy.newcomer.enabled ? 'Aktiv' : 'Aus'}</p>
          <p className="muted">Faktor (1000 = 1×) für Mitglieder mit weniger als N Teilnahmen.</p>
          <div className="row">
            <NumberField
              label="Faktor"
              value={policy.newcomer.factor}
              onChange={(n) => update('newcomer', { factor: n })}
            />
            <NumberField
              label="Teilnahmen"
              value={policy.newcomer.spins}
              onChange={(n) => update('newcomer', { spins: n })}
              min={0}
              max={100}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend>
            <label>
              <input
                type="checkbox"
                checked={policy.manual.enabled}
                onChange={(e) => update('manual', { enabled: e.target.checked })}
              />{' '}
              Manuell
            </label>
          </legend>
          <p className="field-status">{policy.manual.enabled ? 'Aktiv' : 'Aus'}</p>
          <p className="muted">Expliziter Faktor je Mitglied (1000 = 1×, 0 = ausgeschlossen).</p>
          <div className="checks">
            {team.members.map((m) => (
              <NumberField
                key={m.memberId}
                label={m.name}
                value={policy.manual.factors[m.memberId] ?? 1000}
                onChange={(n) =>
                  update('manual', { factors: { ...policy.manual.factors, [m.memberId]: n } })
                }
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Immunität (immer aktiv)</legend>
          <p className="muted">
            Eine Immunität setzt das Gewicht bei der nächsten Ziehung auf 0 und wird dabei
            verbraucht. Vergabe unter „Teilnehmer“.
          </p>
        </fieldset>

        <div className="actions">
          <button type="submit" className="primary">
            Richtlinie speichern
          </button>
          {saved && <span className="chip ok">gespeichert</span>}
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>

      <section>
        <h2>So wird gezogen</h2>
        <ol className="protocol">
          <li>
            Der Server berechnet die Gewichte aller aktiven Teilnehmer nach dieser Richtlinie.
          </li>
          <li>
            Er erzeugt einen geheimen Server-Seed und veröffentlicht SHA-256(Seed, Nonce, Gewichte)
            als Commitment.
          </li>
          <li>Der Browser liefert einen Client-Seed, den der Server vorher nicht kannte.</li>
          <li>
            HMAC-SHA-256(Server-Seed, Commitment:Client-Seed:Nonce) bestimmt den Punkt auf der
            Gewichtslinie.
          </li>
          <li>
            Das Ergebnis wird gespeichert, dann erst dreht sich das Rad. Jede Ziehung ist im Browser
            nachrechenbar.
          </li>
        </ol>
      </section>
    </>
  );
}

export function fairnessSummary(policy: FairnessPolicy, team: TeamView): string {
  const parts: string[] = [];
  if (policy.pity.enabled) parts.push(`Pity +${policy.pity.percentPerSpin} %`);
  if (policy.cooldown.enabled) parts.push(`Cooldown ${policy.cooldown.spins}`);
  if (policy.exhaustion.enabled) {
    parts.push(`Erschöpfung -${policy.exhaustion.percentPerSelection} %`);
  }
  if (policy.newcomer.enabled) parts.push(`Neuzugang ${policy.newcomer.factor / 1000}×`);
  if (policy.manual.enabled) {
    const changed = Object.values(policy.manual.factors).filter((f) => f !== 1000).length;
    if (changed > 0) parts.push(`${changed} manuelle Anpassung${changed === 1 ? '' : 'en'}`);
  }
  if (team.immunities.length > 0) {
    parts.push(`${team.immunities.length} Immunität${team.immunities.length === 1 ? '' : 'en'}`);
  }
  return parts.length > 0
    ? `Beim nächsten Speichern aktiv: ${parts.join(', ')}.`
    : 'Keine optionalen Modifier aktiv. Alle aktiven Teilnehmer starten gleich gewichtet.';
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 10000,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field compact">
      <span className="label">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(e) => {
          // Guard against NaN ("e", "-", empty) and clamp to the field's range.
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isNaN(n) ? min : Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
}
