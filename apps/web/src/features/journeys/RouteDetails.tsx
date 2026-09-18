import type { RouteDto } from '@buskothay/shared';
import { en } from '../../content/en.js';
import { formatDistance } from '../../lib/format.js';

/**
 * Where the route information came from, in the person's view rather than buried
 * in a JSON file. It says plainly when the line is an approximation and when
 * there is no timetable — both of which are true today.
 */
export function RouteDetails({ route }: { route: RouteDto }) {
  return (
    <details className="route-details panel">
      <summary>{en.route.routeDetails}</summary>
      <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
        <p className="muted">{en.route.checkpointsNote}</p>
        {route.provenance.isApproximateGeometry ? (
          <p className="notice notice--warning">{en.route.approximateNote}</p>
        ) : null}
        {route.schedule === null ? <p className="muted">{en.route.noSchedule}</p> : null}
        <dl className="route-details__facts">
          <dt>{en.route.lengthLabel}</dt>
          <dd>{formatDistance(route.lengthM)}</dd>

          <dt>{en.route.officialSource}</dt>
          <dd>
            {route.provenance.officialSourceUrl === null ? (
              route.provenance.officialSource
            ) : (
              <a href={route.provenance.officialSourceUrl} target="_blank" rel="noreferrer noopener">
                {route.provenance.officialSource}
              </a>
            )}
          </dd>

          <dt>{en.route.geometrySource}</dt>
          <dd>
            {route.provenance.geometrySource}
            <br />
            <span className="meta">{route.provenance.geometryLicense}</span>
          </dd>

          <dt>{en.route.verifiedOn}</dt>
          <dd>{route.provenance.verifiedOn}</dd>
        </dl>
        <p className="meta">{route.provenance.notes}</p>
      </div>
    </details>
  );
}
