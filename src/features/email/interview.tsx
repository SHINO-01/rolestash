import { CalendarPlus, CalendarClock, ExternalLink, MapPin, Video } from 'lucide-react';
import type { Job } from '@/domain/job';
import { interviewCalendarFile, isPhysicalLocation, isUpcoming, mapsUrl } from '@/domain/interview';
import { Button, ButtonLink } from '@/ui/components/button';
import { Chip } from '@/ui/components/chip';
import { formatInterviewTime, safeHref } from './email-copy';

/**
 * Interview on a card (ADR-0014 §4): when, Join for online interviews, a map
 * link for in-person ones, and an .ics download. Links open only on a click;
 * nothing is fetched.
 */

/** The card's interview badge, while the interview is upcoming. */
export function InterviewChip({ job }: { job: Job }) {
  const interview = job.interview;
  if (!interview) return null;
  const when = formatInterviewTime(interview, true);
  if (when && !isUpcoming(interview, new Date())) return null;
  return (
    <Chip tone="warning" icon={<CalendarClock className="size-3" />}>
      {when ? `Interview ${when}` : 'Interview: pick a time'}
    </Chip>
  );
}

function download(job: Job): void {
  const file = interviewCalendarFile(job, new Date());
  if (!file) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([file], { type: 'text/calendar;charset=utf-8' }));
  const name = (job.company || job.title).replace(/[^\w-]+/g, '-').slice(0, 40) || 'interview';
  a.download = `interview-${name}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** The interview in the job's details, with its actions. */
export function InterviewPanel({ job }: { job: Job }) {
  const interview = job.interview;
  if (!interview) return null;
  const when = formatInterviewTime(interview);
  const join = safeHref(interview.meetingUrl);
  const schedule = safeHref(interview.schedulingUrl);
  const place = isPhysicalLocation(interview.location) ? interview.location : undefined;
  const zone =
    interview.timeZone && !interview.floating
      ? `Shown in your time zone (sent as ${interview.timeZone.replace(/_/g, ' ')})`
      : interview.floating && when
        ? 'No time zone was given; shown as written'
        : undefined;
  return (
    <div className="border-line bg-surface-2/50 rounded-xl border p-3.5">
      <div className="flex items-start gap-2.5">
        <CalendarClock className="text-muted mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{when ?? 'No time set yet'}</p>
          {zone ? <p className="text-subtle text-xs">{zone}</p> : null}
          {place ? (
            <p className="text-muted mt-1 flex items-start gap-1 text-[13px]">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              <span className="break-words">{place}</span>
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {join ? (
          <ButtonLink href={join} size="sm" variant="primary" icon={<Video className="size-3.5" />}>
            Join
          </ButtonLink>
        ) : null}
        {schedule && !when ? (
          <ButtonLink
            href={schedule}
            size="sm"
            variant="primary"
            icon={<ExternalLink className="size-3.5" />}
          >
            Pick a time
          </ButtonLink>
        ) : null}
        {place ? (
          <ButtonLink href={mapsUrl(place)} size="sm" icon={<MapPin className="size-3.5" />}>
            Open in Google Maps
          </ButtonLink>
        ) : null}
        {when ? (
          <Button
            size="sm"
            icon={<CalendarPlus className="size-3.5" />}
            onClick={() => download(job)}
          >
            Add to calendar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
