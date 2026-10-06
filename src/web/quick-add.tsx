import { useState } from 'react';
import { laneStages } from '@/domain/stage';
import { DuplicateJobError, JobLimitError } from '@/services/job-service';
import { limitMessage } from '@/features/account/plan-copy';
import { Button } from '@/ui/components/button';
import { Field, Input, Select } from '@/ui/components/field';
import { Dialog } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { useLiveJobs, useServices, useSettings } from '@/ui/hooks/services';

/** Add a job you heard about away from your computer (ADR-0017). */
export function QuickAdd({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (id: string) => void;
}) {
  const { jobService } = useServices();
  const settings = useSettings();
  const live = useLiveJobs();
  const toast = useToast();
  const empty = { title: '', company: '', url: '', stageId: settings.defaultStageId };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const url = form.url.trim();
      if (url && !/^https?:\/\//i.test(url)) throw new Error('The link must start with https://');
      const job = await jobService.createManual({
        posting: { title: form.title.trim(), company: form.company.trim(), employmentTypes: [] },
        ...(url ? { url } : {}),
        stageId: form.stageId,
      });
      live.applyLocal([job]);
      toast({ message: 'Job added', tone: 'success' });
      setForm(empty);
      onClose();
      onAdded(job.id);
    } catch (e) {
      setError(
        e instanceof DuplicateJobError
          ? 'That link is already on your board.'
          : e instanceof JobLimitError
            ? limitMessage(e)
            : e instanceof Error
              ? e.message
              : 'Could not add the job',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add a job">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Job title">
          {(id) => (
            <Input
              id={id}
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="h-11 text-[15px]"
            />
          )}
        </Field>
        <Field label="Company">
          {(id) => (
            <Input
              id={id}
              value={form.company}
              onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              className="h-11 text-[15px]"
            />
          )}
        </Field>
        <Field label="Link (optional)">
          {(id) => (
            <Input
              id={id}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              className="h-11 text-[15px]"
            />
          )}
        </Field>
        <Field label="Column">
          {(id) => (
            <Select
              id={id}
              value={form.stageId}
              onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))}
              className="h-11 text-[15px]"
            >
              {laneStages(settings.stages).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
        <Button type="submit" variant="primary" loading={saving} className="h-11">
          Add job
        </Button>
        <p className="text-subtle text-xs">
          On your computer, the Rolestash extension fills in the details from the posting.
        </p>
      </form>
    </Dialog>
  );
}
