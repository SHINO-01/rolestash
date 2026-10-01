import clsx from 'clsx';
import { Archive, ArchiveRestore, BellRing, ExternalLink, X } from 'lucide-react';
import { useState } from 'react';
import type { Job } from '@/domain/job';
import { daysUntilClose, followUpInDays, followUpOn, localDay } from '@/domain/reminders';
import { visibleStages } from '@/domain/stage';
import { formatSalary } from '@/extraction';
import { JobLimitError } from '@/services/job-service';
import { limitMessage } from '@/features/account/plan-copy';
import { Button, IconButton } from '@/ui/components/button';
import { CompanyAvatar } from '@/ui/components/company-avatar';
import { Select, Textarea } from '@/ui/components/field';
import { Drawer } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { InterviewPanel } from '@/features/email/interview';
import { SuggestionBanner } from '@/features/email/suggestion';
import { ContactCard, DocumentLine } from '@/features/board/job-records';
import { INTERVIEW_KIND_LABEL } from '@/domain/calendar';
import { useJobs, useLiveJobs, useServices, useSettings } from '@/ui/hooks/services';
import { formatDate, hasPostingUrl, relativeTime, WORKPLACE_LABEL } from '@/ui/format';

const PRESETS = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'In a week', days: 7 },
];

/**
 * A job's details on the web board (ADR-0017), with the updates people make
 * on a phone: move it, set a follow-up, jot a note, open the posting, archive.
 */
export function JobSheet({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const { jobs } = useJobs();
  const job = id ? jobs.find((j) => j.id === id) : undefined;
  return (
    <Drawer
      open={job !== undefined}
      onClose={onClose}
      label={job ? `${job.title} details` : 'Job details'}
    >
      {job ? <Sheet key={job.id} job={job} onClose={onClose} /> : null}
    </Drawer>
  );
}

function Sheet({ job, onClose }: { job: Job; onClose: () => void }) {
  const { jobService } = useServices();
  const settings = useSettings();
  const live = useLiveJobs();
  const toast = useToast();
  const [notes, setNotes] = useState(job.notes);
  const now = new Date();
  const salary = formatSalary(job.salary);
  const due = job.followUpAt ? daysUntilClose(job.followUpAt, now) : undefined;

  async function act(task: () => Promise<Job | Job[]>, done?: string) {
    try {
      const result = await task();
      live.applyLocal(Array.isArray(result) ? result : [result]);
      if (done) toast({ message: done, tone: 'success' });
    } catch (error) {
      toast({
        tone: 'error',
        message:
          error instanceof JobLimitError ? limitMessage(error) : 'Could not save that change',
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-line flex items-start gap-3 border-b px-5 pt-5 pb-4">
        <CompanyAvatar company={job.company || job.source.siteName} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg leading-snug font-semibold">{job.title}</h2>
          <p className="text-muted text-sm">{job.company || job.source.siteName}</p>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-5" />
        </IconButton>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {job.suggestion ? <SuggestionBanner job={job} stages={settings.stages} /> : null}
        {job.interview ? <InterviewPanel job={job} /> : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-subtle text-xs font-semibold tracking-wide uppercase">Column</span>
          <Select
            className="h-11 text-[15px]"
            value={job.stageId}
            onChange={(e) => void act(() => jobService.move(job.id, e.target.value, 0), 'Moved')}
          >
            {visibleStages(settings.stages)
              .concat(settings.stages.filter((s) => s.archived && s.id === job.stageId))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </label>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {job.location ? <Item label="Location">{job.location}</Item> : null}
          {job.workplaceType ? (
            <Item label="Workplace">{WORKPLACE_LABEL[job.workplaceType]}</Item>
          ) : null}
          {salary ? <Item label="Salary">{salary}</Item> : null}
          {job.closesAt ? <Item label="Closes">{formatDate(job.closesAt)}</Item> : null}
          {job.appliedAt ? <Item label="Applied">{formatDate(job.appliedAt)}</Item> : null}
          <Item label="Saved">{relativeTime(job.createdAt)}</Item>
        </dl>

        {hasPostingUrl(job) ? (
          <a
            href={job.applyUrl ?? job.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-accent flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white dark:text-zinc-950"
          >
            <ExternalLink className="size-4" /> Open posting
          </a>
        ) : null}

        <Records job={job} />

        <section>
          <h3 className="text-subtle mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
            <BellRing className="size-3.5" /> Follow-up
          </h3>
          {job.followUpAt ? (
            <p
              className={clsx(
                'mb-2 text-sm',
                due !== undefined && due <= 0 && 'text-rose-600 dark:text-rose-400',
              )}
            >
              {due !== undefined && due < 0
                ? `Overdue since ${formatDate(job.followUpAt) ?? ''}`
                : `Follow up on ${formatDate(job.followUpAt) ?? ''}`}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                className="border-line h-9 rounded-lg border px-3 text-sm"
                onClick={() =>
                  void act(
                    () => jobService.update(job.id, { followUpAt: followUpInDays(p.days, now) }),
                    'Follow-up set',
                  )
                }
              >
                {p.label}
              </button>
            ))}
            <label className="border-line h-9 rounded-lg border px-2 text-sm">
              <span className="sr-only">Pick a follow-up date</span>
              <input
                type="date"
                min={localDay(now)}
                value={job.followUpAt ? localDay(new Date(job.followUpAt)) : ''}
                onChange={(e) => {
                  const at = followUpOn(e.target.value);
                  if (at)
                    void act(() => jobService.update(job.id, { followUpAt: at }), 'Follow-up set');
                }}
                className="h-full bg-transparent outline-none"
              />
            </label>
            {job.followUpAt ? (
              <button
                type="button"
                className="text-muted h-9 px-2 text-sm"
                onClick={() => void act(() => jobService.update(job.id, { followUpAt: undefined }))}
              >
                Clear
              </button>
            ) : null}
          </div>
          <p className="text-subtle mt-2 text-xs">
            Reminders pop up from the Rolestash extension on your computer, and on Today here.
          </p>
        </section>

        <section>
          <label className="flex flex-col gap-1.5">
            <span className="text-subtle text-xs font-semibold tracking-wide uppercase">Notes</span>
            <Textarea
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== job.notes)
                  void act(() => jobService.update(job.id, { notes }), 'Notes saved');
              }}
              placeholder="Recruiter, interview prep, what to ask…"
              className="text-[15px]"
            />
          </label>
        </section>

        <Button
          variant="ghost"
          icon={
            job.archivedAt ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />
          }
          onClick={() =>
            void act(
              () => (job.archivedAt ? jobService.unarchive(job.id) : jobService.archive(job.id)),
              job.archivedAt ? 'Back on the board' : 'Archived',
            ).then(() => {
              if (!job.archivedAt) onClose();
            })
          }
        >
          {job.archivedAt ? 'Restore to board' : 'Archive'}
        </Button>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-subtle text-xs">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

/** Interview rounds, contacts and documents, to read on the go (edit them on a computer). */
function Records({ job }: { job: Job }) {
  const rounds = [...(job.rounds ?? [])].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const contacts = job.contacts ?? [];
  const documents = job.documents ?? [];
  if (!rounds.length && !contacts.length && !documents.length) return null;
  const heading = 'text-subtle mb-2 text-xs font-semibold tracking-wide uppercase';
  return (
    <>
      {rounds.length ? (
        <section>
          <h3 className={heading}>Interview rounds</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {rounds.map((r) => (
              <li key={r.id} className="border-line rounded-xl border p-3">
                <p className="font-medium">
                  {INTERVIEW_KIND_LABEL[r.kind]}
                  {r.at ? (
                    <span className="text-muted font-normal">
                      {' · '}
                      {new Date(r.at).toLocaleString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  ) : null}
                </p>
                {r.with ? <p className="text-muted">With {r.with}</p> : null}
                {r.notes ? <p className="text-muted mt-1 whitespace-pre-wrap">{r.notes}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {contacts.length ? (
        <section>
          <h3 className={heading}>Contacts</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {contacts.map((c) => (
              <li key={c.id} className="border-line rounded-xl border p-3">
                <ContactCard contact={c} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {documents.length ? (
        <section>
          <h3 className={heading}>Documents</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {documents.map((d) => (
              <li key={d.id} className="border-line rounded-xl border p-3">
                <DocumentLine doc={d} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
