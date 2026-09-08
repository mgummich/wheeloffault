import { useState } from 'react';
import { t } from './i18n/index.ts';

export type Vis = 'wheel' | 'train' | 'board' | 'signal' | 'stamp' | 'timetable' | 'line';
export type WheelStyle = 'db' | 'bunt' | 'nacht' | 'pastell';
export type SpinStyle = 'standard' | 'overshoot' | 'windup' | 'lang' | 'stopp';
export type ResultFx = 'pop' | 'slide' | 'drop' | 'flash' | 'shake' | 'none';
/** Animation of the winner's name in the announcement ("Ansage"). */
export type AnnounceFx = 'rise' | 'flap' | 'type' | 'flicker' | 'stamp';

export type AnimSettings = {
  vis: Vis;
  wheelStyle: WheelStyle;
  spinStyle: SpinStyle;
  resultFx: ResultFx;
  reveal: AnnounceFx;
  tickSound: boolean;
  autoShare: boolean;
};

export const defaultAnimSettings: AnimSettings = {
  vis: 'wheel',
  wheelStyle: 'db',
  spinStyle: 'standard',
  resultFx: 'pop',
  reveal: 'rise',
  tickSound: false,
  autoShare: false,
};

const KEY = 'schuldrad.anim';

// Durable preferences: localStorage, so they survive new tabs and sessions.
function load(): AnimSettings {
  try {
    return { ...defaultAnimSettings, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return defaultAnimSettings;
  }
}

export function useAnimSettings(): [AnimSettings, (patch: Partial<AnimSettings>) => void] {
  const [settings, setSettings] = useState<AnimSettings>(load);
  const update = (patch: Partial<AnimSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  return [settings, update];
}

export function visLabel(vis: Vis): string {
  return t(`anim.vis.${vis}`);
}

function visShort(vis: Vis): string {
  return t(`anim.visShort.${vis}`);
}

function wheelShort(style: WheelStyle): string {
  return t(`anim.wheelShort.${style}`);
}

export function animSummary(s: AnimSettings): string {
  return visShort(s.vis) + (s.vis === 'wheel' ? ` · ${wheelShort(s.wheelStyle)}` : '');
}
