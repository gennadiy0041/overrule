import { html, raw, type SafeHtml } from "./html";

/** A horizontal bar: `share` of the track filled. */
export function bar(share: number, colorClass = "bg-ink"): SafeHtml {
  const pct = Math.round(Math.min(1, Math.max(0, share)) * 100);
  return html`<div class="h-2 w-full overflow-hidden rounded-full bg-paper-2">
    <div class="${colorClass} h-full rounded-full" style="width:${pct}%"></div>
  </div>`;
}

/** A small line chart of a score over time, drawn as inline SVG (no JavaScript, prints cleanly). */
export function lineChart(values: ReadonlyArray<number>, label: string, width = 560, height = 140): SafeHtml {
  if (values.length < 2) return html``;
  const padX = 8;
  const padY = 14;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => padX + (i / (values.length - 1)) * (width - 2 * padX);
  const y = (v: number) => padY + (1 - (v - min) / span) * (height - 2 * padY);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const lastX = x(values.length - 1).toFixed(1);
  const lastY = y(values[values.length - 1]!).toFixed(1);
  // Coordinates are numbers we computed; `label` goes through the escaping template.
  return html`<svg viewBox="0 0 ${width} ${height}" class="h-auto w-full" role="img" aria-label="${label}">
    ${raw(
      `<polygon points="${padX},${height - padY} ${points.join(" ")} ${lastX},${height - padY}" fill="#14120F" fill-opacity="0.05"/>` +
        `<polyline points="${points.join(" ")}" fill="none" stroke="#14120F" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<circle cx="${lastX}" cy="${lastY}" r="4" fill="#D93A2B"/>`,
    )}
  </svg>`;
}
