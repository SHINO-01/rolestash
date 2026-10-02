/**
 * "Help improve automatic updates", offered while signing in (ADR-0019,
 * ADR-0022). On by default; unticking it opts the new account out before it
 * ever shares anything.
 */
export function SharingChoice({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        className="accent-accent mt-0.5 size-4"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-medium">Help improve automatic updates</span>
        <span className="text-muted block text-[13px]">
          On Advanced, when you accept or correct an email update, share a one-way fingerprint of
          the email’s template, never the email or your jobs. You can change this in Account at any
          time.
        </span>
      </span>
    </label>
  );
}
