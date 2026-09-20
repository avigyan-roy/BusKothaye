import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { en } from '../content/en.js';
import { site } from '../config/site.js';
import { loadAccountSession } from '../lib/auth-session.js';
import { setTheme, useTheme } from '../lib/theme.js';
import './header.css';

export function Header({
  routeCode,
  routeDirection,
  action,
}: {
  routeCode?: string;
  routeDirection?: string;
  action?: { label: string; to: string };
}) {
  const [account, setAccount] = useState(() => loadAccountSession()?.account);
  const [now, setNow] = useState(() => new Date());
  const theme = useTheme();

  useEffect(() => {
    const refresh = () => setAccount(loadAccountSession()?.account);
    window.addEventListener('buskothay-account-changed', refresh);
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => {
      window.removeEventListener('buskothay-account-changed', refresh);
      window.clearInterval(timer);
    };
  }, []);

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return (
    <header className="site-header">
      <div className="site-header__bar">
        <Link to="/" className="site-header__wordmark" aria-label={`${site.name} home`}>
          <svg viewBox="0 0 26 30" aria-hidden="true">
            <line x1="13" y1="1" x2="13" y2="29" stroke="currentColor" strokeWidth="1.5" opacity=".5" />
            <circle cx="13" cy="15" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <circle cx="13" cy="15" r="1.8" fill="currentColor" />
          </svg>
          <span>Bus<strong>Kothay</strong></span>
        </Link>
        {routeCode ? (
          <div className="site-header__route">
            <span className="route-badge">{routeCode}</span>
            <span className="site-header__direction">{routeDirection}</span>
          </div>
        ) : null}
        <nav className="site-header__actions" aria-label="Account and page navigation">
          <span className="site-header__clock"><b>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</b><small>NOW</small></span>
          <button
            className="site-header__action"
            type="button"
            onClick={toggleTheme}
            aria-pressed={theme === 'light'}
            title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
          >
            <span aria-hidden="true">◐</span>
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          {account?.isAdmin === true ? <Link to="/admin/routes" className="site-header__action">Routes</Link> : null}
          {account?.isAdmin === true ? <Link to="/demo" className="site-header__action">Demo</Link> : null}
          <Link to="/account" className="site-header__avatar" title={account?.username ?? en.header.accountLink}>
            {(account?.username ?? 'Guest').slice(0, 2).toUpperCase()}
          </Link>
          {action ? <Link to={action.to} className="site-header__action">{action.label}</Link> : null}
        </nav>
      </div>
    </header>
  );
}

export function RouteBadge({ code }: { code: string }) {
  return <span className="route-badge">{code}</span>;
}

export function DemoBadge() {
  return <span className="demo-badge" title={en.common.demoJourney}>{en.common.demoBadge}</span>;
}
