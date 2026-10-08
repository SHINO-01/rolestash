import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Job } from '@/domain/job';
import { laneStages, type Stage } from '@/domain/stage';
import { isPinned } from '@/platform/widget';
import { Kbd } from '@/ui/components/misc';
import { Tour, type TourEnd, type TourStepView } from '@/ui/components/tour';
import { useToast } from '@/ui/components/toast';
import { useLiveJobs, useServices } from '@/ui/hooks/services';
import {
  autoStartAllowed,
  BOARD_TOUR_KEY,
  boardTourSteps,
  E2E_AUTO_START_KEY,
  PRACTICE_JOB_KEY,
  PRACTICE_POSTING,
  practiceTaskDone,
  readTourRecord,
  shouldAutoStart,
  type BoardTourStep,
  type TourRecord,
} from './board-tour-steps';
import { BoardArt, CaptureArt, PinArt } from './tour-art';

const sel = (name: string) => `[data-tour~="${name}"]`;

/**
 * The board's guided tour (ADR-0039). It opens by itself the first time
 * the board does, and again from Help → Take the tour. A practice card is
 * added for the hands-on steps and removed when the tour ends, however it
 * ends (a closed tab clears it next time).
 */
export function useBoardTour({
  jobs,
  loaded,
  stages,
  accounts,
  autofill,
  openJobId,
  openCard,
  openProfile,
}: {
  jobs: readonly Job[];
  loaded: boolean;
  stages: readonly Stage[];
  accounts: boolean;
  autofill: boolean;
  openJobId: string | undefined;
  openCard: (id: string | undefined) => void;
  openProfile: () => void;
}): { active: boolean; start: () => void; element: ReactNode } {
  const { store, jobService } = useServices();
  const live = useLiveJobs();
  const toast = useToast();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [pinned, setPinned] = useState<boolean | undefined>(true);
  const [practiceId, setPracticeId] = useState<string>();
  /** No room for a practice card (a full Free board): the hands-on steps drop out. */
  const [practiceFailed, setPracticeFailed] = useState(false);
  const [startStageId, setStartStageId] = useState<string>();
  const checked = useRef(false);
  /** Counts tours, so a practice card that arrives after its tour ended is removed. */
  const run = useRef(0);
  useEffect(() => {
    if (!active) run.current += 1;
  }, [active]);

  const removePractice = useCallback(
    async (id: string | undefined) => {
      if (id) {
        await jobService.remove(id).catch(() => undefined);
        live.applyLocal([], [id]);
      }
      await store.remove([PRACTICE_JOB_KEY]);
    },
    [jobService, live, store],
  );

  // Once per page: tidy a practice card a closed tab left, then maybe start.
  useEffect(() => {
    if (!loaded || checked.current) return;
    checked.current = true;
    void Promise.all([
      store.get([BOARD_TOUR_KEY, PRACTICE_JOB_KEY, E2E_AUTO_START_KEY]),
      isPinned(),
    ]).then(async ([stored, pin]) => {
      setPinned(pin);
      const leftover = stored[PRACTICE_JOB_KEY];
      if (typeof leftover === 'string') await removePractice(leftover);
      if (
        autoStartAllowed(import.meta.env.MODE, stored) &&
        shouldAutoStart(readTourRecord(stored[BOARD_TOUR_KEY]))
      ) {
        setIndex(0);
        setActive(true);
      }
    });
  }, [loaded, store, removePractice]);

  const start = useCallback(() => {
    openCard(undefined);
    setPracticeFailed(false);
    void isPinned().then(setPinned);
    setIndex(0);
    setActive(true);
  }, [openCard]);

  const lanes = useMemo(() => laneStages(stages), [stages]);
  const practice = practiceId ? jobs.find((j) => j.id === practiceId) : undefined;
  const steps = useMemo(
    () => boardTourSteps({ accounts, autofill, pinned, practice: !practiceFailed }),
    [accounts, autofill, pinned, practiceFailed],
  );

  /** "Start the tour": add the practice card in the first lane (a full Free board skips it). */
  const addPractice = useCallback(async () => {
    const first = lanes[0];
    const thisRun = run.current;
    try {
      const job = await jobService.createManual({
        posting: PRACTICE_POSTING,
        ...(first ? { stageId: first.id } : {}),
      });
      await store.set({ [PRACTICE_JOB_KEY]: job.id });
      if (run.current !== thisRun) {
        await removePractice(job.id);
        return;
      }
      live.applyLocal([job]);
      setStartStageId(job.stageId);
      setPracticeId(job.id);
    } catch {
      // No room on the plan: the tour runs without the hands-on steps.
      setPracticeFailed(true);
    }
  }, [jobService, lanes, live, store, removePractice]);

  const end = useCallback(
    (how: TourEnd) => {
      const record: TourRecord = {
        status: how,
        at: new Date().toISOString(),
        ...(how === 'skipped' ? { step: steps[index] } : {}),
      };
      setActive(false);
      if (practiceId && openJobId === practiceId) openCard(undefined);
      void store.set({ [BOARD_TOUR_KEY]: record });
      void removePractice(practiceId);
      setPracticeId(undefined);
      toast({
        message:
          how === 'finished'
            ? 'You’re all set. Replay the tour any time from Help (?).'
            : 'Tour closed. Replay it any time from Help (?).',
        tone: how === 'finished' ? 'success' : 'info',
      });
    },
    [steps, index, practiceId, openJobId, openCard, store, removePractice, toast],
  );

  /** Moving between steps keeps the drawer in step: open on "card", closed elsewhere. */
  const go = useCallback(
    (next: number) => {
      const from = steps[index];
      const to = steps[next];
      if (from === 'welcome' && next > index && !practiceId) void addPractice();
      if (to === 'card' && practiceId && openJobId !== practiceId) openCard(practiceId);
      if (to !== 'card' && openJobId !== undefined && openJobId === practiceId) openCard(undefined);
      setIndex(next);
    },
    [steps, index, practiceId, openJobId, openCard, addPractice],
  );

  const views = useMemo(
    () =>
      steps.map((step) =>
        stepView(step, {
          lanes,
          practice,
          practiceSelector: practiceId ? `[data-job-id="${CSS.escape(practiceId)}"]` : undefined,
          done: practiceTaskDone(step, practice, startStageId, openJobId),
          openProfile: () => {
            end('finished');
            openProfile();
          },
        }),
      ),
    [steps, lanes, practice, practiceId, startStageId, openJobId, end, openProfile],
  );

  return {
    active,
    start,
    element: active ? <Tour steps={views} index={index} onIndex={go} onEnd={end} /> : null,
  };
}

function stepView(
  step: BoardTourStep,
  ctx: {
    lanes: readonly Stage[];
    practice: Job | undefined;
    practiceSelector: string | undefined;
    done: boolean;
    openProfile: () => void;
  },
): TourStepView {
  const second = ctx.lanes[1]?.name ?? 'the next lane';
  switch (step) {
    case 'welcome':
      return {
        id: step,
        title: 'Welcome to Rolestash',
        illustration: <BoardArt />,
        body: (
          <>
            <p>
              Rolestash keeps every job you’re going for on one board, from the moment you save it
              to the offer.
            </p>
            <p>
              This tour takes about two minutes. You’ll try a practice card, and we’ll remove it at
              the end. Skip it if you like. You can replay it any time from <b>Help (?)</b>.
            </p>
          </>
        ),
        placement: 'center',
      };
    case 'capture':
      return {
        id: step,
        title: 'Save jobs from the sites you already use',
        illustration: <CaptureArt />,
        body: (
          <>
            <p>
              Open a posting on LinkedIn, Seek, Indeed or any of the 50 job sites Rolestash knows. A{' '}
              <b>Save job</b> button sits at the edge of the page. Click it, check what Rolestash
              found, pick a lane, and save.
            </p>
            <p>
              Shortcut: <Kbd>Alt+J</Kbd>. Or right-click the page and choose{' '}
              <b>Track this job in Rolestash</b>.
            </p>
          </>
        ),
        placement: 'center',
      };
    case 'pin':
      return {
        id: step,
        title: 'Pin Rolestash to your toolbar',
        illustration: <PinArt />,
        body: (
          <p>
            Click the puzzle-piece icon in Chrome’s toolbar, then the pin next to Rolestash. Click
            the icon on any job posting to save it, or on any other page to come back to this board.
          </p>
        ),
        placement: 'center',
      };
    case 'lanes':
      return {
        id: step,
        title: 'One lane for each step',
        body: (
          <>
            <p>
              Cards move left to right as things progress: {ctx.lanes.map((l) => l.name).join(', ')}
              .
            </p>
            <p>
              We’ve added a practice card to <b>{ctx.lanes[0]?.name ?? 'the first lane'}</b>. You
              can rename lanes, change their colour or add your own from <b>⋯ → Edit columns</b>.
            </p>
          </>
        ),
        target: sel('board'),
        placement: 'bottom',
      };
    case 'drag':
      return {
        id: step,
        title: 'Move a card when things change',
        body: (
          <>
            <p>
              Drag a card into another lane. Moving it to {second} records the date you applied.
            </p>
            <p>
              With a keyboard: Tab to the card, press <Kbd>Space</Kbd>, move it with the arrow keys,
              then press <Kbd>Space</Kbd> again.
            </p>
          </>
        ),
        target: sel('board'),
        placement: 'bottom',
        task: { label: `drag the practice card to ${second}`, done: ctx.done },
      };
    case 'open-card':
      return {
        id: step,
        title: 'Open a card for the details',
        body: <p>Click a card, or press Enter on it, to see everything about that job.</p>,
        target: ctx.practiceSelector,
        placement: 'right',
        task: { label: 'click the practice card', done: ctx.done },
      };
    case 'card':
      return {
        id: step,
        title: 'Everything about one job',
        body: (
          <>
            <p>
              Change the lane or the priority stars at the top. Edit the details, add tags and keep
              notes below. <b>Open posting</b> takes you back to the ad.
            </p>
            <p>
              On Pro you can also set follow-up reminders and keep interview rounds, contacts and
              documents for each job. Archive or delete a job from the <b>⋯</b> menu.
            </p>
          </>
        ),
        target: sel('drawer'),
        placement: 'left',
      };
    case 'add':
      return {
        id: step,
        title: 'Add a job yourself',
        body: (
          <p>
            For a job from an email, a referral or a careers page Rolestash can’t read. Shortcut:{' '}
            <Kbd>N</Kbd>.
          </p>
        ),
        target: sel('add-job'),
        placement: 'bottom',
      };
    case 'search':
      return {
        id: step,
        title: 'Find any job fast',
        body: (
          <p>
            Search titles, companies, locations and tags. Press <Kbd>/</Kbd> to jump here, and{' '}
            <Kbd>Esc</Kbd> to clear it.
          </p>
        ),
        target: sel('search'),
        placement: 'bottom',
      };
    case 'insights':
      return {
        id: step,
        title: 'Insights',
        body: (
          <p>
            Applications per week, how far they get, where they end up, and which sources work best
            (Pro).
          </p>
        ),
        target: sel('insights'),
        placement: 'bottom',
      };
    case 'history':
      return {
        id: step,
        title: 'History',
        body: (
          <p>
            Jobs you archive and finished ones live here. Search them, open them and put any back on
            the board. Free keeps 30 days of history and Pro keeps all of it.
          </p>
        ),
        target: sel('history'),
        placement: 'bottom',
      };
    case 'select':
      return {
        id: step,
        title: 'Change many jobs at once',
        body: (
          <p>
            Click <b>Select</b>, or hold <Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> and click cards. Then move,
            tag, archive or delete them together (Pro).
          </p>
        ),
        target: sel('select'),
        placement: 'bottom',
      };
    case 'menu':
      return {
        id: step,
        title: 'Settings and exports live here',
        body: (
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <b>Edit columns</b>: rename, recolour, reorder or add lanes.
            </li>
            <li>
              <b>Export</b> to CSV or a calendar file, and <b>back up</b> or restore your board.
            </li>
            <li>
              Show the <b>Save job</b> button on every site, not only job sites.
            </li>
            <li>
              <b>Theme</b>: light, dark or match your system.
            </li>
          </ul>
        ),
        target: sel('board-menu'),
        placement: 'bottom',
      };
    case 'autofill':
      return {
        id: step,
        title: 'Fill in applications in one click',
        body: (
          <p>
            Save your name, contact details, links and résumé once in <b>⋯ → Autofill profile</b>.
            On an application form, open the Save job panel and click <b>Fill this application</b>.
            Your profile stays on this device.
          </p>
        ),
        target: sel('board-menu'),
        placement: 'bottom',
        action: { label: 'Set up autofill now', onClick: ctx.openProfile },
      };
    case 'account':
      return {
        id: step,
        title: 'An account is optional',
        body: (
          <>
            <p>Your board works without one. Sign in to try Pro free, which adds:</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>sync between computers, and the web board on your phone</li>
              <li>email updates that move cards when employers reply</li>
              <li>reminders, unlimited jobs and full history</li>
            </ul>
          </>
        ),
        target: sel('account'),
        placement: 'bottom',
      };
    case 'help':
      return {
        id: step,
        title: 'Help is here',
        body: (
          <p>
            Replay this tour, see the keyboard shortcuts, read the help pages or report a problem.
          </p>
        ),
        target: sel('help'),
        placement: 'bottom',
      };
    case 'done':
      return {
        id: step,
        title: 'You’re ready',
        illustration: <CaptureArt />,
        body: (
          <p>
            Open a job posting you like and click <b>Save job</b>. It will show up here. We’ll
            remove the practice card when you finish.
          </p>
        ),
        placement: 'center',
      };
  }
}
