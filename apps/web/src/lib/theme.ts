import { useEffect, useState } from 'react';

/**
 * Dark by default, light on request, remembered.
 *
 * The attribute on `<html>` is the single source of truth: `index.html` sets it
 * before first paint from the stored choice, so there is no flash of the wrong
 * theme, and every stylesheet keys off it. This module is the only writer, and
 * it announces changes so that the parts of the page that are not CSS — the
 * Amazon Location basemap, notably — can follow along instead of staying dark under a
 * white page.
 */
export type Theme = 'dark' | 'light';

const KEY = 'buskothay.theme';
const EVENT = 'buskothay-theme-changed';

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function setTheme(next: Theme): void {
  document.documentElement.setAttribute('data-theme', next);
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Storage can be disabled; the choice still applies to this page.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme(): Theme {
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  useEffect(() => {
    const refresh = () => setThemeState(currentTheme());
    window.addEventListener(EVENT, refresh);
    return () => window.removeEventListener(EVENT, refresh);
  }, []);
  return theme;
}
