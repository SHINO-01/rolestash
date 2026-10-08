import {
  ArrowRightLeft,
  BarChart3,
  ChevronRight,
  Columns3,
  Compass,
  History,
  ListChecks,
  MousePointerClick,
  PanelRight,
  Plus,
  Search,
  UserRound,
  Wand2,
} from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '@/ui/components/overlay';
import type { GuideTopic } from './board-tour-steps';

const TOPICS: Record<GuideTopic, { title: string; detail: string; icon: ReactNode }> = {
  save: {
    title: 'Save a job from a job site',
    detail: 'The Save job button, Alt+J and pinning the icon',
    icon: <MousePointerClick className="size-4" />,
  },
  move: {
    title: 'Move a job to another lane',
    detail: 'Drag a practice card, or use the keyboard',
    icon: <ArrowRightLeft className="size-4" />,
  },
  details: {
    title: 'See and edit a job’s details',
    detail: 'Open a card: lane, stars, notes, tags, posting',
    icon: <PanelRight className="size-4" />,
  },
  add: {
    title: 'Add a job yourself',
    detail: 'For jobs from email, referrals or anywhere else',
    icon: <Plus className="size-4" />,
  },
  search: {
    title: 'Find a job on your board',
    detail: 'Search titles, companies, places and tags',
    icon: <Search className="size-4" />,
  },
  insights: {
    title: 'See how your search is going',
    detail: 'Insights: applications per week and where they end up',
    icon: <BarChart3 className="size-4" />,
  },
  history: {
    title: 'Find archived or finished jobs',
    detail: 'History, and putting a job back on the board',
    icon: <History className="size-4" />,
  },
  select: {
    title: 'Change many jobs at once',
    detail: 'Select, then move, tag, archive or delete',
    icon: <ListChecks className="size-4" />,
  },
  menu: {
    title: 'Edit columns, export or back up',
    detail: 'The board menu: lanes, CSV, backups, theme',
    icon: <Columns3 className="size-4" />,
  },
  autofill: {
    title: 'Fill in applications',
    detail: 'Set up your autofill profile once',
    icon: <Wand2 className="size-4" />,
  },
  account: {
    title: 'Sync, email updates and Pro',
    detail: 'What an account adds; your board works without one',
    icon: <UserRound className="size-4" />,
  },
};

/**
 * Help → How do I…? (ADR-0039): every feature as a short, hands-on guide on
 * the person's own board, plus the full tour. For anyone who has forgotten
 * how something works, however long they've used Rolestash.
 */
export function GuidesDialog({
  open,
  onClose,
  topics,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  topics: readonly GuideTopic[];
  onPick: (topic: GuideTopic | 'full') => void;
}) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return topics.filter(
      (t) => !q || `${TOPICS[t].title} ${TOPICS[t].detail}`.toLowerCase().includes(q),
    );
  }, [topics, query]);

  const pick = (topic: GuideTopic | 'full') => {
    setQuery('');
    onClose();
    onPick(topic);
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title="How do I…?"
      description="Pick a feature and Rolestash shows you, step by step, on your own board."
    >
      <label htmlFor={searchId} className="sr-only">
        Search the guides
      </label>
      <div className="relative">
        <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search, e.g. “columns” or “export”"
          className="bg-surface text-ink placeholder:text-subtle focus:border-accent focus:ring-accent/15 border-line h-10 w-full rounded-lg border pr-3 pl-9 text-sm transition focus:ring-3 focus:outline-none"
        />
      </div>

      <ul className="mt-3 flex max-h-[min(420px,55vh)] scrollbar-thin flex-col gap-1 overflow-y-auto">
        {shown.map((topic) => (
          <li key={topic}>
            <GuideRow
              icon={TOPICS[topic].icon}
              title={TOPICS[topic].title}
              detail={TOPICS[topic].detail}
              onClick={() => pick(topic)}
            />
          </li>
        ))}
        {shown.length === 0 ? (
          <li className="text-muted px-3 py-6 text-center text-sm" role="status">
            No guide matches “{query.trim()}”. Try the full tour below.
          </li>
        ) : null}
      </ul>

      <div className="border-line mt-3 border-t pt-3">
        <GuideRow
          icon={<Compass className="size-4" />}
          title="Take the full tour"
          detail="Every feature in about two minutes"
          onClick={() => pick('full')}
          accent
        />
      </div>
    </Dialog>
  );
}

function GuideRow({
  icon,
  title,
  detail,
  onClick,
  accent = false,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-surface-2 group flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors"
    >
      <span
        aria-hidden
        className={
          accent
            ? 'bg-accent flex size-8 shrink-0 items-center justify-center rounded-lg text-white dark:text-zinc-950'
            : 'bg-accent-soft text-accent-ink flex size-8 shrink-0 items-center justify-center rounded-lg'
        }
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-ink block text-sm font-medium">{title}</span>
        <span className="text-muted block text-[13px]">{detail}</span>
      </span>
      <ChevronRight
        aria-hidden
        className="text-subtle size-4 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
      />
    </button>
  );
}
