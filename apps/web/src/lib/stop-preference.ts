/**
 * The stop the passenger is waiting at.
 *
 * One value, stored once, read by every screen. The alternative — each screen
 * keeping its own idea of "my stop" — is how a page ends up showing one stop's
 * name above another stop's arrival time, and it is the specific bug this module
 * exists to make impossible.
 *
 * The key is the cross-route stop key from the server directory, not a
 * route-scoped stop ID, because the passenger's stop outlives the route they
 * happen to be looking at.
 */
const KEY = 'buskothay.stop';

export function loadStopKey(): string | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === null || value.length === 0 || value.length > 120 ? null : value;
  } catch {
    // Storage can be disabled. The session still works, it just starts fresh.
    return null;
  }
}

export function saveStopKey(key: string): void {
  try {
    window.localStorage.setItem(KEY, key);
  } catch {
    // Nothing to do: the in-memory selection is still correct for this page.
  }
}
