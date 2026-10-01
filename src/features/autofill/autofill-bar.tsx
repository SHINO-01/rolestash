import { CheckCircle2, FileUp, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openBoard } from '@/platform/tabs';
import {
  AutofillBlockedError,
  type AutofillBlock,
  type AutofillOutcome,
} from '@/services/autofill-service';
import { Button } from '@/ui/components/button';
import { useServices } from '@/ui/hooks/services';

/** Why a question was left, for people. */
const LEFT_FOR_YOU = {
  sensitive: 'never filled automatically',
  no_value: 'not in your profile',
  unknown: 'needs your answer',
  no_option: 'choose this one yourself',
} as const;

/**
 * "Fill this application" in the popup (Advanced; ADR-0020). Fills the
 * current tab's form from the profile and says what's left to do.
 */
export function AutofillBar({ tabId }: { tabId: number | undefined }) {
  const { autofill } = useServices();
  const [status, setStatus] = useState<AutofillBlock | 'loading' | 'ready'>('loading');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<AutofillOutcome>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!autofill) return;
    let active = true;
    void autofill.blocked().then((block) => {
      if (active) setStatus(block ?? 'ready');
    });
    return () => {
      active = false;
    };
  }, [autofill]);

  // Off Advanced, the popup stays about capturing; Account explains plans.
  if (!autofill || status === 'plan' || status === 'loading' || tabId === undefined) return null;

  if (status === 'no_profile')
    return (
      <div className="border-line bg-surface mb-3 flex items-center justify-between gap-2 rounded-xl border p-3 text-sm">
        <span className="text-muted">Fill applications in one click.</span>
        <Button
          size="sm"
          onClick={() => void openBoard({ profile: true }).then(() => window.close())}
        >
          Set up autofill
        </Button>
      </div>
    );

  async function fill() {
    if (!autofill || tabId === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      setOutcome(await autofill.fill(tabId));
    } catch (e) {
      setError(
        e instanceof AutofillBlockedError
          ? e.message
          : 'Couldn’t fill this page. If the form is embedded from another site, open it on its own page and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const left = outcome?.skipped.filter((s) => s.reason !== 'filled_already') ?? [];
  return (
    <div className="border-line bg-surface mb-3 rounded-xl border p-3 text-sm">
      {!outcome ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Applying? Fill the form from your profile.</span>
          <Button
            size="sm"
            variant="primary"
            icon={<Wand2 className="size-3.5" />}
            loading={busy}
            onClick={() => void fill()}
          >
            Fill this application
          </Button>
        </div>
      ) : outcome.filled.length === 0 && left.length === 0 ? (
        <p className="text-muted">No application form found on this page.</p>
      ) : (
        <div role="status" className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            Filled {outcome.filled.length} {outcome.filled.length === 1 ? 'field' : 'fields'}. Check
            them, then submit yourself.
          </p>
          {outcome.files.length ? (
            <p className="text-muted flex items-center gap-1.5 text-[13px]">
              <FileUp className="size-3.5" /> Attach your résumé yourself.
            </p>
          ) : null}
          {left.length ? (
            <details className="text-[13px]">
              <summary className="text-muted cursor-pointer">
                {left.length} left for you
                {left.some((s) => s.required) ? ' (some required)' : ''}
              </summary>
              <ul className="text-muted mt-1.5 space-y-1">
                {left.map((s, i) => (
                  <li key={i}>
                    <span className="text-ink">{s.label || 'Unlabelled question'}</span>
                    {s.required ? ' *' : ''} · {LEFT_FOR_YOU[s.reason as keyof typeof LEFT_FOR_YOU]}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
      {error ? <p className="mt-2 text-[13px] text-rose-600 dark:text-rose-400">{error}</p> : null}
    </div>
  );
}
