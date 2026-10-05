import clsx from 'clsx';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  ExternalLink,
  MoreHorizontal,
  PlusCircle,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  EMPLOYMENT_TYPES,
  WORKPLACE_TYPES,
  type Activity,
  type Job,
  type JobPatch,
  type WorkplaceType,
} from '@/domain/job';
import { visibleActivity } from '@/domain/history';
import type { Stage } from '@/domain/stage';
import { JobLimitError } from '@/services/job-service';
import { limitMessage } from '@/features/account/plan-copy';
import { InterviewPanel } from '@/features/email/interview';
import { INTENT_LABEL } from '@/features/email/email-copy';
import { EmailLine, SuggestionBanner } from '@/features/email/suggestion';
import { FollowUp } from './follow-up';
import { Contacts, Documents, InterviewRounds } from './job-records';
import { HistoryLimitNote } from './history-dialog';
import { formatSalary, parseSalaryText } from '@/extraction';
import { Button, IconButton } from '@/ui/components/button';
import { CompanyAvatar } from '@/ui/components/company-avatar';
import { Input, Select, Textarea } from '@/ui/components/field';
import { Menu } from '@/ui/components/menu';
import { PriorityInput } from '@/ui/components/misc';
import { Drawer } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { useLiveJobs, useServices } from '@/ui/hooks/services';
import {
  EMPLOYMENT_LABEL,
  formatDate,
  postingHref,
  relativeTime,
  WORKPLACE_LABEL,
} from '@/ui/format';
import { STAGE_STYLE } from '@/ui/stage-style';

export function JobDrawer({
  job,
  stages,
  historyFrom,
  remindersAllowed = true,
  recordsAllowed = true,
  onSeePlans,
  onClose,
}: {
  job: Job | undefined;
  stages: readonly Stage[];
  /** Start of the plan's visible history (Free: 30 days); undefined shows all. */
  historyFrom?: Date | undefined;
  /** Whether follow-up reminders are available (Pro, or no accounts). */
  remindersAllowed?: boolean;
  /** Whether contacts, interview rounds and documents can be added (Pro, or no accounts). */
  recordsAllowed?: boolean;
  onSeePlans?: (() => void) | undefined;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={job !== undefined}
      onClose={onClose}
      label={job ? `${job.title} details` : 'Job details'}
    >
      {job ? (
        <DrawerBody
          key={job.id}
          job={job}
          stages={stages}
          historyFrom={historyFrom}
          remindersAllowed={remindersAllowed}
          recordsAllowed={recordsAllowed}
          onSeePlans={onSeePlans}
          onClose={onClose}
        />
      ) : null}
    </Drawer>
  );
}

function DrawerBody({
  job,
  stages,
  historyFrom,
  remindersAllowed,
  recordsAllowed,
  onSeePlans,
  onClose,
}: {
  job: Job;
  stages: readonly Stage[];
  historyFrom: Date | undefined;
  remindersAllowed: boolean;
  recordsAllowed: boolean;
  onSeePlans: (() => void) | undefined;
  onClose: () => void;
}) {
  const { jobService } = useServices();
  const live = useLiveJobs();
  const posting = postingHref(job);
  const toast = useToast();

  async function patch(p: JobPatch) {
    try {
      const updated = await jobService.update(job.id, p);
      live.applyLocal([updated]);
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : 'Could not save', tone: 'error' });
    }
  }

  async function moveTo(stageId: string) {
    const changed = await jobService.move(job.id, stageId, 0);
    live.applyLocal(changed);
  }

  async function toggleArchive() {
    try {
      if (job.archivedAt) {
        live.applyLocal([await jobService.unarchive(job.id)]);
        toast({ message: 'Back on the board', tone: 'success' });
      } else {
        const archived = await jobService.archive(job.id);
        live.applyLocal([archived]);
        onClose();
        toast({
          message: 'Archived. Find it under History.',
          action: {
            label: 'Undo',
            onClick: () => void jobService.unarchive(job.id).then((j) => live.applyLocal([j])),
          },
          durationMs: 8000,
        });
      }
    } catch (error) {
      toast({
        tone: 'error',
        message: error instanceof JobLimitError ? limitMessage(error) : 'Could not update the job',
      });
    }
  }

  async function remove() {
    const removed = await jobService.remove(job.id);
    live.applyLocal([], [job.id]);
    onClose();
    if (removed) {
      toast({
        message: 'Job deleted',
        action: {
          label: 'Undo',
          onClick: () => void jobService.restore(removed).then((j) => live.applyLocal([j])),
        },
        durationMs: 8000,
      });
    }
  }

  async function undoEmail(activityId: string) {
    try {
      live.applyLocal([await jobService.undoEmailUpdate(job.id, activityId)]);
      toast({ message: 'Email update undone', tone: 'success' });
    } catch {
      toast({ message: 'Could not undo', tone: 'error' });
    }
  }

  const stage = stages.find((s) => s.id === job.stageId);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-line border-b px-6 pt-5 pb-4">
        <div className="flex items-start gap-3.5">
          <CompanyAvatar company={job.company || job.source.siteName} size="lg" />
          <div className="min-w-0 flex-1">
            <InlineText
              value={job.title}
              onCommit={(title) => void patch({ title: title || job.title })}
              className="text-lg leading-snug font-semibold"
              label="Job title"
              multiline
            />
            <InlineText
              value={job.company}
              placeholder="Add company"
              onCommit={(company) => void patch({ company })}
              className="text-muted text-sm"
              label="Company"
            />
          </div>
          <div className="flex items-center gap-1">
            <Menu
              trigger={(props) => (
                <IconButton label="More actions" {...props}>
                  <MoreHorizontal className="size-4" />
                </IconButton>
              )}
              items={[
                {
                  label: job.archivedAt ? 'Restore to board' : 'Archive',
                  icon: job.archivedAt ? (
                    <ArchiveRestore className="size-4" />
                  ) : (
                    <Archive className="size-4" />
                  ),
                  onSelect: () => void toggleArchive(),
                },
                {
                  label: 'Delete job',
                  icon: <Trash2 className="size-4" />,
                  tone: 'danger',
                  onSelect: () => void remove(),
                },
              ]}
            />
            <IconButton label="Close" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Column</span>
            <span
              className={clsx(
                'pointer-events-none absolute top-1/2 left-2.5 size-2 -translate-y-1/2 rounded-full',
                stage && STAGE_STYLE[stage.color].dot,
              )}
            />
            <Select
              className="h-8 w-auto pl-6 text-[13px] font-medium"
              value={job.stageId}
              onChange={(e) => void moveTo(e.target.value)}
            >
              {stages
                .filter((s) => !s.archived || s.id === job.stageId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </label>
          <PriorityInput value={job.priority} onChange={(priority) => void patch({ priority })} />
          <div className="flex-1" />
          {posting ? (
            <Button
              size="sm"
              variant="primary"
              icon={<ExternalLink className="size-3.5" />}
              onClick={() => window.open(posting, '_blank', 'noopener')}
            >
              Open posting
            </Button>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 scrollbar-thin space-y-7 overflow-y-auto px-6 py-5">
        {job.suggestion ? <SuggestionBanner job={job} stages={stages} /> : null}
        {job.interview ? (
          <Section title="Interview">
            <InterviewPanel job={job} />
          </Section>
        ) : null}
        <Section title="Details">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            <Detail label="Location">
              <InlineText
                value={job.location ?? ''}
                placeholder="Add location"
                onCommit={(location) => void patch({ location: location || undefined })}
                label="Location"
              />
            </Detail>
            <Detail label="Workplace">
              <Select
                className="h-8 text-[13px]"
                value={job.workplaceType ?? ''}
                onChange={(e) =>
                  void patch({
                    workplaceType: (e.target.value || undefined) as WorkplaceType | undefined,
                  })
                }
              >
                <option value="">Not specified</option>
                {WORKPLACE_TYPES.map((w) => (
                  <option key={w} value={w}>
                    {WORKPLACE_LABEL[w]}
                  </option>
                ))}
              </Select>
            </Detail>
            <Detail label="Salary">
              <InlineText
                value={formatSalary(job.salary) ?? ''}
                placeholder="Add salary"
                label="Salary"
                onCommit={(text) =>
                  void patch({
                    salary: text.trim() ? parseSalaryText(text, job.salary?.currency) : undefined,
                  })
                }
              />
            </Detail>
            <Detail label="Closes">
              <Input
                type="date"
                className="h-8 text-[13px]"
                value={job.closesAt?.slice(0, 10) ?? ''}
                onChange={(e) => void patch({ closesAt: e.target.value || undefined })}
              />
            </Detail>
            <Detail label="Employment" wide>
              <div className="flex flex-wrap gap-1.5">
                {EMPLOYMENT_TYPES.map((type) => {
                  const on = job.employmentTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        void patch({
                          employmentTypes: on
                            ? job.employmentTypes.filter((t) => t !== type)
                            : [...job.employmentTypes, type],
                        })
                      }
                      className={clsx(
                        'h-6 rounded-md border px-2 text-xs font-medium transition-colors',
                        on
                          ? 'border-accent bg-accent-soft text-accent-ink'
                          : 'text-subtle hover:text-muted border-line',
                      )}
                    >
                      {EMPLOYMENT_LABEL[type]}
                    </button>
                  );
                })}
              </div>
            </Detail>
            {job.postedAt ? <Detail label="Posted">{formatDate(job.postedAt)}</Detail> : null}
            {job.appliedAt ? <Detail label="Applied">{formatDate(job.appliedAt)}</Detail> : null}
          </dl>
        </Section>

        <Section title="Follow-up">
          <FollowUp job={job} allowed={remindersAllowed} onPatch={patch} onSeePlans={onSeePlans} />
        </Section>

        <Section title="Interview rounds">
          <InterviewRounds
            job={job}
            allowed={recordsAllowed}
            onPatch={patch}
            onSeePlans={onSeePlans}
          />
        </Section>

        <Section title="Contacts">
          <Contacts job={job} allowed={recordsAllowed} onPatch={patch} onSeePlans={onSeePlans} />
        </Section>

        <Section title="Documents">
          <Documents job={job} allowed={recordsAllowed} onPatch={patch} onSeePlans={onSeePlans} />
        </Section>

        <Section title="Tags">
          <TagEditor tags={job.tags} onChange={(tags) => void patch({ tags })} />
        </Section>

        <Section title="Notes">
          <NotesEditor value={job.notes} onSave={(notes) => patch({ notes })} />
        </Section>

        <Section title="Description">
          <Description text={job.description} />
        </Section>

        <Section title="Activity">
          <Timeline
            activity={job.activity}
            stages={stages}
            historyFrom={historyFrom}
            onUndoEmail={(activityId) => void undoEmail(activityId)}
          />
        </Section>

        <p className="text-subtle border-line border-t pt-4 text-xs">
          Captured from {job.source.siteName} {relativeTime(job.source.capturedAt)}
          {job.extraction
            ? ` · ${Math.round(job.extraction.confidence * 100)}% extraction confidence`
            : ''}
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-subtle mb-2.5 text-[11px] font-semibold tracking-wider uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Detail({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={clsx('min-w-0', wide && 'col-span-2')}>
      <dt className="text-subtle mb-1 text-xs">{label}</dt>
      <dd className="text-[13px]">{children}</dd>
    </div>
  );
}

/** Text that looks like text until clicked; commits on blur or Enter, cancels on Esc. */
function InlineText({
  value,
  onCommit,
  placeholder,
  className,
  label,
  multiline,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  className?: string;
  label: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) onCommit(draft.trim());
  };

  if (editing) {
    const common = {
      'aria-label': label,
      autoFocus: true,
      value: draft,
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(value);
          setEditing(false);
        }
      },
      className: clsx(
        'w-full rounded-md border border-accent bg-surface px-1.5 py-0.5 -mx-1.5 outline-none ring-3 ring-accent/15',
        className,
      ),
    };
    return multiline ? (
      <textarea
        {...common}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        className={clsx(common.className, 'resize-none')}
      />
    ) : (
      <input {...common} onChange={(e) => setDraft(e.target.value)} />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      aria-label={`Edit ${label.toLowerCase()}`}
      className={clsx(
        'group/inline hover:bg-surface-2 -mx-1.5 flex w-full items-start gap-1.5 rounded-md px-1.5 py-0.5 text-left',
        className,
      )}
    >
      <span className={clsx('min-w-0 break-words', !value && 'text-subtle')}>
        {value || placeholder}
      </span>
      <Pencil className="text-subtle mt-1 size-3 shrink-0 opacity-0 group-hover/inline:opacity-100" />
    </button>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = () => {
    const tag = input.trim().replace(/^#/, '').slice(0, 40);
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setInput('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="bg-surface-2 text-muted inline-flex h-6 items-center gap-1 rounded-md pr-1 pl-2 text-xs font-medium"
        >
          #{tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            className="hover:text-ink rounded p-0.5"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <label className="text-subtle focus-within:text-muted inline-flex items-center gap-1 text-xs">
        <PlusCircle className="size-3.5" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="Add tag"
          aria-label="Add tag"
          className="placeholder:text-subtle w-24 bg-transparent outline-none"
        />
      </label>
    </div>
  );
}

function NotesEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (notes: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Text typed but not yet persisted (null when nothing is pending). */
  const pending = useRef<string | null>(null);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  }, [onSave]);

  // Flush on unmount so closing the drawer never loses a note.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current !== null) void save.current(pending.current);
    },
    [],
  );

  const schedule = (next: string) => {
    pending.current = next;
    setDraft(next);
    setStatus('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pending.current = null;
      void save.current(next).then(() => setStatus('saved'));
    }, 600);
  };

  return (
    <div className="relative">
      <Textarea
        aria-label="Notes"
        value={draft}
        onChange={(e) => schedule(e.target.value)}
        placeholder="Recruiter, referral, interview prep, follow-up dates…"
        className="min-h-28"
      />
      <span className="text-subtle absolute right-2.5 bottom-2 text-[11px]">
        {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
      </span>
    </div>
  );
}

function Description({ text }: { text: string | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!text)
    return <p className="text-subtle text-sm">No description was captured for this job.</p>;
  const long = text.length > 900;
  return (
    <div>
      <div
        className={clsx(
          'text-muted text-[13px] leading-relaxed whitespace-pre-wrap',
          long &&
            !expanded &&
            'max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]',
        )}
      >
        {text}
      </div>
      {long ? (
        <button
          type="button"
          className="text-accent mt-2 text-xs font-medium hover:underline"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Show less' : 'Show full description'}
        </button>
      ) : null}
    </div>
  );
}

function Timeline({
  activity,
  stages,
  historyFrom,
  onUndoEmail,
}: {
  activity: Activity[];
  stages: readonly Stage[];
  historyFrom: Date | undefined;
  onUndoEmail: (activityId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const name = (id: string | undefined) => stages.find((s) => s.id === id)?.name ?? id ?? '—';
  const { items, hidden } = visibleActivity(activity, historyFrom);
  const shown = all ? items : items.slice(0, TIMELINE_PREVIEW);
  return (
    <>
      <ol className="border-line relative space-y-3 border-l pl-4">
        {shown.map((entry) => (
          <li key={entry.id} className="relative text-[13px]">
            <span className="bg-surface-3 ring-surface absolute top-1.5 -left-[21px] size-2 rounded-full ring-4" />
            <span className="text-muted">
              {entry.type === 'created' ? (
                <>
                  Saved to <b className="text-ink font-medium">{name(entry.toStageId)}</b>
                </>
              ) : entry.type === 'stage_changed' ? (
                <span className="inline-flex flex-wrap items-center gap-1">
                  Moved {name(entry.fromStageId)} <ArrowRight className="size-3" />
                  <b className="text-ink font-medium">{name(entry.toStageId)}</b>
                </span>
              ) : entry.type === 'archived' ? (
                <>Archived</>
              ) : entry.type === 'unarchived' ? (
                <>Restored to the board</>
              ) : entry.type === 'email_update' ? (
                <span className="inline-flex flex-col gap-0.5">
                  <span
                    className={clsx(
                      'inline-flex flex-wrap items-center gap-1',
                      entry.undone && 'line-through',
                    )}
                  >
                    {entry.email ? INTENT_LABEL[entry.email.intent] : 'Email update'}
                    {entry.toStageId ? (
                      <>
                        : moved {name(entry.fromStageId)} <ArrowRight className="size-3" />
                        <b className="text-ink font-medium">{name(entry.toStageId)}</b>
                      </>
                    ) : entry.setInterview ? (
                      <>: interview added</>
                    ) : null}
                  </span>
                  {entry.email ? <EmailLine email={entry.email} /> : null}
                  {entry.undone ? (
                    <span className="text-subtle text-xs">Undone</span>
                  ) : (
                    <button
                      type="button"
                      className="text-accent self-start text-xs font-medium hover:underline"
                      onClick={() => onUndoEmail(entry.id)}
                    >
                      Undo
                    </button>
                  )}
                </span>
              ) : (
                <>Edited {entry.fields?.map((f) => FIELD_LABEL[f] ?? f).join(', ')}</>
              )}
            </span>
            <span className="text-subtle ml-2 text-xs" title={new Date(entry.at).toLocaleString()}>
              {relativeTime(entry.at)}
            </span>
          </li>
        ))}
      </ol>
      {items.length > shown.length ? (
        <button
          type="button"
          className="text-accent mt-3 text-xs font-medium hover:underline"
          onClick={() => setAll(true)}
        >
          Show all {items.length} entries
        </button>
      ) : null}
      {hidden > 0 ? (
        <HistoryLimitNote hidden={hidden} what={['timeline entry', 'timeline entries']} />
      ) : null}
    </>
  );
}

/** Readable names for edited fields in the timeline. */
const FIELD_LABEL: Record<string, string> = {
  followUpAt: 'follow-up',
  closesAt: 'closing date',
  postedAt: 'posted date',
  applyUrl: 'apply link',
  workplaceType: 'workplace',
  employmentTypes: 'employment type',
  rounds: 'interview rounds',
};

/** Timeline entries shown before "Show all". */
const TIMELINE_PREVIEW = 30;
