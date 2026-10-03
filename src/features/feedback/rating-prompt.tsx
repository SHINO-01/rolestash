import { Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { STORE_REVIEWS_URL } from '@/domain/feedback';
import type { FeedbackService } from '@/services/feedback-service';
import { Button, ButtonLink, IconButton } from '@/ui/components/button';

/**
 * Asks for a Chrome Web Store rating (ADR-0024), only after real use (10
 * jobs over a week), at most three times a month apart. A small card in the
 * corner of the board: it never blocks the board and never asks twice in a
 * visit. Rating or "Don't ask again" ends it for good.
 */
export function RatingPrompt({ feedback }: { feedback: FeedbackService }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let live = true;
    // A moment after the board settles, so it never competes with loading.
    const timer = setTimeout(() => {
      void feedback.shouldAskForRating().then((ask) => live && setShow(ask));
    }, 4000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [feedback]);

  if (!show) return null;
  const answer = (choice: 'rate' | 'later' | 'never') => {
    setShow(false);
    void feedback.answerRating(choice);
  };
  return (
    <aside
      aria-label="Rate Rolestash"
      className="animate-rise border-line bg-surface shadow-lift fixed bottom-5 left-5 z-30 w-[min(340px,calc(100vw-2.5rem))] rounded-2xl border p-4"
    >
      <div className="flex items-start gap-3">
        <span className="bg-accent-soft text-accent flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Star className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Is Rolestash helping your search?</p>
          <p className="text-muted mt-1 text-[13px] leading-snug">
            A rating on the Chrome Web Store helps other job seekers find it. It takes a few
            seconds.
          </p>
        </div>
        <IconButton label="Not now" size="sm" onClick={() => answer('later')}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
        <ButtonLink
          variant="primary"
          size="sm"
          href={STORE_REVIEWS_URL}
          onClick={() => answer('rate')}
        >
          Rate Rolestash
        </ButtonLink>
        <Button variant="ghost" size="sm" onClick={() => answer('later')}>
          Not now
        </Button>
        <button
          type="button"
          className="text-subtle hover:text-muted ml-auto text-xs underline-offset-2 hover:underline"
          onClick={() => answer('never')}
        >
          Don’t ask again
        </button>
      </div>
    </aside>
  );
}
