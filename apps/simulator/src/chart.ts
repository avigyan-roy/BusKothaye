import type { JourneyMode } from '@buskothay/shared';
import type { Sample } from './runner.js';

/**
 * A standalone SVG of truth against estimate for one run.
 *
 * Two series, one y-axis, drawn on its own light surface so it renders the same
 * in a browser, a pull request and a document. The colours are the two-series
 * pair validated for colour-vision separation against the project surface
 * (`#F5F4EF`): amber for the truth the simulator owns, green for the estimate the
 * server published. Both are also labelled directly, so identity never rests on
 * colour alone, and the accompanying CSV is the table view of the same numbers.
 *
 * This is a diagnostic artefact for the team, not a passenger-facing surface —
 * the passenger map deliberately has no charts on it.
 */

const TRUTH_COLOR = '#B4651A';
const ESTIMATE_COLOR = '#12805A';
const SURFACE = '#F5F4EF';
const PANEL = '#FFFFFF';
const INK = '#202923';
const MUTED = '#59635C';
const GRID = '#D8DED6';
const ESTIMATED_BAND = '#FFF0D6';
const STALE_BAND = '#E8E6DF';

const WIDTH = 900;
const HEIGHT = 420;
const MARGIN = { top: 44, right: 132, bottom: 48, left: 72 };

export function renderChartSvg(samples: readonly Sample[], title: string): string {
  const plotted = samples.filter((s) => Number.isFinite(s.truthSM));
  if (plotted.length === 0) {
    return emptyChart(title, 'This run produced no samples.');
  }

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const tMax = Math.max(...plotted.map((s) => s.tS), 1);
  const values = plotted.flatMap((s) => [
    s.truthSM,
    ...(s.estimateSM === null ? [] : [s.estimateSM]),
  ]);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const yPad = Math.max(40, (yMax - yMin) * 0.12);
  const lo = yMin - yPad;
  const hi = yMax + yPad;

  const x = (tS: number) => MARGIN.left + (tS / tMax) * plotW;
  const y = (sM: number) => MARGIN.top + plotH - ((sM - lo) / (hi - lo)) * plotH;

  const parts: string[] = [];

  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="${SURFACE}"/>`);
  parts.push(
    `<rect x="${MARGIN.left}" y="${MARGIN.top}" width="${plotW}" height="${plotH}" fill="${PANEL}"/>`,
  );

  // Mode shading behind the data: where the server was estimating rather than
  // tracking, and where it had frozen the estimate.
  for (const band of modeBands(plotted)) {
    const fill =
      band.mode === 'ESTIMATED' ? ESTIMATED_BAND : band.mode === 'STALE' ? STALE_BAND : null;
    if (fill === null) continue;
    const bx = x(band.fromS);
    const bw = Math.max(1, x(band.toS) - bx);
    parts.push(
      `<rect x="${bx.toFixed(1)}" y="${MARGIN.top}" width="${bw.toFixed(1)}" height="${plotH}" fill="${fill}"/>`,
    );
    if (bw > 46) {
      parts.push(
        `<text x="${(bx + bw / 2).toFixed(1)}" y="${MARGIN.top + 14}" fill="${MUTED}" font-size="11" text-anchor="middle" font-family="${FONT}">${band.mode.toLowerCase()}</text>`,
      );
    }
  }

  // Recessive grid and axis labels.
  for (const tick of niceTicks(lo, hi, 5)) {
    const ty = y(tick);
    parts.push(
      `<line x1="${MARGIN.left}" y1="${ty.toFixed(1)}" x2="${MARGIN.left + plotW}" y2="${ty.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`,
      `<text x="${MARGIN.left - 10}" y="${(ty + 4).toFixed(1)}" fill="${MUTED}" font-size="12" text-anchor="end" font-family="${FONT}">${(tick / 1000).toFixed(1)} km</text>`,
    );
  }
  for (const tick of niceTicks(0, tMax, 6)) {
    const tx = x(tick);
    parts.push(
      `<text x="${tx.toFixed(1)}" y="${(MARGIN.top + plotH + 20).toFixed(1)}" fill="${MUTED}" font-size="12" text-anchor="middle" font-family="${FONT}">${Math.round(tick)}s</text>`,
    );
  }

  // Confidence band around the estimate, in real metres on the same axis.
  const bandTop: string[] = [];
  const bandBottom: string[] = [];
  for (const sample of plotted) {
    if (sample.estimateSM === null || sample.confidenceM === null) continue;
    bandTop.push(`${x(sample.tS).toFixed(1)},${y(sample.estimateSM + sample.confidenceM).toFixed(1)}`);
    bandBottom.unshift(
      `${x(sample.tS).toFixed(1)},${y(sample.estimateSM - sample.confidenceM).toFixed(1)}`,
    );
  }
  if (bandTop.length > 1) {
    parts.push(
      `<polygon points="${[...bandTop, ...bandBottom].join(' ')}" fill="${ESTIMATE_COLOR}" fill-opacity="0.14"/>`,
    );
  }

  parts.push(polyline(plotted.map((s) => [x(s.tS), y(s.truthSM)]), TRUTH_COLOR));
  parts.push(
    polyline(
      plotted
        .filter((s) => s.estimateSM !== null)
        .map((s) => [x(s.tS), y(s.estimateSM!)]),
      ESTIMATE_COLOR,
    ),
  );

  // Direct labels at the right edge: a colour swatch beside ink text, so the
  // series are identified without relying on colour.
  const lastTruth = plotted[plotted.length - 1]!;
  const lastEstimate = [...plotted].reverse().find((s) => s.estimateSM !== null);
  parts.push(directLabel(MARGIN.left + plotW + 12, y(lastTruth.truthSM), 'True position', TRUTH_COLOR));
  if (lastEstimate?.estimateSM != null) {
    parts.push(
      directLabel(
        MARGIN.left + plotW + 12,
        y(lastEstimate.estimateSM),
        'Estimate',
        ESTIMATE_COLOR,
      ),
    );
  }

  parts.push(
    `<text x="${MARGIN.left}" y="24" fill="${INK}" font-size="16" font-weight="600" font-family="${FONT}">${escapeXml(title)}</text>`,
    `<text x="${MARGIN.left}" y="${HEIGHT - 12}" fill="${MUTED}" font-size="11" font-family="${FONT}">Distance along AC24 against elapsed time. Shaded bands are the server's own tracking mode. Green band is the published approximate accuracy.</text>`,
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(title)}: true position and estimated position against time">`,
    ...parts,
    '</svg>',
  ].join('\n');
}

const FONT = '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';

function polyline(points: readonly [number, number][], color: string): string {
  if (points.length < 2) return '';
  const d = points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  return `<polyline points="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function directLabel(px: number, py: number, text: string, color: string): string {
  return [
    `<rect x="${px.toFixed(1)}" y="${(py - 5).toFixed(1)}" width="9" height="9" rx="2" fill="${color}"/>`,
    `<text x="${(px + 14).toFixed(1)}" y="${(py + 4).toFixed(1)}" fill="${INK}" font-size="12" font-family="${FONT}">${escapeXml(text)}</text>`,
  ].join('');
}

interface ModeBand {
  readonly mode: JourneyMode;
  readonly fromS: number;
  readonly toS: number;
}

function modeBands(samples: readonly Sample[]): ModeBand[] {
  const bands: ModeBand[] = [];
  let current: { mode: JourneyMode; fromS: number } | null = null;
  for (const sample of samples) {
    if (current === null) {
      current = { mode: sample.mode, fromS: sample.tS };
      continue;
    }
    if (sample.mode !== current.mode) {
      bands.push({ mode: current.mode, fromS: current.fromS, toS: sample.tS });
      current = { mode: sample.mode, fromS: sample.tS };
    }
  }
  if (current !== null) {
    bands.push({
      mode: current.mode,
      fromS: current.fromS,
      toS: samples[samples.length - 1]!.tS,
    });
  }
  return bands;
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  return ticks;
}

function emptyChart(title: string, message: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="160" viewBox="0 0 ${WIDTH} 160" role="img" aria-label="${escapeXml(title)}">
<rect width="${WIDTH}" height="160" fill="${SURFACE}"/>
<text x="24" y="40" fill="${INK}" font-size="16" font-weight="600" font-family="${FONT}">${escapeXml(title)}</text>
<text x="24" y="70" fill="${MUTED}" font-size="13" font-family="${FONT}">${escapeXml(message)}</text>
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
