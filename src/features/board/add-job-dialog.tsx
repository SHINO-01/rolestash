import { useState, type SyntheticEvent } from 'react';
import type { Settings } from '@/domain/settings';
import { visibleStages } from '@/domain/stage';
import { Button } from '@/ui/components/button';
import { Field, Input, Select } from '@/ui/components/field';
import { Dialog } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { useLiveJobs, useServices } from '@/ui/hooks/services';
import { limitMessage } from '@/features/account/plan-copy';
import { DuplicateJobError, JobLimitError } from '@/services/job-service';

/** Manual entry — for jobs heard about offline, by email, or on pages we can't read. */
export function AddJobDialog({
  open,
  onClose,
  settings,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
}) {
  const { jobService } = useServices();
  const live = useLiveJobs();
  const toast = useToast();
  const [form, setForm] = useState({
    title: '',
    company: '',
    location: '',
    url: '',
    stageId: settings.defaultStageId,
  });
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const url = form.url.trim();
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
      setForm({ title: '', company: '', location: '', url: '', stageId: settings.defaultStageId });
      onClose();
    } catch (err) {
      setError(
        err instanceof DuplicateJobError
          ? 'That link is already on your board.'
          : err instanceof JobLimitError
            ? limitMessage(err)
            : err instanceof Error
              ? err.message
              : 'Could not add job',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a job"
      description="Tip: on a job page, click the Rolestash icon (Alt+J) to fill this in automatically."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-job-form" loading={saving}>
            Add job
          </Button>
        </>
      }
    >
      <form id="add-job-form" onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3.5">
        <Field label="Job title" className="col-span-2">
          {(id) => <Input id={id} required autoFocus value={form.title} onChange={set('title')} />}
        </Field>
        <Field label="Company">
          {(id) => <Input id={id} value={form.company} onChange={set('company')} />}
        </Field>
        <Field label="Location">
          {(id) => <Input id={id} value={form.location} onChange={set('location')} />}
        </Field>
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
