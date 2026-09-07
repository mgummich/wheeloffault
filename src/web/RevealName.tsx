import type { AnnounceFx } from './animSettings.ts';

/** The five "Ansage" animations for the winner's name. Decorative: the
 * accessible name lives in the announcement's live region. */
export function RevealName({
  name,
  mode,
  spinId,
}: {
  name: string;
  mode: AnnounceFx;
  spinId: string;
}) {
  if (mode === 'flap')
    return (
      <span key={spinId} className="reveal-flap" aria-hidden="true">
        {[...name].map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: characters have no identity beyond their position.
          <span key={i} style={{ animationDelay: `${i * 45}ms`, minWidth: c === ' ' ? '.3em' : 0 }}>
            {c}
          </span>
        ))}
      </span>
    );
  if (mode === 'type')
    return (
      <span key={spinId} className="reveal-type" aria-hidden="true">
        {[...name].map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: characters have no identity beyond their position.
          <span key={i} style={{ animationDelay: `${i * 70}ms` }}>
            {c}
          </span>
        ))}
        <span className="reveal-caret" />
      </span>
    );
  if (mode === 'flicker')
    return (
      <span key={spinId} className="reveal-flicker" aria-hidden="true">
        {name.toUpperCase()}
      </span>
    );
  if (mode === 'stamp')
    return (
      <span key={spinId} className="reveal-stamp" aria-hidden="true">
        {name}
      </span>
    );
  return (
    <span key={spinId} className="reveal-rise" aria-hidden="true">
      {name}
    </span>
  );
}
