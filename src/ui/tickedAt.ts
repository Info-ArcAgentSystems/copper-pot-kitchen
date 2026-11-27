/**
 * WHEN A LINE WAS TICKED, as he would say it: "18:42" today, "Tue 18:42" on
 * another day of the same window.
 *
 * Read from the tick's own `updated_at`, which the repository writes on every
 * tick — so it is the time of the last change to that line, which for a ticked
 * line is when it was ticked. A missing or unreadable timestamp is shown as
 * nothing at all, never as a made-up time (Rule 8).
 *
 * Pure. The clock is passed in, so a test can pin "today".
 */
export function tickedAt(iso: string | null | undefined, now: Date): string | null {
  if (iso === null || iso === undefined || iso === '') return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const time = at.toLocaleTimeString('en-IE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) return time;

  const day = at.toLocaleDateString('en-IE', { weekday: 'short' });
  return `${day} ${time}`;
}
