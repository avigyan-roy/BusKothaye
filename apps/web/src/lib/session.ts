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
  /** Present when the passenger joined from the map's explicit boarding action. */
  readonly joinedVia?: 'boarding' | 'join-code';
  readonly boardedStopId?: string;
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
    if (
      typeof parsed.journeyId !== 'string' ||
      typeof parsed.routeId !== 'string' ||
      typeof parsed.contributorId !== 'string' ||
      typeof parsed.token !== 'string' ||
      !['driver', 'passenger', 'conductor'].includes(parsed.role) ||
      typeof parsed.isDemo !== 'boolean' ||
      (parsed.joinedVia !== undefined && !['boarding', 'join-code'].includes(parsed.joinedVia)) ||
      (parsed.boardedStopId !== undefined && typeof parsed.boardedStopId !== 'string') ||
      !Number.isSafeInteger(parsed.createdAtMs) ||
      !Number.isSafeInteger(parsed.nextSeq) ||
      parsed.nextSeq < 0
    ) {
      store.removeItem(KEY);
      return null;
    }
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

/**
 * Reserve sequence numbers before reports enter the in-memory queue.
 *
 * Persisting the reservation first means a reload or crash can skip numbers but
 * can never reuse a number that may already have reached the API.
 */
export function reserveSeq(
  session: ContributorSession,
  count = 1,
): { readonly firstSeq: number; readonly session: ContributorSession } {
  const safeCount = Number.isSafeInteger(count) && count > 0 ? count : 1;
  const next = { ...session, nextSeq: session.nextSeq + safeCount };
  saveSession(next);
  return { firstSeq: session.nextSeq, session: next };
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
