import { classifyEmploymentTypes } from '../normalize/classifiers';
import { toIsoDate } from '../normalize/dates';
import { parseSalaryText } from '../normalize/salary';
import { cleanText, elementToText } from '../normalize/text';
import type { ExtractionContext, Strategy, StrategyOutput } from '../types';
import { defaultCurrencyFor, put } from './shared';

/** schema.org JobPosting expressed as HTML microdata (`itemscope`/`itemprop`). */

const CONFIDENCE = 0.9;

/** Properties belonging directly to `scope` (not to a nested itemscope). */
function props(scope: Element, name: string): Element[] {
  return [...scope.querySelectorAll(`[itemprop~="${name}"]`)].filter((el) => {
    const owner = el.parentElement?.closest('[itemscope]');
    return owner === scope;
  });
}

function propValue(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attr =
    el.getAttribute('content') ??
    (tag === 'time' ? el.getAttribute('datetime') : null) ??
    (tag === 'a' || tag === 'link' ? el.getAttribute('href') : null) ??
    (tag === 'meta' ? '' : null);
  return cleanText(attr ?? el.textContent);
}

function prop(scope: Element, name: string): string | undefined {
  const el = props(scope, name)[0];
  if (!el) return undefined;
  if (el.hasAttribute('itemscope')) {
    const nameEl = props(el, 'name')[0];
    return nameEl ? propValue(nameEl) : cleanText(el.textContent);
  }
  return propValue(el) || undefined;
}

function locationOf(scope: Element): string | undefined {
  const values = props(scope, 'jobLocation').map((loc) => {
    if (!loc.hasAttribute('itemscope')) return cleanText(loc.textContent);
    const address = props(loc, 'address')[0];
    const target = address?.hasAttribute('itemscope') ? address : loc;
    const parts = ['addressLocality', 'addressRegion', 'addressCountry']
      .map((p) => prop(target, p))
      .filter(Boolean);
    return parts.length ? parts.join(', ') : cleanText((address ?? loc).textContent);
  });
  const unique = [...new Set(values.filter(Boolean))];
  return unique.length ? unique.slice(0, 3).join('; ') : undefined;
}

export const microdataStrategy: Strategy = {
  id: 'microdata',
  run(ctx: ExtractionContext): StrategyOutput {
    const scope = ctx.doc.querySelector('[itemscope][itemtype*="schema.org/JobPosting" i]');
    if (!scope) return {};
    const out: StrategyOutput = {};
    const s = 'microdata' as const;

    put(out, 'title', prop(scope, 'title') ?? prop(scope, 'name'), CONFIDENCE, s);
    put(out, 'company', prop(scope, 'hiringOrganization'), CONFIDENCE, s);
    put(out, 'location', locationOf(scope), CONFIDENCE, s);
    put(
      out,
      'employmentTypes',
      classifyEmploymentTypes(props(scope, 'employmentType').map(propValue)),
      CONFIDENCE,
      s,
    );
    put(out, 'postedAt', toIsoDate(prop(scope, 'datePosted'), ctx.now), CONFIDENCE, s);
    put(out, 'closesAt', toIsoDate(prop(scope, 'validThrough'), ctx.now), CONFIDENCE, s);

    const salaryEl = props(scope, 'baseSalary')[0];
    if (salaryEl) {
      const salary = parseSalaryText(cleanText(salaryEl.textContent), defaultCurrencyFor(ctx));
      if (salary?.min !== undefined) put(out, 'salary', salary, CONFIDENCE, s);
    }

    const descEl = props(scope, 'description')[0];
    if (descEl) put(out, 'description', elementToText(descEl), CONFIDENCE, s);
    put(out, 'externalId', prop(scope, 'identifier'), CONFIDENCE, s);
    return out;
  },
};
