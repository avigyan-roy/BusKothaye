import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Navigate } from 'react-router-dom';
import type { AdminRouteRecord, RouteFixture } from '@buskothay/shared';
import { Header } from '../components/Header.js';
import {
  RouteMapEditor,
  type GeneratedRouteDetails,
} from '../features/admin/RouteMapEditor.js';
import { api, ApiError } from '../lib/api.js';
import { loadAccountSession } from '../lib/auth-session.js';
import './route-admin-page.css';

type Stop = RouteFixture['stops'][number];

export function RouteAdminPage() {
  const session = loadAccountSession();
  const [records, setRecords] = useState<AdminRouteRecord[]>([]);
  const [draft, setDraft] = useState<RouteFixture | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routeVerified, setRouteVerified] = useState(false);
  const [stopsVerified, setStopsVerified] = useState(false);

  useEffect(() => {
    if (!session?.account.isAdmin) return;
    const controller = new AbortController();
    void api.listAdminRoutes(session.token, controller.signal)
      .then((response) => {
        setRecords(response.routes);
        const first = response.routes[0];
        if (first) selectRecord(first);
      })
      .catch((caught) => {
        setError(caught instanceof ApiError ? caught.message : 'Could not load route administration.');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // Session storage is stable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRecord = useMemo(
    () => records.find((record) => record.route.id === selectedId) ?? null,
    [records, selectedId],
  );

  if (!session?.account.isAdmin) {
    return <Navigate to="/admin?reason=session" replace />;
  }
  const accountToken = session.token;

  function selectRecord(record: AdminRouteRecord) {
    const next = cloneRoute(record.route);
    setDraft(next);
    setSelectedId(record.route.id);
    setRouteVerified(!record.route.provenance.isApproximateGeometry);
    setStopsVerified(!record.route.provenance.areStopsApproximate);
    setNotice(null);
    setError(null);
  }

  function startNewRoute() {
    const route = createBlankRoute();
    setDraft(route);
    setSelectedId(null);
    setRouteVerified(false);
    setStopsVerified(false);
    setNotice('New route draft. Place and name the stops, then generate the road path.');
    setError(null);
  }

  function updateRoute(patch: Partial<RouteFixture>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setNotice(null);
  }

  function setStops(stops: Stop[]) {
    setDraft((current) => current ? {
      ...current,
      stops,
      origin: stops[0]?.name || current.origin,
      destination: stops[stops.length - 1]?.name || current.destination,
      segments: rebuildSegments(stops, current.segments),
    } : current);
    setRouteVerified(false);
    setStopsVerified(false);
    setNotice('Stop order or position changed. Generate and review a fresh road path before publishing.');
  }

  function updateStop(index: number, patch: Partial<Stop>) {
    if (!draft) return;
    setStops(draft.stops.map((stop, stopIndex) => stopIndex === index ? { ...stop, ...patch, sM: undefined } : stop));
  }

  function moveStop(index: number, direction: -1 | 1) {
    if (!draft) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.stops.length) return;
    const next = [...draft.stops];
    [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
    setStops(next);
  }

  function addStop(lat: number, lon: number) {
    if (!draft) return;
    const number = draft.stops.length + 1;
    setStops([...draft.stops, {
      id: `stop-${number}`,
      name: `New stop ${number}`,
      lat: roundCoordinate(lat),
      lon: roundCoordinate(lon),
      isSelectedCheckpoint: true,
    }]);
  }

  function generated(details: GeneratedRouteDetails) {
    if (!draft) return;
    updateRoute({
      geometry: { type: 'LineString', coordinates: details.coordinates },
      provenance: {
        ...draft.provenance,
        geometrySource: 'Google Maps Routes library road path from the ordered administrator stop pins',
        geometryLicense: 'Google Maps Platform terms apply; the deployment owner must confirm permitted retention and display.',
        geometrySourceUrl: 'https://developers.google.com/maps/documentation/javascript/routes/routes-class',
        isApproximateGeometry: true,
      },
    });
    setRouteVerified(false);
    const distance = details.distanceM === null ? '' : ` ${(details.distanceM / 1000).toFixed(1)} km.`;
    setNotice(`Road path generated.${distance} Mark it verified only after checking the complete AC24 alignment.`);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const nextVersion = nextRouteVersion();
    const route: RouteFixture = {
      ...draft,
      id: draft.id.trim(),
      code: draft.code.trim(),
      name: draft.name.trim(),
      origin: draft.origin.trim(),
      destination: draft.destination.trim(),
      version: nextVersion,
      color: draft.color.toUpperCase(),
      stops: draft.stops.map((stop) => ({
        id: stop.id.trim(),
        name: stop.name.trim(),
        lat: stop.lat,
        lon: stop.lon,
        isSelectedCheckpoint: stop.isSelectedCheckpoint,
      })),
      segments: rebuildSegments(draft.stops, draft.segments),
      provenance: {
        ...draft.provenance,
        verifiedOn: new Date().toISOString().slice(0, 10),
        isApproximateGeometry: !routeVerified,
        areStopsApproximate: !stopsVerified,
      },
    };
    try {
      const record = await api.saveAdminRoute(accountToken, route);
      setRecords((current) => [record, ...current.filter((item) => item.route.id !== route.id)]
        .sort((a, b) => a.route.code.localeCompare(b.route.code)));
      setDraft(cloneRoute(record.route));
      setSelectedId(record.route.id);
      setNotice(`Published ${record.route.code} as immutable revision ${record.route.version}.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the route.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Header action={{ label: 'Passenger view', to: '/' }} />
      <main className="route-admin">
        <header className="route-admin__heading">
          <div>
            <p className="route-admin__eyebrow">Operations console</p>
            <h1>Routes, stops & timetables</h1>
            <p>Arrange stop pins, ask Google for a road-following path, review it, then publish a new immutable route revision.</p>
          </div>
          <button className="button" type="button" onClick={startNewRoute}>Add bus route</button>
        </header>

        {error ? <p className="notice notice--danger" role="alert">{error}</p> : null}
        {notice ? <p className="notice notice--quiet" role="status">{notice}</p> : null}

        <div className="route-admin__workspace">
          <aside className="route-admin__directory" aria-label="Editable routes">
            <h2>Route directory</h2>
            {loading ? <p className="muted">Loading routes…</p> : null}
            {records.map((record) => (
              <button
                key={record.route.id}
                type="button"
                className={record.route.id === selectedId ? 'is-selected' : ''}
                onClick={() => selectRecord(record)}
              >
                <span style={{ background: record.route.color }} />
                <b>{record.route.code}</b>
                <small>{record.route.origin} → {record.route.destination}</small>
              </button>
            ))}
            <p className="route-admin__directory-note">Published revisions persist in DynamoDB in cloud mode and memory in local mode.</p>
          </aside>

          {draft ? (
            <div className="route-admin__editor">
              <RouteMapEditor
                stops={draft.stops}
                geometry={draft.geometry.coordinates}
                color={draft.color}
                onMoveStop={(index, lat, lon) => updateStop(index, { lat: roundCoordinate(lat), lon: roundCoordinate(lon) })}
                onAddStop={addStop}
                onGenerated={generated}
              />

              <section className="admin-form-section">
                <div className="admin-form-section__title"><span>01</span><div><h2>Route identity</h2><p>Public labels and the direction passengers see.</p></div></div>
                <div className="admin-form-grid">
                  <TextField label="Route ID" value={draft.id} disabled={selectedRecord !== null} onChange={(value) => updateRoute({ id: slug(value) })} />
                  <TextField label="Route code" value={draft.code} onChange={(code) => updateRoute({ code })} />
                  <TextField label="Display name" value={draft.name} onChange={(name) => updateRoute({ name })} wide />
                  <TextField label="Origin" value={draft.origin} onChange={(origin) => updateRoute({ origin })} />
                  <TextField label="Destination" value={draft.destination} onChange={(destination) => updateRoute({ destination })} />
                  <label className="field"><span className="field__label">Line colour</span><input className="field__input field__color" type="color" value={draft.color} onChange={(event) => updateRoute({ color: event.target.value.toUpperCase() })} /></label>
                  <label className="field"><span className="field__label">Direction</span><select className="field__input" value={draft.direction} onChange={(event) => updateRoute({ direction: event.target.value as RouteFixture['direction'] })}><option value="outbound">Outbound</option><option value="inbound">Inbound</option></select></label>
                </div>
              </section>

              <section className="admin-form-section">
                <div className="admin-form-section__title"><span>02</span><div><h2>Ordered stops</h2><p>Drag pins on the map or edit exact coordinates. The order controls the route.</p></div></div>
                <div className="route-stop-table">
                  {draft.stops.map((stop, index) => (
                    <article key={`${stop.id}-${index}`} className="route-stop-row">
                      <b className="route-stop-row__number">{String(index + 1).padStart(2, '0')}</b>
                      <input aria-label={`Stop ${index + 1} ID`} value={stop.id} onChange={(event) => updateStop(index, { id: slug(event.target.value) })} />
                      <input aria-label={`Stop ${index + 1} name`} value={stop.name} onChange={(event) => updateStop(index, { name: event.target.value })} />
                      <input aria-label={`Stop ${index + 1} latitude`} type="number" step="0.000001" value={stop.lat} onChange={(event) => updateStop(index, { lat: Number(event.target.value) })} />
                      <input aria-label={`Stop ${index + 1} longitude`} type="number" step="0.000001" value={stop.lon} onChange={(event) => updateStop(index, { lon: Number(event.target.value) })} />
                      <div className="route-stop-row__actions">
                        <button type="button" onClick={() => moveStop(index, -1)} disabled={index === 0} aria-label={`Move ${stop.name} earlier`}>↑</button>
                        <button type="button" onClick={() => moveStop(index, 1)} disabled={index === draft.stops.length - 1} aria-label={`Move ${stop.name} later`}>↓</button>
                        <button type="button" onClick={() => setStops(draft.stops.filter((_, stopIndex) => stopIndex !== index))} disabled={draft.stops.length <= 2} aria-label={`Remove ${stop.name}`}>×</button>
                      </div>
                    </article>
                  ))}
                </div>
                <button className="button button--secondary" type="button" onClick={() => addStop(draft.stops.at(-1)?.lat ?? 22.552, draft.stops.at(-1)?.lon ?? 88.365)}>Add stop row</button>
              </section>

              <section className="admin-form-section">
                <div className="admin-form-section__title"><span>03</span><div><h2>Timetable & operating assumptions</h2><p>One departure per line. Times use the route timezone.</p></div></div>
                <div className="admin-form-grid">
                  <TextField label="Timezone" value={draft.timezone} onChange={(timezone) => updateRoute({ timezone })} />
                  <NumberField label="Typical speed (m/s)" value={meanSpeed(draft)} min={0.1} step={0.1} onChange={(value) => updateRoute({ segments: draft.segments.map((segment) => ({ ...segment, typicalSpeedMps: value })) })} />
                  <NumberField label="Dwell per stretch (seconds)" value={meanDwell(draft)} min={0} step={1} onChange={(value) => updateRoute({ segments: draft.segments.map((segment) => ({ ...segment, dwellAllowanceS: value })) })} />
                  <TextField label="Timetable source" value={draft.schedule?.source ?? ''} onChange={(source) => updateRoute({ schedule: { ...(draft.schedule ?? defaultSchedule(draft.timezone)), source } })} wide />
                  <label className="field admin-form-grid__wide"><span className="field__label">Departures</span><textarea className="field__input route-admin__textarea" rows={7} value={(draft.schedule?.departures ?? []).join('\n')} placeholder={'06:20\n06:40\n07:00'} onChange={(event) => updateRoute({ schedule: { ...(draft.schedule ?? defaultSchedule(draft.timezone)), departures: lines(event.target.value) } })} /></label>
                  <label className="route-admin__check"><input type="checkbox" checked={draft.schedule?.isIllustrative ?? true} onChange={(event) => updateRoute({ schedule: { ...(draft.schedule ?? defaultSchedule(draft.timezone)), isIllustrative: event.target.checked } })} /> These times are illustrative, not published service times</label>
                </div>
              </section>

              <section className="admin-form-section">
                <div className="admin-form-section__title"><span>04</span><div><h2>Source & verification</h2><p>Keep research and confidence explicit; generated does not mean operator-verified.</p></div></div>
                <div className="admin-form-grid">
                  <TextField label="Official route source" value={draft.provenance.officialSource} onChange={(officialSource) => updateRoute({ provenance: { ...draft.provenance, officialSource } })} wide />
                  <TextField label="Official source URL" value={draft.provenance.officialSourceUrl ?? ''} onChange={(value) => updateRoute({ provenance: { ...draft.provenance, officialSourceUrl: nullableUrl(value) } })} wide />
                  <label className="field admin-form-grid__wide"><span className="field__label">Notes</span><textarea className="field__input route-admin__textarea" rows={4} value={draft.provenance.notes} onChange={(event) => updateRoute({ provenance: { ...draft.provenance, notes: event.target.value } })} /></label>
                  <label className="route-admin__check"><input type="checkbox" checked={routeVerified} onChange={(event) => setRouteVerified(event.target.checked)} /> I reviewed the full generated line against the actual bus corridor</label>
                  <label className="route-admin__check"><input type="checkbox" checked={stopsVerified} onChange={(event) => setStopsVerified(event.target.checked)} /> Stop pins are verified boarding locations, not approximate landmarks</label>
                </div>
              </section>

              <footer className="route-admin__publish">
                <div><b>Publish a new revision</b><span>The server validates stop order, line proximity, segments, and timetable before activation.</span></div>
                <button className="button" type="button" onClick={save} disabled={saving}>{saving ? 'Publishing…' : 'Publish route'}</button>
              </footer>
            </div>
          ) : loading ? null : <p className="panel">Choose a route or add a new one.</p>}
        </div>
      </main>
    </>
  );
}

function TextField({ label, value, onChange, wide = false, disabled = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean; disabled?: boolean }) {
  return <label className={`field${wide ? ' admin-form-grid__wide' : ''}`}><span className="field__label">{label}</span><input className="field__input" value={value} disabled={disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} /></label>;
}

function NumberField({ label, value, onChange, min, step }: { label: string; value: number; onChange: (value: number) => void; min: number; step: number }) {
  return <label className="field"><span className="field__label">{label}</span><input className="field__input" type="number" min={min} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function createBlankRoute(): RouteFixture {
  const stops: Stop[] = [
    { id: 'origin', name: 'Origin', lat: 22.552, lon: 88.365, isSelectedCheckpoint: true },
    { id: 'destination', name: 'Destination', lat: 22.562, lon: 88.355, isSelectedCheckpoint: true },
  ];
  return {
    id: `new-route-${Date.now()}`,
    version: 'draft',
    code: 'NEW',
    color: '#38D0FF',
    name: 'New bus route',
    origin: stops[0]!.name,
    destination: stops[1]!.name,
    direction: 'outbound',
    timezone: 'Asia/Kolkata',
    geometry: { type: 'LineString', coordinates: stops.map((stop) => [stop.lon, stop.lat]) },
    stops,
    segments: rebuildSegments(stops, []),
    provenance: {
      officialSource: 'Operator-entered route record',
      officialSourceUrl: null,
      geometrySource: 'Unverified straight line between draft stop pins',
      geometryLicense: 'Operator-authored draft',
      geometrySourceUrl: null,
      verifiedOn: new Date().toISOString().slice(0, 10),
      isApproximateGeometry: true,
      areStopsApproximate: true,
      notes: 'Verify the source, stop pins, and Google-generated road path before publishing.',
    },
    schedule: defaultSchedule('Asia/Kolkata'),
  };
}

function rebuildSegments(stops: readonly Stop[], existing: readonly RouteFixture['segments'][number][]): RouteFixture['segments'] {
  return stops.slice(0, -1).map((stop, index) => {
    const next = stops[index + 1]!;
    const match = existing.find((segment) => segment.fromStopId === stop.id && segment.toStopId === next.id);
    return {
      fromStopId: stop.id,
      toStopId: next.id,
      typicalSpeedMps: match?.typicalSpeedMps ?? mean(existing.map((segment) => segment.typicalSpeedMps), 6),
      dwellAllowanceS: match?.dwellAllowanceS ?? mean(existing.map((segment) => segment.dwellAllowanceS), 20),
    };
  });
}

function defaultSchedule(timezone: string): NonNullable<RouteFixture['schedule']> {
  return { source: 'Operator-entered timetable', timezone, isIllustrative: true, departures: [] };
}

function cloneRoute(route: RouteFixture): RouteFixture {
  return structuredClone(route);
}

function mean(values: readonly number[], fallback: number): number {
  return values.length === 0 ? fallback : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanSpeed(route: RouteFixture): number { return Number(mean(route.segments.map((segment) => segment.typicalSpeedMps), 6).toFixed(1)); }
function meanDwell(route: RouteFixture): number { return Math.round(mean(route.segments.map((segment) => segment.dwellAllowanceS), 20)); }
function roundCoordinate(value: number): number { return Number(value.toFixed(6)); }
function lines(value: string): string[] { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 200); }
function nullableUrl(value: string): string | null { return value.trim() === '' ? null : value.trim(); }
function slug(value: string): string { return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function nextRouteVersion(): string { return `admin-${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}`; }
