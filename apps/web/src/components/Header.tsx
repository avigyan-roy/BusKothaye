import { Link } from 'react-router-dom';
import { en } from '../content/en.js';
import { site } from '../config/site.js';
import './header.css';

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
  return (
    <header className="site-header">
      <div className="site-header__bar">
        <Link to="/" className="site-header__wordmark">
          {site.name}
        </Link>
        {action ? (
          <Link to={action.to} className="site-header__action">
            {action.label}
          </Link>
        ) : null}
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
