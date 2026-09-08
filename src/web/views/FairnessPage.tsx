import { type FormEvent, useEffect, useState } from 'react';
import type { FairnessPolicy } from '../../domain/fairness/policy.ts';
import type { TeamView } from '../../domain/views.ts';
import { api, errorMessage } from '../api.ts';
import { t as translate, useI18n } from '../i18n/index.ts';

type Props = { team: TeamView; setTeam: (t: TeamView) => void };

export function FairnessPage({ team, setTeam }: Props) {
  const { t } = useI18n();
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
      <h1>{t('fairness.title')}</h1>
      <p className="lede">{t('fairness.lede')}</p>
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
              {t('fairness.pity')}
            </label>
          </legend>
          <p className="field-status">{policy.pity.enabled ? t('common.on') : t('common.off')}</p>
          <p className="muted">{t('fairness.pityDesc')}</p>
          <NumberField
            label={t('fairness.percentPerSpinLabel')}
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
              {t('fairness.cooldown')}
            </label>
          </legend>
          <p className="field-status">
            {policy.cooldown.enabled ? t('common.on') : t('common.off')}
          </p>
          <p className="muted">{t('fairness.cooldownDesc')}</p>
          <NumberField
            label={t('fairness.spinsLabel')}
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
              {t('fairness.exhaustion')}
            </label>
          </legend>
          <p className="field-status">
            {policy.exhaustion.enabled ? t('common.on') : t('common.off')}
          </p>
          <p className="muted">{t('fairness.exhaustionDesc')}</p>
          <div className="row">
            <NumberField
              label={t('fairness.percentPerSelectionLabel')}
              value={policy.exhaustion.percentPerSelection}
              onChange={(n) => update('exhaustion', { percentPerSelection: n })}
              min={0}
              max={100}
            />
            <NumberField
              label={t('fairness.windowLabel')}
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
              {t('fairness.newcomer')}
            </label>
          </legend>
          <p className="field-status">
            {policy.newcomer.enabled ? t('common.on') : t('common.off')}
          </p>
          <p className="muted">{t('fairness.newcomerDesc')}</p>
          <div className="row">
            <NumberField
              label={t('fairness.factorLabel')}
              value={policy.newcomer.factor}
              onChange={(n) => update('newcomer', { factor: n })}
            />
            <NumberField
              label={t('fairness.participationsLabel')}
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
              {t('fairness.manual')}
            </label>
          </legend>
          <p className="field-status">{policy.manual.enabled ? t('common.on') : t('common.off')}</p>
          <p className="muted">{t('fairness.manualDesc')}</p>
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
          <legend>{t('fairness.immunityLegend')}</legend>
          <p className="muted">{t('fairness.immunityDesc')}</p>
        </fieldset>

        <div className="actions">
          <button type="submit" className="primary">
            {t('fairness.saveButton')}
          </button>
          {saved && <span className="chip ok">{t('fairness.savedChip')}</span>}
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>

      <section>
        <h2>{t('fairness.protocolHeading')}</h2>
        <ol className="protocol">
          <li>{t('fairness.protocol1')}</li>
          <li>{t('fairness.protocol2')}</li>
          <li>{t('fairness.protocol3')}</li>
          <li>{t('fairness.protocol4')}</li>
          <li>{t('fairness.protocol5')}</li>
        </ol>
      </section>
    </>
  );
}

/** Pure so it stays unit-testable outside React; uses the module-level `t`
 * directly since it has no component tree to subscribe from. */
export function fairnessSummary(policy: FairnessPolicy, team: TeamView): string {
  const t = translate;
  const parts: string[] = [];
  if (policy.pity.enabled) parts.push(t('fairness.summaryPity', { n: policy.pity.percentPerSpin }));
  if (policy.cooldown.enabled)
    parts.push(t('fairness.summaryCooldown', { n: policy.cooldown.spins }));
  if (policy.exhaustion.enabled) {
    parts.push(t('fairness.summaryExhaustion', { n: policy.exhaustion.percentPerSelection }));
  }
  if (policy.newcomer.enabled) {
    parts.push(t('fairness.summaryNewcomer', { n: policy.newcomer.factor / 1000 }));
  }
  if (policy.manual.enabled) {
    const changed = Object.values(policy.manual.factors).filter((f) => f !== 1000).length;
    if (changed > 0) {
      parts.push(
        changed === 1
          ? t('fairness.summaryManual.one')
          : t('fairness.summaryManual.many', { n: changed }),
      );
    }
  }
  if (team.immunities.length > 0) {
    parts.push(
      team.immunities.length === 1
        ? t('fairness.summaryImmunity.one')
        : t('fairness.summaryImmunity.many', { n: team.immunities.length }),
    );
  }
  return parts.length > 0
    ? t('fairness.summaryPrefix', { parts: parts.join(', ') })
    : t('fairness.summaryNone');
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
