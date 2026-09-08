import { useEffect } from 'react';
import { authApi } from './authApi.ts';
import { markUnauthenticated, setAuthStatus, useAuthState } from './authState.ts';
import { Login } from './Login.tsx';
import { serverMode } from './api.ts';
import { href, useRoute } from './route.ts';
import { type Theme, useTheme } from './theme.ts';
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
  const auth = useAuthState();

  // Server mode only: static builds never call this endpoint and never gate.
  useEffect(() => {
    if (!serverMode) return;
    authApi
      .status()
      .then(setAuthStatus)
      .catch(() => {});
  }, []);

  const gated = serverMode && auth.enabled && !auth.authenticated;

  return (
    <>
      <header className="topbar">
        <a className="wordmark" href={href.home()}>
          {t('app.brand')}
        </a>
        {!gated && route.page !== 'home' && <TeamNav teamId={route.teamId} page={route.page} />}
        <LangSwitch />
        <ThemeSwitch />
        {serverMode && auth.enabled && auth.authenticated && <LogoutButton />}
      </header>
      <main className="container">
        {gated ? <Login /> : route.page === 'home' ? <HomePage /> : <TeamRoutes route={route} />}
      </main>
      <footer className="footer">
        {t('footer.disclaimer')} <a href={`${import.meta.env.BASE_URL}docs/`}>{t('footer.docs')}</a>
      </footer>
    </>
  );
}

function LogoutButton() {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="quiet"
      onClick={() => {
        void authApi.logout().finally(markUnauthenticated);
      }}
    >
      {t('auth.logoutButton')}
    </button>
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

/** Three-state control-panel toggle next to the language switch: system /
 * light / dark, persisted in localStorage via theme.ts. */
function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const option = (value: Theme, label: string) => (
    <button
      type="button"
      className={`theme-option${theme === value ? ' active' : ''}`}
      aria-pressed={theme === value}
      onClick={() => setTheme(value)}
    >
      {label}
    </button>
  );
  return (
    <div className="theme-switch">
      <span className="visually-hidden">{t('theme.ariaLabel')}</span>
      {option('system', t('theme.system'))}
      <span aria-hidden="true">|</span>
      {option('light', t('theme.light'))}
      <span aria-hidden="true">|</span>
      {option('dark', t('theme.dark'))}
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
