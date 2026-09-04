import { useEffect, useState } from 'react';
import type { MemberReport } from '../../domain/projections/report.ts';
import type { TeamView } from '../../server/views.ts';
import { api } from '../api.ts';
import { dateTime, num, num2, percent, relativeTime } from '../format.ts';
import { href } from '../route.ts';

export function ReportPage({ team, memberId }: { team: TeamView; memberId: string }) {
  const [report, setReport] = useState<MemberReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // team.version changes with every new event; the report must follow it.
  const { teamId, version } = team;
  useEffect(() => {
    void version;
    api
      .memberReport(teamId, memberId)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  }, [teamId, version, memberId]);

  if (error) return <p className="error-text">{error}</p>;
  if (!report) return <p className="muted">Schuldbericht wird erstellt …</p>;

  const index = report.schuldindex;
  const verdict =
    index === null
      ? 'Noch keine Datenlage'
      : index > 1.25
        ? 'Überdurchschnittlich schuldig'
        : index < 0.75
          ? 'Verdächtig unschuldig'
          : 'Im Rahmen der Erwartung';

  return (
    <article className="report">
      <header className="report-head">
        <div>
          <p className="label">Schuldbericht · Team {team.name}</p>
          <h1>{report.name}</h1>
          <p className="muted">
            {report.active ? 'Aktiv' : 'Abgemeldet'} · Stand {dateTime(new Date().toISOString())}
          </p>
        </div>
        <div className="index-box">
          <p className="label">Schuldindex</p>
          <p className="index-value">{index === null ? '–' : num2(index)}</p>
          <p className="small">{verdict}</p>
        </div>
      </header>

      {report.fahrgastrechte && <p className="notice">{report.fahrgastrechte}</p>}

      <table className="board kv">
        <tbody>
          <Row
            label="Schuldsprüche gesamt"
            value={<span data-testid="report-total-selections">{report.totalSelections}</span>}
          />
          <Row label="Teilnahmen" value={report.participations} />
          <Row label="Schuldquote" value={percent(report.schuldquote)} />
          <Row label="Erwartete Schuldsprüche" value={num(report.expectedSelections)} />
          <Row
            label="Fairness-Abweichung"
            value={`${report.fairnessDeviation >= 0 ? '+' : ''}${num(report.fairnessDeviation)}`}
          />
          <Row
            label="Zuletzt schuldig"
            value={
              report.lastSelectedAt
                ? `${relativeTime(report.lastSelectedAt)} (${dateTime(report.lastSelectedAt)})`
                : 'nie'
            }
          />
          <Row label="Aktuelle Serie" value={report.currentStreak} />
          <Row label="Beste Serie" value={report.bestStreak} />
          <Row label="Ziehungen seit letzter Schuld" value={report.spinsSinceLastSelection} />
          <Row label="Längste Durststrecke" value={report.longestDrySpell} />
          <Row label="Schuldpunkte" value={report.schuldpunkte} />
          <Row label="Entschädigungsminuten" value={`${report.entschaedigungsminuten} min`} />
          <Row
            label="Einsprüche"
            value={`${report.appeals.filed} eingelegt, ${report.appeals.upheld} stattgegeben`}
          />
          <Row label="Immunitäten in Besitz" value={report.immunitiesHeld} />
        </tbody>
      </table>

      <section>
        <h2>Auszeichnungen</h2>
        {report.achievements.length === 0 ? (
          <p className="muted">Noch keine. Das kommt.</p>
        ) : (
          <ul className="achievements">
            {report.achievements.map((a) => (
              <li key={a.id}>
                <strong>{a.title}</strong> <span className="muted">{a.description}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Fahrtenbuch</h2>
        <table className="board">
          <thead>
            <tr>
              <th>Zug</th>
              <th>Zeit</th>
              <th className="num">Wahrscheinl.</th>
              <th>Ergebnis</th>
            </tr>
          </thead>
          <tbody>
            {report.history.map((h) => (
              <tr key={h.spinId} data-testid="history-row">
                <td>
                  <a href={href.ziehung(team.teamId, h.spinId)}>
                    SR {String(h.nonce).padStart(4, '0')}
                  </a>
                </td>
                <td>{dateTime(h.at)}</td>
                <td className="num">{percent(h.probability)}</td>
                <td>
                  {h.overturned ? (
                    <span className="chip">aufgehoben</span>
                  ) : h.selected ? (
                    <span className="chip red">schuldig</span>
                  ) : (
                    <span className="chip ok">frei</span>
                  )}
                </td>
              </tr>
            ))}
            {report.history.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Noch keine Fahrten.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </article>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="num">{value}</td>
    </tr>
  );
}
