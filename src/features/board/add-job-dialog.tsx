import { Link2 } from 'lucide-react';
import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import type { Job } from '@/domain/job';
import type { Settings } from '@/domain/settings';
import { visibleStages } from '@/domain/stage';
import type { ExtractionResult } from '@/extraction';
import { ChromePageLoader, releaseSiteAccess, requestSiteAccess } from '@/platform/page-loader';
import { DuplicateJobError, JobLimitError } from '@/services/job-service';
import { domParser, LinkCaptureService, normaliseLink } from '@/services/link-capture-service';
import { Button } from '@/ui/components/button';
import { Field, Input, Select } from '@/ui/components/field';
import { Dialog } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { useLiveJobs, useServices } from '@/ui/hooks/services';
import { limitMessage } from '@/features/account/plan-copy';
import { draftFromResult, postingFromDraft, type Draft } from '@/features/capture/capture-draft';
import { CaptureForm } from '@/features/capture/capture-form';

const EMPTY = (stageId: string) => ({ title: '', company: '', location: '', url: '', stageId });

/**
 * Add a job: fill it in from a pasted link (Pro), or by hand, for jobs heard
 * about offline, by email, or on pages Rolestash can't read.
 */
export function AddJobDialog({
  open,
  onClose,
  settings,
  onSeePlans,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onSeePlans?: (() => void) | undefined;
}) {
  const services = useServices();
  const { jobService } = services;
  const live = useLiveJobs();
  const toast = useToast();
  const links = useMemo(
    () => new LinkCaptureService(new ChromePageLoader(), domParser, services.account),
    [services.account],
  );
  const [canLink, setCanLink] = useState<boolean>();
  const [link, setLink] = useState('');
  const [fetching, setFetching] = useState(false);
  const [found, setFound] = useState<ExtractionResult>();
  const [duplicate, setDuplicate] = useState<Job>();
  const [form, setForm] = useState(EMPTY(settings.defaultStageId));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) void links.canUse().then(setCanLink);
  }, [open, links]);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function reset() {
    setForm(EMPTY(settings.defaultStageId));
    setLink('');
    setFound(undefined);
    setDuplicate(undefined);
    setError(undefined);
  }

  function close() {
    reset();
    onClose();
  }

  function describe(err: unknown): string {
    return err instanceof DuplicateJobError
      ? 'That link is already on your board.'
      : err instanceof JobLimitError
        ? limitMessage(err)
        : err instanceof Error
          ? err.message
          : 'Could not add job';
  }

  async function fetchLink() {
    setError(undefined);
    const url = normaliseLink(link);
    if (!url) {
      setError('Paste a full web link, starting with https://');
      return;
    }
    // Asked inside this click: access to this one site only, given back afterwards.
    const granted = await requestSiteAccess(url.href);
    if (!granted) {
      setError(`Rolestash needs your OK to read ${url.hostname} to fill this in.`);
      return;
    }
    setFetching(true);
    try {
      const outcome = await links.capture(url.href);
      if (!outcome.ok) {
        setError(outcome.message);
        setForm((f) => ({ ...f, url: url.href }));
        return;
      }
      const result = outcome.result;
      setDuplicate(
        await jobService.findDuplicate(result.url, result.site.id, result.fields.externalId),
      );
      setFound(result);
    } finally {
      setFetching(false);
      await releaseSiteAccess(url.href);
    }
  }

  async function saveFound(draft: Draft) {
    if (!found) return;
    setSaving(true);
    setError(undefined);
    try {
      const job = await jobService.createFromExtraction(found, {
        overrides: postingFromDraft(draft, found),
        stageId: draft.stageId,
        priority: draft.priority,
        notes: draft.notes,
      });
      live.applyLocal([job]);
      toast({ message: 'Job added', tone: 'success' });
      close();
    } catch (err) {
      setError(describe(err));
    } finally {
      setSaving(false);
    }
  }

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      // With "Fill in from link" on offer, its box is the job's link too: one link field, not two.
      const url = (canLink ? link : form.url).trim();
      if (url && !/^https?:\/\//i.test(url))
        throw new Error('The link must start with http:// or https://');
      const job = await jobService.createManual({
        posting: {
          title: form.title.trim(),
          company: form.company.trim(),
          employmentTypes: [],
          ...(form.location.trim() ? { location: form.location.trim() } : {}),
        },
        ...(url ? { url } : {}),
        stageId: form.stageId,
      });
      live.applyLocal([job]);
      toast({ message: 'Job added', tone: 'success' });
      close();
    } catch (err) {
      setError(describe(err));
    } finally {
      setSaving(false);
    }
  }

  if (found) {
    return (
      <Dialog
        open={open}
        onClose={close}
        title="Check the details"
        description={`Read from ${found.site.name}. Fix anything that's off, then save.`}
      >
        {duplicate ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="font-medium text-amber-900 dark:text-amber-200">Already on your board</p>
            <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">{duplicate.title}</p>
          </div>
        ) : (
          <CaptureForm
            initial={draftFromResult(found, settings.defaultStageId)}
            stages={settings.stages}
            provenance={found.provenance}
            onSubmit={saveFound}
            submitting={saving}
            error={error}
          />
        )}
        <button
          type="button"
          className="text-accent mt-3 text-xs font-medium hover:underline"
          onClick={reset}
        >
          Start again
        </button>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add a job"
      description="On a job site, the Rolestash button at the edge of the page saves the job for you."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-job-form" loading={saving}>
            Add job
          </Button>
        </>
      }
    >
      <section aria-label="From a link" className="border-line mb-4 border-b pb-4">
        {canLink === false ? (
          <p className="text-muted text-[13px]">
            Pro fills this in from a pasted link.{' '}
            {onSeePlans ? (
              <button
                type="button"
                className="text-accent font-medium hover:underline"
                onClick={onSeePlans}
              >
                Try it free
              </button>
            ) : null}
          </p>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void fetchLink();
            }}
          >
            <label className="flex-1">
              <span className="sr-only">Job link</span>
              <Input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="Paste a job link"
              />
            </label>
            <Button
              type="submit"
              variant="secondary"
              loading={fetching}
              disabled={!link.trim()}
              icon={<Link2 className="size-4" />}
            >
              Fill in from link
            </Button>
          </form>
        )}
      </section>

      <form id="add-job-form" onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3.5">
        <Field label="Job title" className="col-span-2">
          {(id) => <Input id={id} required value={form.title} onChange={set('title')} />}
        </Field>
        <Field label="Company">
          {(id) => <Input id={id} value={form.company} onChange={set('company')} />}
        </Field>
        <Field label="Location">
          {(id) => <Input id={id} value={form.location} onChange={set('location')} />}
        </Field>
        {canLink ? null : (
          <Field label="Link (optional)" className="col-span-2">
            {(id) => (
              <Input
                id={id}
                type="url"
                value={form.url}
                onChange={set('url')}
                placeholder="https://"
              />
            )}
          </Field>
        )}
        <Field label="Column" className="col-span-2">
          {(id) => (
            <Select id={id} value={form.stageId} onChange={set('stageId')}>
              {visibleStages(settings.stages).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {error ? (
          <p className="col-span-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>
        ) : null}
      </form>
    </Dialog>
  );
}
