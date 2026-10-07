/**
 * A tiny HTML template tag: every interpolated value is escaped unless it is
 * already Html (another template). Arrays are joined; null, undefined and
 * false render nothing. The dashboard builds every page with it, so text from
 * providers or the database can't inject markup.
 */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'string') return escapeHtml(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return escapeHtml(String(value));
  return ''; // objects never render: pass text, numbers or Html
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? '');
  });
  return new Html(out);
}
