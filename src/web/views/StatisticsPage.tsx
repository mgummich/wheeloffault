import type { TeamView } from '../../server/views.ts';
import { dateTime, num, num2, relativeTime } from '../format.ts';
import { href } from '../route.ts';

export function StatisticsPage({ team }: { team: TeamView }) {
  const stats = team.statistics;
  const maxSelections = Math.max(
    1,
    ...stats.hallOfShame.map((r) => Math.max(r.totalSelections, r.expectedSelections)),
  );

  return (
    <>
      <h1>Teamstatistik</h1>
      <div className="figures">
        <Figure label="Ziehungen" value={stats.totalSpins} />
        <Figure label="Gültig" value={stats.officialSpins} />
        <Figure label="Aufgehoben" value={stats.overturnedSpins} />
        <Figure label="Offene Einsprüche" value={stats.openAppeals} />
        <Figure label="Max. Abweichung" value={num(stats.maxFairnessDeviation)} />
      </div>

      <section>
        <h2>Hall of Shame</h2>
        <table className="board">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Name</th>
              <th className="num">Punkte</th>
              <th className="num">Schuld</th>
              <th className="num">Erwartet</th>
              <th className="num">Index</th>
              <th className="num">Serie</th>
              <th>Zuletzt</th>
            </tr>
          </thead>
          <tbody>
            {stats.hallOfShame.map((r) => (
              <tr key={r.memberId} data-testid="hall-row" className={r.active ? '' : 'muted'}>
                <td className="num">{r.rank}</td>
                <td>
                  <a href={href.bericht(team.teamId, r.memberId)}>{r.name}</a>
                  {r.achievements.length > 0 && (
                    <span className="small muted">
                      {' '}
                      ·{' '}
                      {r.achievements.length === 1
                        ? '1 Auszeichnung'
                        : `${r.achievements.length} Auszeichnungen`}
                    </span>
                  )}
                </td>
                <td className="num">{r.schuldpunkte}</td>
                <td className="num">{r.totalSelections}</td>
                <td className="num">{num(r.expectedSelections)}</td>
                <td className="num">{r.schuldindex === null ? '–' : num2(r.schuldindex)}</td>
                <td className="num">{r.currentStreak}</td>
                <td>{r.lastSelectedAt ? relativeTime(r.lastSelectedAt) : 'nie'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Ist gegen Soll</h2>
        <div className="bars">
          {stats.hallOfShame.map((r) => (
            <div key={r.memberId} className="bar-row">
              <span className="bar-name">{r.name}</span>
              <div className="bar-track">
                <div
                  className="bar actual"
                  style={{ width: `${(r.totalSelections / maxSelections) * 100}%` }}
                />
                <div
                  className="bar expected"
                  style={{ width: `${(r.expectedSelections / maxSelections) * 100}%` }}
                />
              </div>
              <span className="num small">
                {r.totalSelections} / {num(r.expectedSelections)}
              </span>
            </div>
          ))}
        </div>
        <p className="small muted">
          Rot: tatsächliche Schuldsprüche. Grau: statistische Erwartung aus den festgeschriebenen
          Gewichten.
        </p>
      </section>

      <section>
        <h2>Zugverlauf</h2>
        <table className="board">
          <thead>
            <tr>
              <th>Zug</th>
              <th>Abfahrt</th>
              <th>Schuldig</th>
              <th className="num">Teilnehmer</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {stats.history.map((h) => (
              <tr key={h.spinId} data-testid="history-row">
                <td>
                  <a href={href.ziehung(team.teamId, h.spinId)}>
                    SR {String(h.nonce).padStart(4, '0')}
                  </a>
                </td>
                <td>{dateTime(h.revealedAt ?? h.committedAt)}</td>
                <td>{h.selectedName ?? <span className="muted">offen</span>}</td>
                <td className="num">{h.participantCount}</td>
                <td>
                  {h.overturned ? (
                    <span className="chip">aufgehoben</span>
                  ) : h.appeal?.outcome === 'open' ? (
                    <span className="chip red">Einspruch</span>
                  ) : h.revealedAt ? (
                    <span className="chip ok">gültig</span>
                  ) : (
                    <span className="chip">läuft</span>
                  )}
                </td>
              </tr>
            ))}
            {stats.history.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Noch keine Ziehungen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="figure">
      <p className="label">{label}</p>
      <p className="figure-value">{value}</p>
    </div>
  );
}
