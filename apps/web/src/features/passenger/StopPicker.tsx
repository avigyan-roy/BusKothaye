import { useEffect, useMemo, useRef, useState } from 'react';
import type { DirectoryStop } from '@buskothay/shared';
import { en } from '../../content/en.js';
import './stop-picker.css';

/**
 * Choosing a stop, from the server's directory and nothing else.
 *
 * A native `<dialog>` because the browser already provides Escape-to-close, a
 * focus trap, inert content behind it and focus returning where it came from.
 * Matching is done on the same normalised key the server joins routes on, so
 * typing "park street", "Park-Street" or "PARKSTREET" all find the one stop.
 */
export function StopPicker({
  title,
  stops,
  onChoose,
  onClose,
}: {
  title: string;
  stops: readonly DirectoryStop[];
  onChoose: (stop: DirectoryStop) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length === 0) return stops;
    return stops.filter((stop) => stop.name.toLocaleLowerCase().includes(needle));
  }, [query, stops]);

  return (
    <dialog
      ref={dialogRef}
      className="stop-picker"
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <header className="stop-picker__head">
        <h2>{title}</h2>
        <input
          /* The dialog exists to be typed into; focusing it saves a tap on a
             phone and matches how every other search sheet behaves. */
          autoFocus
          className="search-input"
          value={query}
          placeholder={en.find.stopSearchPlaceholder}
          aria-label={en.find.stopSearchPlaceholder}
          onChange={(event) => setQuery(event.target.value.slice(0, 80))}
        />
      </header>

      <div className="stop-picker__list">
        {matches.length === 0 ? (
          <p className="stop-picker__empty">
            <b>{en.find.noStopMatch(query.trim())}</b>
            <span>{en.find.noStopMatchHelp}</span>
          </p>
        ) : (
          matches.map((stop) => (
            <button key={stop.key} type="button" onClick={() => onChoose(stop)}>
              <i aria-hidden="true" />
              <span>
                <b>{stop.name}</b>
                <small>{routeSummary(stop)}</small>
              </span>
            </button>
          ))
        )}
      </div>

      <footer className="stop-picker__foot">
        <button className="button button--secondary" type="button" onClick={onClose}>
          {en.contribute.cancel}
        </button>
      </footer>
    </dialog>
  );
}

/** "AC24, AC30" — which buses call here, from the directory, never hardcoded. */
function routeSummary(stop: DirectoryStop): string {
  const codes = [...new Set(stop.routes.map((route) => route.code))];
  return codes.slice(0, 4).join(', ') + (codes.length > 4 ? '…' : '');
}
