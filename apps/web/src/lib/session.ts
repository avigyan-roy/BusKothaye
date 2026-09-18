import type { JoinRole } from '@buskothay/shared';

/**
 * Contributor capabilities, held for this browser session only.
 *
 * `sessionStorage`, never `localStorage`: a capability that outlives the tab is a
 * capability someone forgot they were holding. The sequence counter lives beside
 * it because restarting at zero under the same capability would make every report
 * look like a duplicate.
 */

const KEY = 'buskothay.contributor';

export interface ContributorSession {
  readonly journeyId: string;
  readonly routeId: string;
  readonly contributorId: string;
  readonly token: string;
  readonly role: 'driver' | JoinRole;
  /** Present only for the person who created the journey. */
  readonly opsToken?: string;
  readonly joinCode?: string;
  readonly isDemo: boolean;
  readonly createdAtMs: number;
  /** Next sequence number to use. Persisted so a reload cannot reuse one. */
  readonly nextSeq: number;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Private windows and locked-down browsers can throw on access.
    return null;
  }
}

export function loadSession(): ContributorSession | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as ContributorSession;
    if (typeof parsed.journeyId !== 'string' || typeof parsed.token !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: ContributorSession): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(session));
  } catch {
    // Failing to persist is survivable: the controls still work for this page
    // view, they just will not come back after a reload.
  }
}

export function clearSession(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing useful to do; the in-memory state has already been cleared.
  }
}

export function advanceSeq(session: ContributorSession, used: number): ContributorSession {
  const next = { ...session, nextSeq: Math.max(session.nextSeq, used + 1) };
  saveSession(next);
  return next;
}

/**
 * The passenger's chosen stop. This is an ordinary preference, not a capability,
 * so it is allowed to survive the session in `localStorage`.
 */
const STOP_KEY = 'buskothay.stop';

export function loadPreferredStop(routeId: string): string | null {
  try {
    return window.localStorage.getItem(`${STOP_KEY}.${routeId}`);
  } catch {
    return null;
  }
}

export function savePreferredStop(routeId: string, stopId: string): void {
  try {
    window.localStorage.setItem(`${STOP_KEY}.${routeId}`, stopId);
  } catch {
    // A refused write only costs the person re-picking their stop next visit.
  }
}
