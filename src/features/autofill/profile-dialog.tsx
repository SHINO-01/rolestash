import { FileUp, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { readResume } from '@/autofill/resume';
import { EMPTY_PROFILE, type Profile } from '@/domain/profile';
import { Button, IconButton } from '@/ui/components/button';
import { Field, Input, Select, Textarea } from '@/ui/components/field';
import { Dialog } from '@/ui/components/overlay';
import { useToast } from '@/ui/components/toast';
import { useServices } from '@/ui/hooks/services';
import { resumeText, ResumeFileError } from './resume-file';

type TextKey = Exclude<
  keyof Profile,
  'answers' | 'updatedAt' | 'workAuthorization' | 'needsSponsorship'
>;

const SECTIONS: { title: string; fields: [TextKey, string, string?][] }[] = [
  {
    title: 'Name and contact',
    fields: [
      ['firstName', 'First name', 'given-name'],
      ['lastName', 'Last name', 'family-name'],
      ['preferredName', 'Preferred name'],
      ['email', 'Email', 'email'],
      ['phone', 'Phone', 'tel'],
    ],
  },
  {
    title: 'Address',
    fields: [
      ['addressLine1', 'Street address', 'address-line1'],
      ['city', 'City or suburb', 'address-level2'],
      ['region', 'State or region', 'address-level1'],
      ['postcode', 'Postcode', 'postal-code'],
      ['country', 'Country', 'country-name'],
    ],
  },
  {
    title: 'Work and links',
    fields: [
      ['currentTitle', 'Current job title', 'organization-title'],
      ['currentCompany', 'Current employer', 'organization'],
      ['linkedin', 'LinkedIn URL', 'url'],
      ['github', 'GitHub URL', 'url'],
      ['website', 'Website or portfolio', 'url'],
    ],
  },
  {
    title: 'Common questions',
    fields: [
      ['salaryExpectation', 'Salary expectation'],
      ['noticePeriod', 'Notice period or start date'],
      ['howHeard', 'How you usually hear about jobs'],
    ],
  },
];

/**
 * The autofill profile (Advanced; ADR-0020). Lives only on this device and is
 * used only when you click "Fill this application".
 */
export function ProfileDialog({
  open,
  onClose,
  onSeePlans,
}: {
  open: boolean;
  onClose: () => void;
  onSeePlans?: (() => void) | undefined;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Autofill profile"
      description="Rolestash fills job applications from these details. They stay on this device."
    >
      {open ? <ProfileForm onClose={onClose} onSeePlans={onSeePlans} /> : null}
    </Dialog>
  );
}

function ProfileForm({
  onClose,
  onSeePlans,
}: {
  onClose: () => void;
  onSeePlans: (() => void) | undefined;
}) {
  const { autofill } = useServices();
  const toast = useToast();
  const [profile, setProfile] = useState<Profile>();
  const [allowed, setAllowed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  // Fields just filled from a résumé, marked until saved so they get checked.
  const [fromResume, setFromResume] = useState<ReadonlySet<TextKey>>(new Set());
  const resumeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autofill) return;
    let active = true;
    void Promise.all([autofill.profile(), autofill.allowed()]).then(([p, ok]) => {
      if (!active) return;
      setProfile(p);
      setAllowed(ok);
    });
    return () => {
      active = false;
    };
  }, [autofill]);

  if (!autofill) return <p className="text-muted text-sm">Autofill isn’t available here.</p>;
  if (!allowed)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted text-sm">
          Autofill is part of Pro. Save your details once, then fill Greenhouse, Lever, Workday,
          Ashby and SmartRecruiters applications, and most company careers forms, in one click.
          Rolestash never submits a form for you.
        </p>
        {onSeePlans ? (
          <Button variant="primary" onClick={onSeePlans}>
            See plans
          </Button>
        ) : null}
      </div>
    );
  if (!profile) return null;

  const set = (patch: Partial<Profile>) => setProfile({ ...profile, ...patch });

  /** Fills empty fields from a résumé file; never overwrites what's there. */
  async function importResume(file: File) {
    if (!profile) return;
    setReading(true);
    try {
      const found = readResume(await resumeText(file));
      const filled = (Object.keys(found) as TextKey[]).filter((k) => !profile[k]?.trim());
      if (filled.length === 0) {
        toast({
          message: Object.keys(found).length
            ? 'Your profile already has everything we found in that résumé.'
            : 'We couldn’t find contact details in that file.',
        });
        return;
      }
      setProfile({
        ...profile,
        ...Object.fromEntries(filled.map((k) => [k, found[k as keyof typeof found]])),
      });
      setFromResume(new Set(filled));
      toast({
        message: `Filled ${String(filled.length)} ${filled.length === 1 ? 'detail' : 'details'} from your résumé. Check them, then save.`,
        tone: 'success',
      });
    } catch (e) {
      toast({
        message: e instanceof ResumeFileError ? e.message : 'Couldn’t read that file.',
        tone: 'error',
      });
    } finally {
      setReading(false);
    }
  }
  const setText = (key: TextKey, value: string) => set({ [key]: value.trim() ? value : undefined });

  async function save() {
    if (!profile || !autofill) return;
    setSaving(true);
    try {
      await autofill.saveProfile({
        ...profile,
        answers: profile.answers.filter((a) => a.question.trim() && a.answer.trim()),
      });
      toast({ message: 'Profile saved', tone: 'success' });
      onClose();
    } catch {
      toast({ message: 'Check the highlighted details and try again.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="border-line bg-surface-2 flex items-center justify-between gap-3 rounded-xl border p-3">
        <p className="text-muted text-sm">
          Start from your résumé (PDF or Word). It’s read on this device and isn’t kept.
        </p>
        <Button
          size="sm"
          icon={<FileUp className="size-4" />}
          loading={reading}
          disabled={reading}
          onClick={() => resumeInput.current?.click()}
        >
          Fill from résumé
        </Button>
        <input
          ref={resumeInput}
          type="file"
          className="hidden"
          aria-label="Choose your résumé"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importResume(file);
          }}
        />
      </div>

      {SECTIONS.map((section) => (
        <Section key={section.title} title={section.title}>
          <div className="grid grid-cols-2 gap-3">
            {section.fields.map(([key, label, autocomplete]) => (
              <Field
                key={key}
                label={label}
                hint={fromResume.has(key) ? 'From your résumé: check it' : undefined}
              >
                {(id) => (
                  <Input
                    id={id}
                    value={profile[key] ?? ''}
                    autoComplete={autocomplete ?? 'off'}
                    warn={fromResume.has(key)}
                    onChange={(e) => setText(key, e.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>
        </Section>
      ))}

      <Section title="Work rights">
        <div className="grid grid-cols-2 gap-3">
          <YesNo
            label="Allowed to work where you apply?"
            value={profile.workAuthorization}
            onChange={(workAuthorization) => set({ workAuthorization })}
          />
          <YesNo
            label="Need visa sponsorship?"
            value={profile.needsSponsorship}
            onChange={(needsSponsorship) => set({ needsSponsorship })}
          />
        </div>
      </Section>

      <Section title="Saved answers">
        <p className="text-subtle -mt-1 mb-2 text-xs">
          For questions that come up again and again (“Why do you want to work here?”). Matched by
          their wording.
        </p>
        <div className="flex flex-col gap-3">
          {profile.answers.map((a, i) => (
            <div key={i} className="border-line flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`Question ${String(i + 1)}`}
                  placeholder="Question"
                  value={a.question}
                  onChange={(e) =>
                    set({
                      answers: profile.answers.map((x, j) =>
                        j === i ? { ...x, question: e.target.value } : x,
                      ),
                    })
                  }
                />
                <IconButton
                  label="Remove answer"
                  onClick={() => set({ answers: profile.answers.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
              <Textarea
                aria-label={`Answer ${String(i + 1)}`}
                placeholder="Your answer"
                value={a.answer}
                onChange={(e) =>
                  set({
                    answers: profile.answers.map((x, j) =>
                      j === i ? { ...x, answer: e.target.value } : x,
                    ),
                  })
                }
              />
            </div>
          ))}
          {profile.answers.length < 30 ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-3.5" />}
              className="self-start"
              onClick={() => set({ answers: [...profile.answers, { question: '', answer: '' }] })}
            >
              Add a saved answer
            </Button>
          ) : null}
        </div>
      </Section>

      <p className="text-subtle flex items-start gap-2 text-xs">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        Stays on this device: not synced and not in backups. Rolestash fills only the page you
        choose, only when you click, never answers equal-opportunity or demographic questions, and
        never submits a form.
      </p>

      <div className="flex justify-between gap-2">
        <Button
          variant="ghost"
          onClick={() => setProfile(structuredClone(EMPTY_PROFILE))}
          disabled={saving}
        >
          Clear all
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            Save profile
          </Button>
        </div>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="text-subtle mb-2.5 text-[11px] font-semibold tracking-wider uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function YesNo({
  label,
  value,
  onChange,
}: {
  label: string;
  value: 'yes' | 'no' | undefined;
  onChange: (value: 'yes' | 'no' | undefined) => void;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Select
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange((e.target.value || undefined) as 'yes' | 'no' | undefined)}
        >
          <option value="">Leave for me</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      )}
    </Field>
  );
}
