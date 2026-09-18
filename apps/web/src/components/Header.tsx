import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { en } from '../content/en.js';
import { site } from '../config/site.js';
import './header.css';
import { loadAccountSession } from '../lib/auth-session.js';

/**
 * A plain wordmark, the route it is showing, and one useful action.
 * No logo illustration, no bottom navigation for a three-screen utility.
 */
export function Header({
  routeCode,
  routeDirection,
  action,
}: {
  routeCode?: string;
  routeDirection?: string;
  action?: { label: string; to: string };
}) {
  const [accountName, setAccountName] = useState(() => loadAccountSession()?.account.username);
  useEffect(() => {
    const refresh = () => setAccountName(loadAccountSession()?.account.username);
    window.addEventListener('buskothay-account-changed', refresh);
    return () => window.removeEventListener('buskothay-account-changed', refresh);
  }, []);
  return (
    <header className="site-header">
      <div className="site-header__bar">
        <Link to="/" className="site-header__wordmark">
          {site.name}
        </Link>
        <nav className="site-header__actions" aria-label="Account and page navigation">
          <Link to="/account" className="site-header__action">
            {accountName ?? en.header.accountLink}
          </Link>
          {accountName ? <Link to="/demo" className="site-header__action">Demo</Link> : null}
          {action ? (
            <Link to={action.to} className="site-header__action">
              {action.label}
            </Link>
          ) : null}
        </nav>
      </div>
      {routeCode ? (
        <div className="site-header__route">
          <span className="route-badge">{routeCode}</span>
          <span className="site-header__direction">{routeDirection}</span>
        </div>
      ) : null}
    </header>
  );
}

export function RouteBadge({ code }: { code: string }) {
  return <span className="route-badge">{code}</span>;
}

export function DemoBadge() {
  return (
    <span className="demo-badge" title={en.common.demoJourney}>
      {en.common.demoBadge}
    </span>
  );
}
