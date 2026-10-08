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
  firstAppearance,
  guideSteps,
  needsPractice,
  PRACTICE_JOB_KEY,
  PRACTICE_POSTING,
  practiceTaskDone,
  readTourRecord,
  type BoardTourContext,
  type BoardTourStep,
  type GuideTopic,
  type TourRecord,
} from './board-tour-steps';
import { BoardArt, CaptureArt, PinArt } from './tour-art';
import { TourInvite } from './tour-invite';

const sel = (name: string) => `[data-tour~="${name}"]`;
const cardSel = (id: string) => `[data-job-id="${CSS.escape(id)}"]`;

/** What is running: the whole tour, or one Help → How do I…? topic. */
export type TourSubject = 'full' | GuideTopic;

/**
 * The board's guided tour (ADR-0039). It opens by itself the first time
 * an empty board does; a board that already has jobs gets a corner card
 * offering it instead. Help → Take the full tour replays it, and Help →
 * How do I…? runs one feature's steps on their own. A practice card is
 * added for the hands-on steps and removed when the guide ends, however it
 * ends (a closed tab clears it next time). Nothing else on the board is
 * changed.
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
  prepare,
}: {
  jobs: readonly Job[];
  loaded: boolean;
  stages: readonly Stage[];
  accounts: boolean;
  autofill: boolean;
  openJobId: string | undefined;
  openCard: (id: string | undefined) => void;
  openProfile: () => void;
  /** Clears what would hide the practice card: search, selection, open dialogs. */
  prepare: () => void;
}): {
  /** A tour or guide is showing. */
  running: boolean;
  /** The corner card offering the tour is showing. */
  offered: boolean;
  start: (subject?: TourSubject) => void;
  element: ReactNode;
} {
  const { store, jobService } = useServices();
  const live = useLiveJobs();
  const toast = useToast();
  const [subject, setSubject] = useState<TourSubject | undefined>();
  const active = subject !== undefined;
  /** The corner card offering the tour to someone who already has jobs. */
  const [invite, setInvite] = useState(false);
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

  const lanes = useMemo(() => laneStages(stages), [stages]);
  const practice = practiceId ? jobs.find((j) => j.id === practiceId) : undefined;
  /** One of the person's own cards, for "open a card" when there's no practice card. */
  const ownCard = useMemo(
    () => jobs.find((j) => !j.archivedAt && j.id !== practiceId),
    [jobs, practiceId],
  );
  const ownJobs = jobs.filter((j) => j.id !== practiceId).length;

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

  /** A full Free board has no room for the practice card: know before step one. */
  const checkRoom = useCallback(async (): Promise<boolean> => {
    const check = await jobService.limitCheck().catch(() => undefined);
    const room = check?.allowed !== false;
    setPracticeFailed(!room);
    return room;
  }, [jobService]);

  /** Adds the practice card at the top of the first lane. */
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
      // No room on the plan: the guide runs without the hands-on steps.
      setPracticeFailed(true);
    }
  }, [jobService, lanes, live, store, removePractice]);

  const context = useCallback(
    (practiceOk: boolean): BoardTourContext => ({
      accounts,
      autofill,
      pinned,
      practice: practiceOk,
      ownJob: ownCard !== undefined,
    }),
    [accounts, autofill, pinned, ownCard],
  );
  const steps = useMemo(
    () =>
      subject === undefined
        ? []
        : subject === 'full'
          ? boardTourSteps(context(!practiceFailed))
          : guideSteps(subject, context(!practiceFailed)),
    [subject, context, practiceFailed],
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
      const own = jobs.filter((j) => j.id !== leftover).length;
      if (typeof leftover === 'string') await removePractice(leftover);
      if (!autoStartAllowed(import.meta.env.MODE, stored)) return;
      const how = firstAppearance(readTourRecord(stored[BOARD_TOUR_KEY]), own);
      if (how === 'invite') setInvite(true);
      if (how === 'tour') {
        await checkRoom();
        setIndex(0);
        setSubject('full');
      }
    });
  }, [loaded, jobs, store, removePractice, checkRoom]);

  const start = useCallback(
    (next: TourSubject = 'full') => {
      prepare();
      openCard(undefined);
      setInvite(false);
      void isPinned().then(setPinned);
      void checkRoom().then((room) => {
        // A topic with hands-on steps gets its practice card straight away;
        // the full tour adds it after the welcome, so skipping there adds nothing.
        if (next !== 'full' && room && needsPractice(guideSteps(next, context(true))))
          void addPractice();
        setIndex(0);
        setSubject(next);
      });
    },
    [prepare, openCard, checkRoom, context, addPractice],
  );

  /** "Not now" on the corner card: it doesn't come back; Help still has the tour. */
  const declineInvite = useCallback(() => {
    setInvite(false);
    const record: TourRecord = { status: 'skipped', at: new Date().toISOString(), step: 'invite' };
    void store.set({ [BOARD_TOUR_KEY]: record });
    toast({ message: 'You can take the tour any time from Help (?).', tone: 'info' });
  }, [store, toast]);

  const end = useCallback(
    (how: TourEnd) => {
      const step = steps[index];
      setSubject(undefined);
      // A card the guide was about closes with it.
      if (openJobId && (openJobId === practiceId || step === 'card' || step === 'open-card'))
        openCard(undefined);
      void removePractice(practiceId);
      setPracticeId(undefined);
      // Only the full tour is remembered; a single topic leaves the record alone.
      if (subject !== 'full') return;
      const record: TourRecord = {
        status: how,
        at: new Date().toISOString(),
        ...(how === 'skipped' && step ? { step } : {}),
      };
      void store.set({ [BOARD_TOUR_KEY]: record });
      toast({
        message:
          how === 'finished'
            ? 'You’re all set. Replay the tour, or one feature, from Help (?).'
            : 'Tour closed. Replay it, or one feature, from Help (?).',
        tone: how === 'finished' ? 'success' : 'info',
      });
    },
    [steps, index, subject, practiceId, openJobId, openCard, store, removePractice, toast],
  );

  /** The card the "card" step shows: the practice card, else one of theirs. */
  const shownCardId = practiceId ?? ownCard?.id;

  /** Moving between steps keeps the drawer in step: open on "card", closed elsewhere. */
  const go = useCallback(
    (next: number) => {
      const from = steps[index];
      const to = steps[next];
      if (from === 'welcome' && next > index && !practiceId && !practiceFailed) void addPractice();
      if (to === 'card' && openJobId === undefined && shownCardId) openCard(shownCardId);
      if (to !== 'card' && openJobId !== undefined && (from === 'card' || openJobId === practiceId))
        openCard(undefined);
      setIndex(next);
    },
    [steps, index, practiceId, practiceFailed, openJobId, shownCardId, openCard, addPractice],
  );

  const views = useMemo(
    () =>
      steps.map((step) =>
        stepView(step, {
          lanes,
          practice,
          practiceFailed,
          returning: ownJobs > 0,
          practiceSelector: practiceId ? cardSel(practiceId) : undefined,
          cardSelector: shownCardId ? cardSel(shownCardId) : undefined,
          done: practiceTaskDone(step, practice, startStageId, openJobId),
          openProfile: () => {
            end('finished');
            openProfile();
          },
        }),
      ),
    [
      steps,
      lanes,
      practice,
      practiceFailed,
      ownJobs,
      practiceId,
      shownCardId,
      startStageId,
      openJobId,
      end,
      openProfile,
    ],
  );

  const full = subject === 'full';
  return {
    // A topic with nothing to show here (it can't happen in practice) shows nothing.
    running: active && views.length > 0,
    offered: invite,
    start,
    element: active ? (
      views.length ? (
        <Tour
          steps={views}
          index={index}
          onIndex={go}
          onEnd={end}
          {...(full
            ? { startLabel: 'Start the tour' }
            : { finishLabel: 'Done', skipLabel: null, closeLabel: 'Close guide' })}
        />
      ) : null
    ) : invite ? (
      <TourInvite onStart={() => start('full')} onDecline={declineInvite} />
    ) : null,
  };
}

function stepView(
  step: BoardTourStep,
  ctx: {
    lanes: readonly Stage[];
    practice: Job | undefined;
    /** No room for a practice card: the copy mustn't promise one. */
    practiceFailed: boolean;
    /** The board already has the person's own jobs. */
    returning: boolean;
    practiceSelector: string | undefined;
    /** The card "open a card" points at: the practice card, else one of theirs. */
    cardSelector: string | undefined;
    done: boolean;
    openProfile: () => void;
  },
): TourStepView {
  const second = ctx.lanes[1]?.name ?? 'the next lane';
  switch (step) {
    case 'welcome':
      return {
        id: step,
        title: ctx.returning ? 'A tour of Rolestash' : 'Welcome to Rolestash',
        illustration: <BoardArt />,
        body: (
          <>
            <p>
              {ctx.returning
                ? 'Every part of your board, step by step, including the ones that hide in menus.'
                : 'Rolestash keeps every job you’re going for on one board, from the moment you save it to the offer.'}
            </p>
            <p>
              It takes about two minutes.{' '}
              {ctx.practiceFailed
                ? ''
                : ctx.returning
                  ? 'You’ll try things on a practice card, which we remove at the end. Your own jobs stay exactly as they are. '
                  : 'You’ll try a practice card, and we’ll remove it at the end. '}
              Skip it if you like. You can replay it any time from <b>Help (?)</b>.
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
              {ctx.practiceFailed ? null : (
                <>
                  We’ve added a practice card at the top of{' '}
                  <b>{ctx.lanes[0]?.name ?? 'the first lane'}</b>.{' '}
                </>
              )}
              You can rename lanes, change their colour or add your own from <b>⋯ → Edit columns</b>
              .
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
              With a keyboard: use <b>Go to the card</b> below, press <Kbd>Space</Kbd>, move it with
              the arrow keys, then press <Kbd>Space</Kbd> again. Or open the card and pick its lane
              at the top.
            </p>
          </>
        ),
        target: sel('board'),
        highlight: ctx.practiceSelector,
        placement: 'bottom',
        task: {
          label: `drag the practice card (ringed) to ${second}`,
          done: ctx.done,
          focus: ctx.practiceSelector,
        },
      };
    case 'open-card':
      return {
        id: step,
        title: 'Open a card for the details',
        body: <p>Click a card, or press Enter on it, to see everything about that job.</p>,
        target: ctx.cardSelector,
        placement: 'right',
        task: {
          label: ctx.practice ? 'click the practice card' : 'click any card',
          done: ctx.done,
          focus: ctx.cardSelector,
        },
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
            Open a job posting you like and click <b>Save job</b>. It will show up here.
            {ctx.practice ? ' We’ll remove the practice card when you finish.' : ''}
          </p>
        ),
        placement: 'center',
      };
  }
}
