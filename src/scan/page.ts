/**
 * One photographed page → several jobs.
 *
 * WHY THIS EXISTS. The owner's job sheet is a notebook page, and a page usually
 * carries more than one booking: a Friday BBQ and a Sunday breakfast written
 * under one "Pandoras Cottage · Aoife" heading. The scanner used to have room
 * for one job, so it silently kept whichever booking the model landed on — the
 * same photo gave the Sunday job one morning and the Friday job that night, and
 * the other booking vanished without a word.
 *
 * Now the page is read as blocks (a heading) of sittings (one booking each), and
 * every sitting becomes its own draft through the SAME review and draft code a
 * single sheet always used. Nothing about Rule 8 is relaxed:
 *
 *   A heading applies to the sittings written under it, because that is what
 *   the owner wrote — not because anything was inferred.
 *
 *   The model copies "FRI. 20TH", the page title, "7 and 7.30pm written
 *   together" and "16ppl" verbatim. Turning them into a date, a time or a count
 *   happens HERE, in small pure functions with worked tests, and each only reads
 *   what is plainly written:
 *
 *     dateFromHeader     day from the line + month and year from the page title,
 *                        only when the title states both. Marked as header-built,
 *                        so the owner confirms it before anything saves.
 *     guestsFromWording  "16ppl" → 16. A bare count with a people-word and
 *                        nothing else. "a few" and "20-25" stay unresolved.
 *     timesFromWording   "7/7.30pm" → two options, 19:00 and 19:30. NEVER picks
 *                        between them; the owner does.
 *
 * PURE. No React, no network, no repository.
 */

import { reviewJobSheet, type Gap, type JobSheetRead, type OwnerData } from './jobSheet';
import {
  draftFromReview,
  draftGaps,
  type CreatedRecords,
  type JobSheetDraft,
  type NameChoice,
  type NameDraft,
} from './jobDraft';

// ---------------------------------------------------------------------------
// What the scanner read
// ---------------------------------------------------------------------------

/** One booking line and everything written under it. Every field verbatim. */
export interface SittingRead {
  /** The day as the line writes it — "FRI. 20TH". */
  readonly dayWritten: string | null;
  /** YYYY-MM-DD only when the line itself stated a complete date. */
  readonly serviceDate: string | null;
  /** HH:MM only when one plain time was written. */
  readonly serviceTime: string | null;
  /** The time as written — "7/7.30pm". */
  readonly timeWording: string | null;
  readonly serviceType: string | null;
  /** A bare number only. "16ppl" arrives in `guestsWording`. */
  readonly guests: number | null;
  readonly guestsWording: string | null;
  readonly dishes: readonly string[];
  readonly dietaries: readonly { readonly wording: string }[];
  readonly notes: string | null;
  readonly uncertain: readonly { readonly field: string; readonly saw: string | null }[];
}

/** A heading — venue and customer — and the bookings written under it. */
export interface BlockRead {
  readonly customer: string | null;
  readonly property: string | null;
  readonly sittings: readonly SittingRead[];
}

export interface PageRead {
  /** The page's title line, verbatim. Often carries the month and year. */
  readonly pageHeader: string | null;
  readonly blocks: readonly BlockRead[];
  /** Lines the scanner could not place under any booking. Shown, never dropped. */
  readonly unplaced: readonly string[];
  readonly uncertain: readonly { readonly field: string; readonly saw: string | null }[];
}

// ---------------------------------------------------------------------------
// Reading what is written
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_TOKEN = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?/;
const WEEKDAY_TOKEN = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\.?/;

const pad = (n: number): string => String(n).padStart(2, '0');

/** A real calendar date, or null. 31 November is not one. */
function isoDate(year: number, month: number, day: number): string | null {
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The weekday of a YYYY-MM-DD date, 0 = Sunday. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** "Fri 20 Nov" for a YYYY-MM-DD, or null for anything else. */
export function shortDate(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return null;
  const [, m, d] = iso.trim().split('-').map(Number);
  const weekday = WEEKDAY_NAMES[weekdayOf(iso.trim())]?.slice(0, 3) ?? '';
  return `${weekday} ${d} ${MONTH_NAMES[(m ?? 1) - 1]?.slice(0, 3) ?? ''}`;
}

/**
 * The month and year a page title states, and the days it lists.
 *
 * "PAUL - CATERING 20/21st NOV'26" → November 2026, days [20, 21].
 *
 * A TWO-DIGIT YEAR NEEDS ITS APOSTROPHE. "Nov '26" is 2026. "Nov 26" is not
 * read as a year at all — 26 could just as well be the 26th — so the title
 * then states no year and nothing is built from it.
 */
export function monthYearFromHeader(
  header: string | null,
): { month: number; year: number; days: readonly number[] } | null {
  if (header === null) return null;
  const text = header.toLowerCase();

  const monthMatch = MONTH_TOKEN.exec(text);
  if (monthMatch === null) return null;

  const month = MONTHS.indexOf((monthMatch[1] ?? '').slice(0, 3)) + 1;
  const after = text.slice(monthMatch.index + monthMatch[0].length);

  const four = /^\s*['’]?\s*(\d{4})\b/.exec(after);
  const two = /^\s*['’]\s*(\d{2})\b/.exec(after);
  const year = four !== null ? Number(four[1]) : two !== null ? 2000 + Number(two[1]) : null;
  if (year === null) return null;

  const before = text.slice(0, monthMatch.index);
  const days = [...before.matchAll(/(\d{1,2})(?:st|nd|rd|th)?/g)]
    .map((m) => Number(m[1]))
    .filter((d) => d >= 1 && d <= 31);

  return { month, year, days };
}

export interface HeaderDate {
  /** YYYY-MM-DD. */
  readonly date: string;
  /** True / false when the line names a weekday; null when it names none. */
  readonly weekdayMatches: boolean | null;
  /** The weekday the line wrote, in full ("Friday"), when it wrote one. */
  readonly weekdayWritten: string | null;
  /** The title lists days, and this line's day is not among them. */
  readonly disagreesWithHeader: boolean;
  /** The days the title listed, for showing him the disagreement. */
  readonly headerDays: readonly number[];
}

/**
 * A booking's date, from the day on its line and the month and year in the page
 * title. Null unless BOTH are written — nothing is filled from today.
 *
 * It also checks what it can check: that the weekday the line wrote is the
 * weekday of that date, and whether the title's own days include it. Neither
 * check decides anything; both are shown to the owner beside the date he is
 * asked to confirm.
 */
export function dateFromHeader(dayWritten: string | null, header: string | null): HeaderDate | null {
  if (dayWritten === null) return null;

  const line = dayWritten.toLowerCase();
  const dayMatch = /(\d{1,2})(?:st|nd|rd|th)?/.exec(line);
  if (dayMatch === null) return null;
  const day = Number(dayMatch[1]);

  const fromTitle = monthYearFromHeader(header);
  if (fromTitle === null) return null;

  // A month written on the line itself beats the title's.
  const lineMonth = MONTH_TOKEN.exec(line);
  const month =
    lineMonth !== null ? MONTHS.indexOf((lineMonth[1] ?? '').slice(0, 3)) + 1 : fromTitle.month;

  const date = isoDate(fromTitle.year, month, day);
  if (date === null) return null;

  const weekdayMatch = WEEKDAY_TOKEN.exec(line);
  const written =
    weekdayMatch === null ? null : WEEKDAYS.indexOf((weekdayMatch[1] ?? '').slice(0, 3));

  return {
    date,
    weekdayMatches: written === null ? null : written === weekdayOf(date),
    weekdayWritten: written === null ? null : (WEEKDAY_NAMES[written] ?? null),
    disagreesWithHeader:
      lineMonth === null && fromTitle.days.length > 0 && !fromTitle.days.includes(day),
    headerDays: fromTitle.days,
  };
}

/**
 * "16ppl" → 16. A whole number of people and nothing else.
 *
 * Accepts a bare number, optionally after "for", optionally followed by one
 * people-word (ppl, pax, people, persons, guests, covers, heads). Anything
 * vaguer — "a few", "approx 20", "20-25" — stays null and stays the owner's to
 * answer (Rule 12).
 */
export function guestsFromWording(wording: string | null): number | null {
  if (wording === null) return null;

  const m =
    /^\s*(?:for\s+)?(\d{1,4})\s*(?:ppl|pax|people|persons|guests|covers|heads)?\.?\s*$/i.exec(
      wording,
    );
  if (m === null) return null;

  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/**
 * Every time the wording plainly states, as HH:MM.
 *
 * "10am" → ["10:00"]. "7/7.30pm" → ["19:00", "19:30"]: an am/pm written once at
 * the end covers the times before it, which is how the line is read aloud.
 *
 * Returns NOTHING rather than guess: a time with no am/pm under 13 o'clock could
 * be morning or evening, so "7/7.30" gives no options at all.
 */
export function timesFromWording(wording: string | null): readonly string[] {
  if (wording === null) return [];

  const text = wording.toLowerCase().replace(/\s+/g, ' ').trim();
  const parts = text.split(/\s*(?:\/|-|–|\bor\b|\bto\b)\s*/).filter((p) => p !== '');
  if (parts.length === 0) return [];

  const parsed = parts.map((p) => /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(p));
  if (parsed.some((m) => m === null)) return [];

  const shared = parsed[parsed.length - 1]?.[3] ?? null;
  const times: string[] = [];

  for (const m of parsed) {
    if (m === null) return [];
    const hour = Number(m[1]);
    const minute = m[2] === undefined ? 0 : Number(m[2]);
    const meridiem = (m[3] ?? shared)?.replace(/\./g, '') ?? null;

    if (minute > 59) return [];

    let h24: number;
    if (meridiem === null) {
      // No am/pm anywhere: only an unmistakable 24-hour time is a reading.
      if (hour < 13 || hour > 23) return [];
      h24 = hour;
    } else {
      if (hour < 1 || hour > 12) return [];
      h24 = meridiem === 'pm' ? (hour % 12) + 12 : hour % 12;
    }

    const time = `${pad(h24)}:${pad(minute)}`;
    if (!times.includes(time)) times.push(time);
  }

  return times;
}

// ---------------------------------------------------------------------------
// From page to drafts
// ---------------------------------------------------------------------------

/** What the review of one sitting does not carry, kept for the screen. */
export interface SittingMeta {
  /** Which heading on the page this sitting sits under. */
  readonly block: number;
  readonly dayWritten: string | null;
  /** Where the date came from: the line itself, or line + page title. */
  readonly dateFrom: 'sheet' | 'header' | null;
  readonly headerDate: HeaderDate | null;
  readonly timeWording: string | null;
  /** Two or more readable times — the owner picks one. Empty otherwise. */
  readonly timeOptions: readonly string[];
  /** The sheet's own guest wording, kept for display after it became a number. */
  readonly guestsWording: string | null;
}

export interface PageJob {
  readonly draft: JobSheetDraft;
  readonly meta: SittingMeta;
  /** Shared by every job under one heading when it holds 2+ sittings. */
  readonly group: string | null;
  /** Set once this job is written; it is then left alone. */
  readonly savedJobId: string | null;
}

export interface PageDraft {
  readonly header: string | null;
  readonly jobs: readonly PageJob[];
  readonly unplaced: readonly string[];
  readonly uncertain: readonly { readonly field: string; readonly saw: string | null }[];
  /** One confirmation covers every date built from the page title. */
  readonly headerDatesConfirmed: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^\d{2}:\d{2}$/;

/** One sitting as the single-sheet read the review already understands. */
export function sittingToRead(
  page: PageRead,
  block: BlockRead,
  sitting: SittingRead,
  blockIndex: number,
): { read: JobSheetRead; meta: SittingMeta } {
  const lineDate =
    sitting.serviceDate !== null && ISO_DATE.test(sitting.serviceDate) ? sitting.serviceDate : null;
  const headerDate = lineDate === null ? dateFromHeader(sitting.dayWritten, page.pageHeader) : null;
  const serviceDate = lineDate ?? headerDate?.date ?? null;

  const lineTime =
    sitting.serviceTime !== null && HH_MM.test(sitting.serviceTime) ? sitting.serviceTime : null;
  const times = lineTime === null ? timesFromWording(sitting.timeWording) : [];
  // One plain time in the wording is a reading, exactly like "16ppl". Two is a
  // question for the owner, and stays unanswered here.
  const serviceTime = lineTime ?? (times.length === 1 ? (times[0] ?? null) : null);

  const parsedGuests = sitting.guests ?? guestsFromWording(sitting.guestsWording);

  return {
    read: {
      customer: block.customer,
      property: block.property,
      serviceDate,
      serviceTime,
      serviceType: sitting.serviceType,
      guests: parsedGuests,
      // Wording that became a number is no longer unresolved. Wording that did
      // not stays here, and the review raises it as a gap (Rule 12).
      guestsWording: parsedGuests === null ? sitting.guestsWording : null,
      dishes: sitting.dishes,
      dietaries: sitting.dietaries,
      notes: sitting.notes,
      uncertain: sitting.uncertain,
    },
    meta: {
      block: blockIndex,
      dayWritten: sitting.dayWritten,
      dateFrom: lineDate !== null ? 'sheet' : headerDate !== null ? 'header' : null,
      headerDate,
      timeWording: sitting.timeWording,
      timeOptions: times.length >= 2 ? times : [],
      guestsWording: sitting.guestsWording,
    },
  };
}

/**
 * Every sitting on the page as its own draft job.
 *
 * `newGroupId` is passed in so this stays pure and testable; the screen hands it
 * `crypto.randomUUID`. A heading with one sitting gets no group — a lone job is
 * not an event.
 */
export function draftPage(
  page: PageRead,
  owner: OwnerData,
  newGroupId: () => string,
): PageDraft {
  const jobs: PageJob[] = [];

  page.blocks.forEach((block, blockIndex) => {
    const group = block.sittings.length >= 2 ? newGroupId() : null;

    for (const sitting of block.sittings) {
      const { read, meta } = sittingToRead(page, block, sitting, blockIndex);
      jobs.push({
        draft: draftFromReview(reviewJobSheet(read, owner)),
        meta,
        group,
        savedJobId: null,
      });
    }
  });

  return {
    header: page.pageHeader,
    jobs,
    unplaced: page.unplaced,
    uncertain: page.uncertain,
    headerDatesConfirmed: false,
  };
}

// ---------------------------------------------------------------------------
// What stands between each job and a save
// ---------------------------------------------------------------------------

/** The field name the header-date confirmation is filed under. */
export const HEADER_DATE_FIELD = 'serviceDate:header';

/**
 * A date built from the page title still needs his confirmation — unless he
 * has typed a date of his own, which is his answer.
 */
export function needsDateConfirm(page: PageDraft, job: PageJob): boolean {
  return (
    job.savedJobId === null &&
    job.meta.dateFrom === 'header' &&
    !page.headerDatesConfirmed &&
    job.draft.serviceDate.trim() === (job.draft.from.serviceDate ?? '').trim()
  );
}

/** Everything blocking job `at`. Empty means it may be saved. */
export function jobGaps(page: PageDraft, at: number): readonly Gap[] {
  const job = page.jobs[at];
  if (job === undefined) return [];

  const gaps: Gap[] = [...draftGaps(job.draft)];
  if (needsDateConfirm(page, job)) {
    gaps.push({
      field: HEADER_DATE_FIELD,
      label: 'Confirm the date — built from the page title',
      saw: job.meta.dayWritten,
    });
  }
  return gaps;
}

/** Not blocking — the time is a detail of a day already placed — but worth asking. */
export function timeQuestion(job: PageJob): readonly string[] {
  return job.savedJobId === null && job.draft.serviceTime.trim() === '' ? job.meta.timeOptions : [];
}

export function saveable(page: PageDraft, at: number): boolean {
  const job = page.jobs[at];
  return job !== undefined && job.savedJobId === null && jobGaps(page, at).length === 0;
}

// ---------------------------------------------------------------------------
// Changes that touch more than one job
// ---------------------------------------------------------------------------

/** Replace job `at`'s draft. */
export function withJob(
  page: PageDraft,
  at: number,
  change: (draft: JobSheetDraft) => JobSheetDraft,
): PageDraft {
  return {
    ...page,
    jobs: page.jobs.map((job, i) => (i === at ? { ...job, draft: change(job.draft) } : job)),
  };
}

/**
 * The heading is written once and applies to every sitting under it, so a
 * change to it applies to every UNSAVED job under it. A job already written is
 * left exactly as it was saved.
 */
export function setHeading(
  page: PageDraft,
  block: number,
  field: 'customer' | 'property',
  choice: NameChoice,
): PageDraft {
  return {
    ...page,
    jobs: page.jobs.map((job) =>
      job.meta.block === block && job.savedJobId === null
        ? { ...job, draft: { ...job.draft, [field]: { ...job.draft[field], choice } } }
        : job,
    ),
  };
}

export function markSaved(page: PageDraft, at: number, jobId: string): PageDraft {
  return {
    ...page,
    jobs: page.jobs.map((job, i) => (i === at ? { ...job, savedJobId: jobId } : job)),
  };
}

/**
 * After a save — whole or partial — every OTHER job that was going to create
 * the same new customer, property or recipe now points at the one just made.
 *
 * Without this, saving the Friday job creates "Aoife", and saving the Sunday job
 * creates a second "Aoife". Matched by the exact name the owner was shown, which
 * is the name `creationsFromDraft` created it under.
 */
export function settleAcrossPage(
  page: PageDraft,
  saved: JobSheetDraft,
  ids: CreatedRecords,
): PageDraft {
  const createdName = (name: NameDraft): string | null =>
    name.choice.kind === 'create' ? name.choice.name : null;

  const customerName = createdName(saved.customer);
  const propertyName = createdName(saved.property);

  const settle = <T extends NameDraft>(name: T, wanted: string | null, id: string | null): T =>
    wanted !== null &&
    id !== null &&
    name.choice.kind === 'create' &&
    name.choice.name === wanted
      ? { ...name, choice: { kind: 'existing', id, name: wanted } }
      : name;

  return {
    ...page,
    jobs: page.jobs.map((job) => ({
      ...job,
      draft: {
        ...job.draft,
        customer: settle(job.draft.customer, customerName, ids.customerId),
        property: settle(job.draft.property, propertyName, ids.propertyId),
        dishes: job.draft.dishes.map((dish) =>
          dish.choice.kind === 'create'
            ? settle(dish, dish.choice.name, ids.recipeIds.get(dish.choice.name) ?? null)
            : dish,
        ),
      },
    })),
  };
}
