import { href, useRoute } from './route.ts';
import { useTeam } from './useTeam.ts';
import { FairnessPage } from './views/FairnessPage.tsx';
import { HomePage } from './views/HomePage.tsx';
import { ParticipantsPage } from './views/ParticipantsPage.tsx';
import { ReportPage } from './views/ReportPage.tsx';
import { SpinDetailPage } from './views/SpinDetailPage.tsx';
import { SpinPage } from './views/SpinPage.tsx';
import { StatisticsPage } from './views/StatisticsPage.tsx';

export function App() {
  const route = useRoute();
  return (
    <>
      <header className="topbar">
        <a className="wordmark" href={href.home()}>
          Schuldrad
        </a>
        {route.page !== 'home' && <TeamNav teamId={route.teamId} page={route.page} />}
      </header>
      <main className="container">
        {route.page === 'home' ? <HomePage /> : <TeamRoutes route={route} />}
      </main>
      <footer className="footer">
        Ergebnisse werden vor der Animation festgelegt und sind im Browser nachprüfbar. Alle Angaben
        ohne Gewähr, außer den Schuldsprüchen.{' '}
        <a href={`${import.meta.env.BASE_URL}docs/`}>Dokumentation</a>
      </footer>
    </>
  );
}

function TeamNav({ teamId, page }: { teamId: string; page: string }) {
  const tabs: [string, string, string][] = [
    ['spin', 'Ziehung', href.team(teamId)],
    ['teilnehmer', 'Teilnehmer', href.teilnehmer(teamId)],
    ['statistik', 'Statistik', href.statistik(teamId)],
    ['fairness', 'Fairness', href.fairness(teamId)],
  ];
  // Detail pages keep their parent tab highlighted for orientation.
  const activeKey = page === 'bericht' ? 'teilnehmer' : page === 'ziehung' ? 'statistik' : page;
  return (
    <nav className="tabs" aria-label="Hauptnavigation">
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
  const { team, error, setTeam, reload } = useTeam(route.teamId);
  if (error) {
    return (
      <section className="notice error">
        <p>Team konnte nicht geladen werden: {error}</p>
        <a href={href.home()}>Zur Übersicht</a>
      </section>
    );
  }
  if (!team) return <p className="muted">Fahrplandaten werden geladen …</p>;
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
