import { Link, useSearchParams } from 'react-router-dom';
import { Header } from '../components/Header.js';
import { ArrivalRow } from '../features/passenger/ArrivalRow.js';
import { useArrivals } from '../hooks/useArrivals.js';
import { useNow } from '../hooks/useNow.js';
import { en } from '../content/en.js';
import './results-page.css';

/**
 * Path A: every tracked bus that runs from one stop to another.
 *
 * The two stops live in the URL, so this page is shareable, survives a refresh,
 * and can be arrived at directly — which also means it has to cope with a link
 * that names a stop nobody has heard of, and say so rather than break.
 */
export function ResultsPage() {
  const [params] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const { data, isLoading, error } = useArrivals(from, { to });
  const nowMs = useNow();

  if (from === null || to === null) {
    return (
      <Shell>
        <div className="empty-state">
          <h3>{en.find.chooseBothStops}</h3>
          <Link className="button" to="/">{en.find.changeStops}</Link>
        </div>
      </Shell>
    );
  }

  if (error === 'STOP_NOT_FOUND') {
    return (
      <Shell>
        <div className="empty-state">
          <h3>{en.find.noStopMatch(to)}</h3>
          <p>{en.find.noStopMatchHelp}</p>
          <Link className="button" to="/">{en.find.changeStops}</Link>
        </div>
      </Shell>
    );
  }

  const arrivals = data?.arrivals ?? [];

  return (
    <Shell>
      <div className="journey-head">
        <h1 className="journey-title">
          {en.find.resultsHeading(data?.from.name ?? from, data?.to?.name ?? to)}
        </h1>
      </div>
      <p className="journey-sub">
        {isLoading && data === null
          ? en.common.loading
          : error !== null
            ? en.errors.offline
            : en.find.resultsCount(arrivals.length)}
      </p>

      <div className="board">
        {arrivals.length === 0 && !isLoading && error === null ? (
          <div className="empty-state">
            <h3>{en.find.noDirectBus}</h3>
            <p>{en.find.noDirectBusHelp}</p>
            <Link className="button" to="/">{en.find.changeStops}</Link>
          </div>
        ) : (
          arrivals.map((arrival) => (
            <ArrivalRow key={arrival.routeId} arrival={arrival} nowMs={nowMs} />
          ))
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main className="results-screen">
        <div className="results-screen__wrap">
          <div className="crumb">
            <Link className="back-btn" to="/">← {en.find.changeStops}</Link>
          </div>
          {children}
        </div>
      </main>
    </>
  );
}
