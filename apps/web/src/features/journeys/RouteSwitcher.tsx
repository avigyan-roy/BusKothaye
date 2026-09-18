import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RouteSummary } from '@buskothay/shared';
import './route-switcher.css';

export function RouteSwitcher({
  routes,
  currentRouteId,
  onSelect,
  compact = false,
}: {
  routes: readonly RouteSummary[];
  currentRouteId?: string;
  onSelect?: (routeId: string) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('en-US');
    if (!needle) return routes;
    return routes.filter((route) =>
      `${route.code} ${route.origin} ${route.destination}`
        .toLocaleLowerCase('en-US')
        .includes(needle),
    );
  }, [query, routes]);

  return (
    <section
      className={`route-switcher${compact ? ' route-switcher--compact' : ''}`}
      aria-label="WBTC route directory"
    >
      <label className="field">
        <span className="field__label">Find a route by number or place</span>
        <input
          className="field__input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="AC24, Howrah, Garia…"
        />
      </label>
      <div className="route-switcher__list">
        {filtered.map((route) => {
          const content = (
            <>
              <strong>{route.code}</strong>
              <span>{route.origin} → {route.destination}</span>
              {route.trackingAvailable ? (
                <small>Tracking route available</small>
              ) : (
                <small>Directory only · geometry needed</small>
              )}
            </>
          );
          return onSelect ? (
            <button
              key={route.id}
              type="button"
              disabled={!route.trackingAvailable}
              className={route.id === currentRouteId ? 'is-active' : ''}
              onClick={() => onSelect(route.id)}
            >
              {content}
            </button>
          ) : route.trackingAvailable ? (
            <Link
              key={route.id}
              to={`/r/${route.id}`}
              className={route.id === currentRouteId ? 'is-active' : ''}
            >
              {content}
            </Link>
          ) : (
            <div key={route.id} className="is-unavailable">{content}</div>
          );
        })}
      </div>
    </section>
  );
}

