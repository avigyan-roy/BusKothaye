import { useEffect, useRef, type ReactNode } from 'react';
import { DemoBadge } from '../../components/Header.js';
import { icons } from '../../components/MapControlButton.js';
import { en } from '../../content/en.js';
import './journey-sheet.css';

/**
 * The journey sheet: a bottom sheet on a phone, a left drawer on a wide screen.
 *
 * One component and one DOM tree for both — the difference is entirely in CSS, so
 * there is no second application tree to keep in step and no state that survives
 * only on one size of screen.
 *
 * Two details are deliberate. Dragging is not implemented: a button that says
 * what it does is more reliable than a gesture, and the brief prefers it to
 * fragile pointer code. And the collapsed detail region is marked `inert` rather
 * than merely hidden by overflow, so a keyboard never lands on a control that a
 * person cannot see.
 *
 * Two measurements are published as custom properties, because both are decided
 * by content that varies — a long stop name makes the summary taller:
 *
 *   --sheet-measured-h  on the page, so the map controls and the map attribution
 *                       always sit above the sheet, including while it opens.
 *   --summary-h         on the sheet, so the scrolling detail region can be given
 *                       exactly the space the summary is not using. That is what
 *                       makes the open/close transition animate a real height
 *                       without ever clipping the bottom of the list.
 */
export function JourneySheet({
  routeCode,
  routeDirection,
  isDemo,
  isExpanded,
  onToggle,
  summary,
  children,
}: {
  routeCode: string;
  routeDirection: string;
  isDemo: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    detailRef.current?.toggleAttribute('inert', !isExpanded);
  }, [isExpanded]);

  useEffect(() => {
    const sheet = sheetRef.current;
    const summary = summaryRef.current;
    const page = sheet?.parentElement ?? null;
    if (sheet === null || summary === null || page === null) return;
    const publish = () => {
      page.style.setProperty(
        '--sheet-measured-h',
        `${Math.round(sheet.getBoundingClientRect().height)}px`,
      );
      sheet.style.setProperty(
        '--summary-h',
        `${Math.round(summary.getBoundingClientRect().height)}px`,
      );
    };
    const observer = new ResizeObserver(publish);
    observer.observe(sheet);
    observer.observe(summary);
    publish();
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sheetRef}
      className="journey-sheet route-page__panel"
      aria-label={en.sheet.label}
      data-expanded={isExpanded ? 'true' : 'false'}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isExpanded) {
          event.stopPropagation();
          onToggle();
          toggleRef.current?.focus();
        }
      }}
    >
      <div ref={summaryRef} className="journey-sheet__summary">
        <div className="journey-sheet__identity">
          <span className="route-badge">{routeCode}</span>
          {isDemo ? (
            <span className="route-page__demo">
              <DemoBadge />
            </span>
          ) : null}
          <span className="journey-sheet__direction">{routeDirection}</span>
          <button
            ref={toggleRef}
            type="button"
            className="journey-sheet__toggle"
            aria-expanded={isExpanded}
            aria-controls="journey-detail"
            onClick={onToggle}
          >
            <span className="visually-hidden">
              {isExpanded ? en.sheet.collapse : en.sheet.expand}
            </span>
            <span className="journey-sheet__chevron" aria-hidden="true">
              {isExpanded ? icons.chevronDown : icons.chevronUp}
            </span>
          </button>
        </div>

        {summary}
      </div>

      <div id="journey-detail" ref={detailRef} className="journey-sheet__detail">
        <div className="journey-sheet__detail-inner">
          {isDemo ? (
            <p className="meta journey-sheet__section">{en.common.demoJourney}</p>
          ) : null}
          {children}
        </div>
      </div>
    </section>
  );
}
