import type { TeamView } from '../../domain/views.ts';
import { dateTime, num, num2, relativeTime, spinLabel } from '../format.ts';
import { useI18n } from '../i18n/index.ts';
import { href } from '../route.ts';

export function StatisticsPage({ team }: { team: TeamView }) {
  const { t } = useI18n();
  const stats = team.statistics;
  const maxSelections = Math.max(
    1,
    ...stats.hallOfShame.map((r) => Math.max(r.totalSelections, r.expectedSelections)),
  );

  return (
    <>
      <h1>{t('statistics.title')}</h1>
      <div className="figures">
        <Figure label={t('statistics.figSpins')} value={stats.totalSpins} />
        <Figure label={t('statistics.figValid')} value={stats.officialSpins} />
        <Figure label={t('statistics.figOverturned')} value={stats.overturnedSpins} />
        <Figure label={t('statistics.figOpenAppeals')} value={stats.openAppeals} />
        <Figure label={t('statistics.figMaxDeviation')} value={num(stats.maxFairnessDeviation)} />
      </div>

      <section>
        <h2>{t('statistics.rankingHeading')}</h2>
        <table className="board">
          <thead>
            <tr>
              <th className="num">{t('statistics.rank')}</th>
              <th>{t('common.name')}</th>
              <th className="num">{t('statistics.points')}</th>
              <th className="num">{t('statistics.guilt')}</th>
              <th className="num">{t('statistics.expected')}</th>
              <th className="num">{t('statistics.index')}</th>
              <th className="num">{t('statistics.streak')}</th>
              <th>{t('statistics.last')}</th>
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
                        ? t('statistics.achievement.one')
                        : t('statistics.achievement.many', { n: r.achievements.length })}
                    </span>
                  )}
                </td>
                <td className="num">{r.schuldpunkte}</td>
                <td className="num">{r.totalSelections}</td>
                <td className="num">{num(r.expectedSelections)}</td>
                <td className="num">
                  {r.schuldindex === null ? (
                    <>
                      <span aria-hidden="true">–</span>
                      <span className="visually-hidden">{t('statistics.noIndex')}</span>
                    </>
                  ) : (
                    num2(r.schuldindex)
                  )}
                </td>
                <td className="num">{r.currentStreak}</td>
                <td>{r.lastSelectedAt ? relativeTime(r.lastSelectedAt) : t('common.never')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>{t('statistics.actualVsExpectedHeading')}</h2>
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
        <p className="small muted">{t('statistics.barLegend')}</p>
      </section>

      <section>
        <h2>{t('statistics.historyHeading')}</h2>
        <table className="board">
          <thead>
            <tr>
              <th>{t('common.train')}</th>
              <th>{t('statistics.departure')}</th>
              <th>{t('statistics.guiltyHeader')}</th>
              <th className="num">{t('common.participants')}</th>
              <th>{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {stats.history.map((h) => (
              <tr key={h.spinId} data-testid="history-row">
                <td>
                  <a href={href.ziehung(team.teamId, h.spinId)}>{spinLabel(h.nonce)}</a>
                </td>
                <td>{dateTime(h.revealedAt ?? h.committedAt)}</td>
                <td>{h.selectedName ?? <span className="muted">{t('common.chipOpen')}</span>}</td>
                <td className="num">{h.participantCount}</td>
                <td>
                  {h.overturned ? (
                    <span className="chip">{t('common.chipOverturned')}</span>
                  ) : h.appeal?.outcome === 'open' ? (
                    <span className="chip red">{t('statistics.chipAppeal')}</span>
                  ) : h.revealedAt ? (
                    <span className="chip ok">{t('statistics.chipValid')}</span>
                  ) : (
                    <span className="chip">{t('statistics.chipRunning')}</span>
                  )}
                </td>
              </tr>
            ))}
            {stats.history.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t('statistics.noHistory')}
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
