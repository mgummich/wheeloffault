import { useEffect, useState } from 'react';
import type { MemberReport } from '../../domain/projections/report.ts';
import type { TeamView } from '../../domain/views.ts';
import { api, errorMessage } from '../api.ts';
import { dateTime, num, num2, percent, relativeTime, spinLabel } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { href } from '../route.ts';

export function ReportPage({ team, memberId }: { team: TeamView; memberId: string }) {
  const { t } = useI18n();
  const [report, setReport] = useState<MemberReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // team.version changes with every new event; the report must follow it.
  const { teamId, version } = team;
  useEffect(() => {
    void version;
    api
      .memberReport(teamId, memberId)
      .then(setReport)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [teamId, version, memberId]);

  if (error) return <p className="error-text">{error}</p>;
  if (!report) return <p className="muted">{t('report.loading')}</p>;

  const index = report.schuldindex;
  const verdict =
    index === null
      ? t('report.noData')
      : index > 1.25
        ? t('report.verdictHigh')
        : index < 0.75
          ? t('report.verdictLow')
          : t('report.verdictNormal');

  return (
    <article className="report">
      <header className="report-head">
        <div>
          <p className="label">{t('report.labelPrefix', { team: team.name })}</p>
          <h1>{report.name}</h1>
          <p className="muted">
            {report.active ? t('common.active') : t('common.inactive')} ·{' '}
            {t('report.asOf', { date: dateTime(new Date().toISOString()) })}
          </p>
        </div>
        <div className="index-box">
          <p className="label">{t('report.indexLabel')}</p>
          <p className="index-value">{index === null ? '–' : num2(index)}</p>
          <p className="small">{verdict}</p>
        </div>
      </header>

      {report.fahrgastrechte && <p className="notice">{report.fahrgastrechte}</p>}

      <table className="board kv">
        <tbody>
          <Row
            label={t('report.row.totalSelections')}
            value={<span data-testid="report-total-selections">{report.totalSelections}</span>}
          />
          <Row label={t('report.row.participations')} value={report.participations} />
          <Row label={t('report.row.schuldquote')} value={percent(report.schuldquote)} />
          <Row label={t('report.row.expectedSelections')} value={num(report.expectedSelections)} />
          <Row
            label={t('report.row.fairnessDeviation')}
            value={`${report.fairnessDeviation >= 0 ? '+' : ''}${num(report.fairnessDeviation)}`}
          />
          <Row
            label={t('report.row.lastSelected')}
            value={
              report.lastSelectedAt
                ? `${relativeTime(report.lastSelectedAt)} (${dateTime(report.lastSelectedAt)})`
                : t('common.never')
            }
          />
          <Row label={t('report.row.currentStreak')} value={report.currentStreak} />
          <Row label={t('report.row.bestStreak')} value={report.bestStreak} />
          <Row
            label={t('report.row.spinsSinceLastSelection')}
            value={report.spinsSinceLastSelection}
          />
          <Row label={t('report.row.longestDrySpell')} value={report.longestDrySpell} />
          <Row label={t('report.row.schuldpunkte')} value={report.schuldpunkte} />
          <Row
            label={t('report.row.entschaedigungsminuten')}
            value={t('report.minutesSuffix', { min: report.entschaedigungsminuten })}
          />
          <Row
            label={t('report.row.appeals')}
            value={t('report.appealsValue', {
              filed: report.appeals.filed,
              upheld: report.appeals.upheld,
            })}
          />
          <Row label={t('report.row.immunitiesHeld')} value={report.immunitiesHeld} />
        </tbody>
      </table>

      <section>
        <h2>{t('report.achievementsHeading')}</h2>
        {report.achievements.length === 0 ? (
          <p className="muted">{t('report.noAchievements')}</p>
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
        <h2>{t('report.historyHeading')}</h2>
        <table className="board">
          <thead>
            <tr>
              <th>{t('common.train')}</th>
              <th>{t('common.time')}</th>
              <th className="num">{t('common.probability')}</th>
              <th>{t('report.resultHeader')}</th>
            </tr>
          </thead>
          <tbody>
            {report.history.map((h) => (
              <tr key={h.spinId} data-testid="history-row">
                <td>
                  <a href={href.ziehung(team.teamId, h.spinId)}>{spinLabel(h.nonce)}</a>
                </td>
                <td>{dateTime(h.at)}</td>
                <td className="num">{percent(h.probability)}</td>
                <td>
                  {h.overturned ? (
                    <span className="chip">{t('common.chipOverturned')}</span>
                  ) : h.selected ? (
                    <span className="chip red">{t('common.chipGuilty')}</span>
                  ) : (
                    <span className="chip ok">{t('common.chipFree')}</span>
                  )}
                </td>
              </tr>
            ))}
            {report.history.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  {t('report.noHistory')}
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
