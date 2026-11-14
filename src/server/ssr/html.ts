/**
 * A tiny HTML template tag for the server-rendered pages (SEO pages, the public
 * review report, /metrics). Every interpolated value is escaped unless it is
 * already `SafeHtml`, so user- and model-written text cannot inject markup.
 */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

function render(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  if (value === null || value === undefined || value === false || value === true) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) out += render(values[i]) + (strings[i + 1] ?? "");
  return new SafeHtml(out);
}

/** Mark a string we built ourselves as safe. Never pass user or model text. */
export function raw(trusted: string): SafeHtml {
  return new SafeHtml(trusted);
}

/** JSON for a <script type="application/ld+json"> block: "<" is escaped so it cannot close the tag. */
export function jsonForScript(value: unknown): SafeHtml {
  return new SafeHtml(JSON.stringify(value).replace(/</g, "\\u003c"));
}
