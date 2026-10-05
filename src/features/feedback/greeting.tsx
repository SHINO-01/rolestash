import { greetingFor } from '@/domain/feedback';

/**
 * "Good evening, Sam" for a signed-in account with a name (ADR-0024). Seen
 * every time the extension opens, so it never animates.
 */
export function Greeting({ firstName, className }: { firstName?: string; className?: string }) {
  if (!firstName) return null;
  return <span className={className}>{greetingFor(firstName, new Date())}</span>;
}
