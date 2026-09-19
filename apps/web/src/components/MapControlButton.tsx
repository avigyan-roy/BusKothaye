import type { ReactNode } from 'react';
import './map-control-button.css';

/**
 * A floating control over the map.
 *
 * Icon only, because a row of word buttons would compete with the map for
 * attention — so every one of them carries an accessible name and a tooltip
 * instead. The touch area is 44px whatever the icon inside it measures.
 *
 * `isActive` drives `aria-pressed`, so a control that is currently on (following
 * the bus, for instance) says so to a screen reader as well as showing it.
 */
export function MapControlButton({
  label,
  onClick,
  icon,
  isActive,
  isBusy = false,
  disabled = false,
  expanded,
  controls,
}: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  isActive?: boolean;
  isBusy?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      className={`map-control${isActive === true ? ' map-control--active' : ''}`}
      onClick={onClick}
      disabled={disabled || isBusy}
      aria-label={label}
      title={label}
      {...(isActive === undefined ? {} : { 'aria-pressed': isActive })}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      {...(controls === undefined ? {} : { 'aria-controls': controls })}
    >
      <span className="map-control__icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

/*
 * The icon set. Monochrome, 20px, stroked in the current colour so a control can
 * change state without swapping artwork. Nothing decorative and no emoji.
 */

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const icons = {
  menu: (
    <Svg>
      <path d="M3 5h14M3 10h14M3 15h14" />
    </Svg>
  ),
  close: (
    <Svg>
      <path d="M5 5l10 10M15 5L5 15" />
    </Svg>
  ),
  /** Locate me: the familiar crosshair, never the bus marker. */
  locate: (
    <Svg>
      <circle cx="10" cy="10" r="4" />
      <path d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5" />
    </Svg>
  ),
  /** Follow the bus: a vehicle inside a viewfinder. */
  followBus: (
    <Svg>
      <rect x="6.5" y="4.5" width="7" height="8.5" rx="1.5" />
      <path d="M6.5 10h7M8.5 15.5h.01M11.5 15.5h.01" />
      <path d="M2.5 5.5v-3h3M17.5 5.5v-3h-3M2.5 14.5v3h3M17.5 14.5v3h-3" />
    </Svg>
  ),
  /** Fit the whole route into view. */
  wholeRoute: (
    <Svg>
      <path d="M4 15.5c0-4 3.5-4 6-5.5s2.5-5.5-1-5.5" />
      <circle cx="4" cy="15.5" r="2" />
      <circle cx="16" cy="4.5" r="2" />
    </Svg>
  ),
  chevronUp: (
    <Svg>
      <path d="M5 12.5l5-5 5 5" />
    </Svg>
  ),
  chevronDown: (
    <Svg>
      <path d="M5 7.5l5 5 5-5" />
    </Svg>
  ),
} as const;
