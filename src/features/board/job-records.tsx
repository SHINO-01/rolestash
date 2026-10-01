import { ExternalLink, FileText, Mail, Pencil, Phone, Plus, Trash2, UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { INTERVIEW_KIND_LABEL } from '@/domain/calendar';
import {
  DOCUMENT_KINDS,
  INTERVIEW_KINDS,
  type Contact,
  type DocumentKind,
  type DocumentRef,
  type InterviewKind,
  type InterviewRound,
  type Job,
  type JobPatch,
} from '@/domain/job';
import { safeHref } from '@/features/email/email-copy';
import { DOCUMENT_KIND_LABEL } from '@/ui/format';
import { Button, IconButton } from '@/ui/components/button';
import { Field, Input, Select, Textarea } from '@/ui/components/field';

/**
 * Per-job records (Advanced): interview rounds with notes, contacts, and the
 * documents sent (by name; files are never stored). Anything already saved
 * stays visible and editable on any plan; adding needs Advanced.
 */

interface Props {
  job: Job;
  /** Whether new entries can be added (Advanced, or a build without accounts). */
  allowed: boolean;
  onPatch: (patch: JobPatch) => Promise<void>;
  onSeePlans?: (() => void) | undefined;
}

const newId = () => crypto.randomUUID();

/** "2026-10-08T23:00:00.000Z" ↔ the value of an <input type="datetime-local">. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const blank = (s: string) => (s.trim() ? s.trim() : undefined);

/** A list that edits one item at a time in place. */
function useEditor<T extends { id: string }>(
  items: readonly T[],
  save: (next: T[]) => Promise<void>,
) {
  // An item's id, 'new' for the add form, or null.
  const [editing, setEditing] = useState<string | null>(null);
  return {
    editing,
    setEditing,
    commit: async (item: T) => {
      const exists = items.some((i) => i.id === item.id);
      await save(exists ? items.map((i) => (i.id === item.id ? item : i)) : [...items, item]);
      setEditing(null);
    },
    remove: (id: string) => save(items.filter((i) => i.id !== id)),
  };
}

function AddButton({
  label,
  allowed,
  full,
  onAdd,
  onSeePlans,
}: {
  label: string;
  allowed: boolean;
  full: boolean;
  onAdd: () => void;
  onSeePlans: (() => void) | undefined;
}) {
  if (full) return null;
  if (!allowed)
    return (
      <p className="text-subtle text-xs">
        Adding these is part of Advanced.{' '}
        {onSeePlans ? (
          <button
            type="button"
            className="text-accent font-medium hover:underline"
            onClick={onSeePlans}
          >
            See plans
          </button>
        ) : null}
      </p>
    );
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<Plus className="size-3.5" />}
      className="self-start"
      onClick={onAdd}
    >
      {label}
    </Button>
  );
}

function Row({
  children,
  onEdit,
  onRemove,
  label,
}: {
  children: ReactNode;
  onEdit: () => void;
  onRemove: () => void;
  label: string;
}) {
  return (
    <li className="border-line group/row flex items-start gap-2 rounded-lg border p-3 text-[13px]">
      <div className="min-w-0 flex-1">{children}</div>
      <IconButton size="sm" label={`Edit ${label}`} onClick={onEdit}>
        <Pencil className="size-3.5" />
      </IconButton>
      <IconButton size="sm" label={`Remove ${label}`} onClick={onRemove}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </li>
  );
}

function FormActions({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" variant="primary" type="submit">
        Save
      </Button>
    </div>
  );
}

// ── Interview rounds ───────────────────────────────────────────────────────

export function InterviewRounds({ job, allowed, onPatch, onSeePlans }: Props) {
  const rounds = [...(job.rounds ?? [])].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  const editor = useEditor(rounds, (next) => onPatch({ rounds: next }));
  return (
    <div className="flex flex-col gap-2">
      {rounds.length ? (
        <ul className="flex flex-col gap-2" aria-label="Interview rounds">
          {rounds.map((round) =>
            editor.editing === round.id ? (
              <RoundForm
                key={round.id}
                round={round}
                onSave={editor.commit}
                onCancel={() => editor.setEditing(null)}
              />
            ) : (
              <Row
                key={round.id}
                label={INTERVIEW_KIND_LABEL[round.kind]}
                onEdit={() => editor.setEditing(round.id)}
                onRemove={() => void editor.remove(round.id)}
              >
                <p className="font-medium">
                  {INTERVIEW_KIND_LABEL[round.kind]}
                  {round.at ? (
                    <span className="text-muted font-normal">
                      {' · '}
                      {new Date(round.at).toLocaleString(undefined, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  ) : null}
                </p>
                {round.with ? <p className="text-muted">With {round.with}</p> : null}
                {round.notes ? (
                  <p className="text-muted mt-1 whitespace-pre-wrap">{round.notes}</p>
                ) : null}
              </Row>
            ),
          )}
        </ul>
      ) : null}
      {editor.editing === 'new' ? (
        <RoundForm
          round={{ id: newId(), kind: 'video' }}
          onSave={editor.commit}
          onCancel={() => editor.setEditing(null)}
        />
      ) : (
        <AddButton
          label="Add an interview round"
          allowed={allowed}
          full={rounds.length >= 30}
          onAdd={() => editor.setEditing('new')}
          onSeePlans={onSeePlans}
        />
      )}
    </div>
  );
}

function RoundForm({
  round,
  onSave,
  onCancel,
}: {
  round: InterviewRound;
  onSave: (round: InterviewRound) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<InterviewKind>(round.kind);
  const [when, setWhen] = useState(toLocalInput(round.at));
  const [who, setWho] = useState(round.with ?? '');
  const [notes, setNotes] = useState(round.notes ?? '');
  return (
    <form
      aria-label="Interview round"
      className="border-accent/40 flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const at = fromLocalInput(when);
        void onSave({
          id: round.id,
          kind,
          ...(at ? { at } : {}),
          ...(blank(who) ? { with: blank(who) } : {}),
          ...(blank(notes) ? { notes: blank(notes) } : {}),
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Round">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as InterviewKind)}>
              {INTERVIEW_KINDS.map((k) => (
                <option key={k} value={k}>
                  {INTERVIEW_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="When">
          {(id) => (
            <Input
              id={id}
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="With">
        {(id) => (
          <Input
            id={id}
            value={who}
            placeholder="Names or roles"
            onChange={(e) => setWho(e.target.value)}
          />
        )}
      </Field>
      <Field label="Notes">
        {(id) => (
          <Textarea
            id={id}
            value={notes}
            placeholder="Questions asked, how it went, what to prepare next"
            onChange={(e) => setNotes(e.target.value)}
          />
        )}
      </Field>
      <FormActions onCancel={onCancel} />
    </form>
  );
}

// ── Contacts ───────────────────────────────────────────────────────────────

export function Contacts({ job, allowed, onPatch, onSeePlans }: Props) {
  const contacts = job.contacts ?? [];
  const editor = useEditor(contacts, (next) => onPatch({ contacts: next }));
  return (
    <div className="flex flex-col gap-2">
      {contacts.length ? (
        <ul className="flex flex-col gap-2" aria-label="Contacts">
          {contacts.map((c) =>
            editor.editing === c.id ? (
              <ContactForm
                key={c.id}
                contact={c}
                onSave={editor.commit}
                onCancel={() => editor.setEditing(null)}
              />
            ) : (
              <Row
                key={c.id}
                label={c.name}
                onEdit={() => editor.setEditing(c.id)}
                onRemove={() => void editor.remove(c.id)}
              >
                <ContactCard contact={c} />
              </Row>
            ),
          )}
        </ul>
      ) : null}
      {editor.editing === 'new' ? (
        <ContactForm
          contact={{ id: newId(), name: '' }}
          onSave={editor.commit}
          onCancel={() => editor.setEditing(null)}
        />
      ) : (
        <AddButton
          label="Add a contact"
          allowed={allowed}
          full={contacts.length >= 30}
          onAdd={() => editor.setEditing('new')}
          onSeePlans={onSeePlans}
        />
      )}
    </div>
  );
}

/** A contact with one-tap email, call and LinkedIn (also used by the web board). */
export function ContactCard({ contact }: { contact: Contact }) {
  const linkedin = safeHref(contact.linkedin);
  return (
    <>
      <p className="flex items-center gap-1.5 font-medium">
        <UserRound className="text-subtle size-3.5" />
        {contact.name}
        {contact.role ? <span className="text-muted font-normal">· {contact.role}</span> : null}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {contact.email ? (
          <a
            className="text-accent inline-flex items-center gap-1 hover:underline"
            href={`mailto:${contact.email}`}
          >
            <Mail className="size-3" />
            {contact.email}
          </a>
        ) : null}
        {contact.phone ? (
          <a
            className="text-accent inline-flex items-center gap-1 hover:underline"
            href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}
          >
            <Phone className="size-3" />
            {contact.phone}
          </a>
        ) : null}
        {linkedin ? (
          <a
            className="text-accent inline-flex items-center gap-1 hover:underline"
            href={linkedin}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="size-3" />
            LinkedIn
          </a>
        ) : null}
      </div>
      {contact.notes ? (
        <p className="text-muted mt-1 whitespace-pre-wrap">{contact.notes}</p>
      ) : null}
    </>
  );
}

function ContactForm({
  contact,
  onSave,
  onCancel,
}: {
  contact: Contact;
  onSave: (contact: Contact) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    name: contact.name,
    role: contact.role ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    linkedin: contact.linkedin ?? '',
    notes: contact.notes ?? '',
  });
  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: e.target.value });
  return (
    <form
      aria-label="Contact"
      className="border-accent/40 flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.name.trim()) return;
        const optional = (['role', 'email', 'phone', 'linkedin', 'notes'] as const).flatMap((k) =>
          blank(draft[k]) ? [[k, blank(draft[k])] as const] : [],
        );
        void onSave({ id: contact.id, name: draft.name.trim(), ...Object.fromEntries(optional) });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          {(id) => <Input id={id} required value={draft.name} onChange={set('name')} />}
        </Field>
        <Field label="Role">
          {(id) => (
            <Input id={id} value={draft.role} placeholder="Recruiter" onChange={set('role')} />
          )}
        </Field>
        <Field label="Email">
          {(id) => <Input id={id} type="email" value={draft.email} onChange={set('email')} />}
        </Field>
        <Field label="Phone">
          {(id) => <Input id={id} type="tel" value={draft.phone} onChange={set('phone')} />}
        </Field>
      </div>
      <Field label="LinkedIn">
        {(id) => <Input id={id} type="url" value={draft.linkedin} onChange={set('linkedin')} />}
      </Field>
      <Field label="Notes">
        {(id) => <Textarea id={id} value={draft.notes} onChange={set('notes')} />}
      </Field>
      <FormActions onCancel={onCancel} />
    </form>
  );
}

// ── Documents ──────────────────────────────────────────────────────────────

export function Documents({ job, allowed, onPatch, onSeePlans }: Props) {
  const documents = job.documents ?? [];
  const editor = useEditor(documents, (next) => onPatch({ documents: next }));
  return (
    <div className="flex flex-col gap-2">
      {documents.length ? (
        <ul className="flex flex-col gap-2" aria-label="Documents">
          {documents.map((d) =>
            editor.editing === d.id ? (
              <DocumentForm
                key={d.id}
                doc={d}
                onSave={editor.commit}
                onCancel={() => editor.setEditing(null)}
              />
            ) : (
              <Row
                key={d.id}
                label={d.name}
                onEdit={() => editor.setEditing(d.id)}
                onRemove={() => void editor.remove(d.id)}
              >
                <DocumentLine doc={d} />
              </Row>
            ),
          )}
        </ul>
      ) : null}
      {editor.editing === 'new' ? (
        <DocumentForm
          doc={{ id: newId(), kind: 'resume', name: '' }}
          onSave={editor.commit}
          onCancel={() => editor.setEditing(null)}
        />
      ) : (
        <AddButton
          label="Add a document"
          allowed={allowed}
          full={documents.length >= 30}
          onAdd={() => editor.setEditing('new')}
          onSeePlans={onSeePlans}
        />
      )}
    </div>
  );
}

/** One document: its kind, name (a link when it has one) and note (also used by the web board). */
export function DocumentLine({ doc }: { doc: DocumentRef }) {
  const href = safeHref(doc.url);
  return (
    <>
      <p className="flex items-center gap-1.5">
        <FileText className="text-subtle size-3.5 shrink-0" />
        <span className="text-muted">{DOCUMENT_KIND_LABEL[doc.kind]}:</span>
        {href ? (
          <a
            className="text-accent truncate font-medium hover:underline"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {doc.name}
          </a>
        ) : (
          <span className="truncate font-medium">{doc.name}</span>
        )}
      </p>
      {doc.note ? <p className="text-muted mt-1">{doc.note}</p> : null}
    </>
  );
}

function DocumentForm({
  doc,
  onSave,
  onCancel,
}: {
  doc: DocumentRef;
  onSave: (doc: DocumentRef) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<DocumentKind>(doc.kind);
  const [name, setName] = useState(doc.name);
  const [url, setUrl] = useState(doc.url ?? '');
  const [note, setNote] = useState(doc.note ?? '');
  const link = safeHref(blank(url));
  return (
    <form
      aria-label="Document"
      className="border-accent/40 flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void onSave({
          id: doc.id,
          kind,
          name: name.trim(),
          ...(link ? { url: link } : {}),
          ...(blank(note) ? { note: blank(note) } : {}),
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="File name">
          {(id) => (
            <Input
              id={id}
              required
              value={name}
              placeholder="Resume-2026-v3.pdf"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field
        label="Link (optional)"
        hint="Where it lives, e.g. Google Drive. Rolestash never stores the file."
      >
        {(id) => <Input id={id} type="url" value={url} onChange={(e) => setUrl(e.target.value)} />}
      </Field>
      <Field label="Note">
        {(id) => (
          <Input
            id={id}
            value={note}
            placeholder="Tailored for the data role"
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <FormActions onCancel={onCancel} />
    </form>
  );
}
