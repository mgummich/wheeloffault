import { type AnimSettings, visLabels } from './animSettings.ts';

type Props = {
  settings: AnimSettings;
  updateSettings: (patch: Partial<AnimSettings>) => void;
};

/** The expandable settings panel below the "Animation" toggle on the spin page. */
export function AnimPanel({ settings, updateSettings }: Props) {
  return (
    <div id="sr-anim-panel" className="anim-panel">
      <label className="field">
        <span>Darstellung</span>
        <select
          value={settings.vis}
          onChange={(e) => updateSettings({ vis: e.target.value as typeof settings.vis })}
        >
          {Object.entries(visLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {settings.vis === 'wheel' && (
        <>
          <label className="field">
            <span>Rad-Stil</span>
            <select
              value={settings.wheelStyle}
              onChange={(e) =>
                updateSettings({ wheelStyle: e.target.value as typeof settings.wheelStyle })
              }
            >
              <option value="db">Bahn (grau)</option>
              <option value="bunt">Bunt &amp; Konfetti</option>
              <option value="nacht">Nachtzug</option>
              <option value="pastell">Pastell</option>
            </select>
          </label>
          <label className="field">
            <span>Drehung</span>
            <select
              value={settings.spinStyle}
              onChange={(e) =>
                updateSettings({ spinStyle: e.target.value as typeof settings.spinStyle })
              }
            >
              <option value="standard">Ausrollen</option>
              <option value="overshoot">Überschwingen</option>
              <option value="windup">Anlauf rückwärts</option>
              <option value="lang">Lange Fahrt</option>
              <option value="stopp">Schnellstopp</option>
            </select>
          </label>
        </>
      )}
      <label className="field">
        <span>Ergebnis</span>
        <select
          value={settings.resultFx}
          onChange={(e) => updateSettings({ resultFx: e.target.value as typeof settings.resultFx })}
        >
          <option value="pop">Einblenden</option>
          <option value="slide">Einfahren</option>
          <option value="drop">Fallen</option>
          <option value="flash">Rot aufblitzen</option>
          <option value="shake">Rütteln</option>
          <option value="none">Ohne</option>
        </select>
      </label>
      <label className="field">
        <span>Ansage</span>
        <select
          value={settings.reveal}
          onChange={(e) => updateSettings({ reveal: e.target.value as typeof settings.reveal })}
        >
          <option value="rise">Aufsteigen</option>
          <option value="flap">Fallblatt</option>
          <option value="type">Schreibmaschine</option>
          <option value="flicker">Leuchtanzeige</option>
          <option value="stamp">Stempel</option>
        </select>
      </label>
      <div className="field">
        <span>Teams-Karte</span>
        <button
          type="button"
          role="switch"
          aria-checked={settings.autoShare}
          className="switch"
          onClick={() => updateSettings({ autoShare: !settings.autoShare })}
        >
          <span>Automatisch öffnen</span>
          <span className={`track${settings.autoShare ? ' on' : ''}`} aria-hidden="true">
            <span className="knob" />
          </span>
        </button>
      </div>
      {settings.vis === 'wheel' && (
        <div className="field">
          <span>Ton</span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.tickSound}
            className="switch"
            onClick={() => updateSettings({ tickSound: !settings.tickSound })}
          >
            <span>Ticken</span>
            <span className={`track${settings.tickSound ? ' on' : ''}`} aria-hidden="true">
              <span className="knob" />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
