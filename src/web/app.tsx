import { href, useRoute } from './route.ts';
import { useTeam } from './useTeam.ts';
import { FairnessPage } from './views/FairnessPage.tsx';
import { HomePage } from './views/HomePage.tsx';
import { ParticipantsPage } from './views/ParticipantsPage.tsx';
import { ReportPage } from './views/ReportPage.tsx';
import { SpinDetailPage } from './views/SpinDetailPage.tsx';
import { SpinPage } from './views/SpinPage.tsx';
import { StatisticsPage } from './views/StatisticsPage.tsx';
import { type Lang, useI18n } from './i18n/index.ts';

export function App() {
  const route = useRoute();
  const { t } = useI18n();
  return (
    <>
      <header className="topbar">
        <a className="wordmark" href={href.home()}>
          {t('app.brand')}
        </a>
        {route.page !== 'home' && <TeamNav teamId={route.teamId} page={route.page} />}
        <LangSwitch />
      </header>
      <main className="container">
        {route.page === 'home' ? <HomePage /> : <TeamRoutes route={route} />}
      </main>
      <footer className="footer">
        {t('footer.disclaimer')} <a href={`${import.meta.env.BASE_URL}docs/`}>{t('footer.docs')}</a>
      </footer>
    </>
  );
}

/** Small, obvious language switch: fits the dry railway-bureau aesthetic. */
function LangSwitch() {
  const { lang, setLang } = useI18n();
  const option = (value: Lang, label: string) => (
    <button
      type="button"
      className={`lang-option${lang === value ? ' active' : ''}`}
      aria-pressed={lang === value}
      onClick={() => setLang(value)}
    >
      {label}
    </button>
  );
  return (
    <div className="lang-switch">
      {option('de', 'DE')}
      <span aria-hidden="true">|</span>
      {option('en', 'EN')}
    </div>
  );
}

function TeamNav({ teamId, page }: { teamId: string; page: string }) {
  const { t } = useI18n();
  const tabs: [string, string, string][] = [
    ['spin', t('nav.spin'), href.team(teamId)],
    ['teilnehmer', t('nav.teilnehmer'), href.teilnehmer(teamId)],
    ['statistik', t('nav.statistik'), href.statistik(teamId)],
    ['fairness', t('nav.fairness'), href.fairness(teamId)],
  ];
  // Detail pages keep their parent tab highlighted for orientation.
  const activeKey = page === 'bericht' ? 'teilnehmer' : page === 'ziehung' ? 'statistik' : page;
  return (
    <nav className="tabs" aria-label={t('nav.ariaLabel')}>
      {tabs.map(([key, label, to]) => (
        <a
          key={key}
          href={to}
          className={activeKey === key ? 'active' : ''}
          aria-current={page === key ? 'page' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function TeamRoutes({ route }: { route: Exclude<ReturnType<typeof useRoute>, { page: 'home' }> }) {
  const { t } = useI18n();
  const { team, error, setTeam, reload } = useTeam(route.teamId);
  if (error) {
    return (
      <section className="notice error">
        <p>{t('teamRoutes.loadError', { error })}</p>
        <a href={href.home()}>{t('common.backHome')}</a>
      </section>
    );
  }
  if (!team) return <p className="muted">{t('common.loadingTeam')}</p>;
  const props = { team, setTeam, reload };
  switch (route.page) {
    case 'spin':
      return <SpinPage {...props} />;
    case 'teilnehmer':
      return <ParticipantsPage {...props} />;
    case 'statistik':
      return <StatisticsPage team={team} />;
    case 'fairness':
      return <FairnessPage {...props} />;
    case 'bericht':
      return <ReportPage team={team} memberId={route.memberId} />;
    case 'ziehung':
      return <SpinDetailPage {...props} spinId={route.spinId} />;
  }
}
