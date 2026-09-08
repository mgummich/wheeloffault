import { type AnimSettings, type Vis, visLabel } from './animSettings.ts';
import { useI18n } from './i18n/index.ts';

type Props = {
  settings: AnimSettings;
  updateSettings: (patch: Partial<AnimSettings>) => void;
};

// A Record<Vis, true> fails to compile if a Vis variant is missing (or a
// stale one lingers) — the dropdown's option list can't silently drift
// from the Vis union.
const visOptionSet = {
  wheel: true,
  train: true,
  board: true,
  signal: true,
  stamp: true,
  timetable: true,
  line: true,
} satisfies Record<Vis, true>;
const visOptions = Object.keys(visOptionSet) as Vis[];

/** The expandable settings panel below the "Animation" toggle on the spin page. */
export function AnimPanel({ settings, updateSettings }: Props) {
  const { t } = useI18n();
  return (
    <div id="sr-anim-panel" className="anim-panel">
      <label className="field">
        <span>{t('anim.visLabel')}</span>
        <select
          value={settings.vis}
          onChange={(e) => updateSettings({ vis: e.target.value as typeof settings.vis })}
        >
          {visOptions.map((value) => (
            <option key={value} value={value}>
              {visLabel(value)}
            </option>
          ))}
        </select>
      </label>
      {settings.vis === 'wheel' && (
        <>
          <label className="field">
            <span>{t('anim.wheelStyleLabel')}</span>
            <select
              value={settings.wheelStyle}
              onChange={(e) =>
                updateSettings({ wheelStyle: e.target.value as typeof settings.wheelStyle })
              }
            >
              <option value="db">{t('anim.wheelStyle.db')}</option>
              <option value="bunt">{t('anim.wheelStyle.bunt')}</option>
              <option value="nacht">{t('anim.wheelStyle.nacht')}</option>
              <option value="pastell">{t('anim.wheelStyle.pastell')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('anim.spinStyleLabel')}</span>
            <select
              value={settings.spinStyle}
              onChange={(e) =>
                updateSettings({ spinStyle: e.target.value as typeof settings.spinStyle })
              }
            >
              <option value="standard">{t('anim.spinStyle.standard')}</option>
              <option value="overshoot">{t('anim.spinStyle.overshoot')}</option>
              <option value="windup">{t('anim.spinStyle.windup')}</option>
              <option value="lang">{t('anim.spinStyle.lang')}</option>
              <option value="stopp">{t('anim.spinStyle.stopp')}</option>
            </select>
          </label>
        </>
      )}
      <label className="field">
        <span>{t('anim.resultFxLabel')}</span>
        <select
          value={settings.resultFx}
          onChange={(e) => updateSettings({ resultFx: e.target.value as typeof settings.resultFx })}
        >
          <option value="pop">{t('anim.resultFx.pop')}</option>
          <option value="slide">{t('anim.resultFx.slide')}</option>
          <option value="drop">{t('anim.resultFx.drop')}</option>
          <option value="flash">{t('anim.resultFx.flash')}</option>
          <option value="shake">{t('anim.resultFx.shake')}</option>
          <option value="none">{t('anim.resultFx.none')}</option>
        </select>
      </label>
      <label className="field">
        <span>{t('anim.revealLabel')}</span>
        <select
          value={settings.reveal}
          onChange={(e) => updateSettings({ reveal: e.target.value as typeof settings.reveal })}
        >
          <option value="rise">{t('anim.reveal.rise')}</option>
          <option value="flap">{t('anim.reveal.flap')}</option>
          <option value="type">{t('anim.reveal.type')}</option>
          <option value="flicker">{t('anim.reveal.flicker')}</option>
          <option value="stamp">{t('anim.reveal.stamp')}</option>
        </select>
      </label>
      <div className="field">
        <span>{t('anim.autoShareLabel')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.autoShare}
          className="switch"
          onClick={() => updateSettings({ autoShare: !settings.autoShare })}
        >
          <span>{t('anim.autoShareSwitch')}</span>
          <span className={`track${settings.autoShare ? ' on' : ''}`} aria-hidden="true">
            <span className="knob" />
          </span>
        </button>
      </div>
      {settings.vis === 'wheel' && (
        <div className="field">
          <span>{t('anim.tickSoundLabel')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.tickSound}
            className="switch"
            onClick={() => updateSettings({ tickSound: !settings.tickSound })}
          >
            <span>{t('anim.tickSoundSwitch')}</span>
            <span className={`track${settings.tickSound ? ' on' : ''}`} aria-hidden="true">
              <span className="knob" />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
