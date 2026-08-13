/**
 * Turning a tool result into sentences.
 *
 * PURE, and it does NO ARITHMETIC. Every figure here arrives already computed and
 * already formatted: `buildShoppingView` produced `"2 × 1 kg"`, `formatMoney`
 * produced `"€360.00"` or `"not known yet"`. This file concatenates strings.
 *
 * That distinction is the whole of Rule 2 at the presentation layer. A renderer
 * that reached past the formatter for a raw number and did its own rounding would
 * be a second answer, free to disagree with the screen showing the same data —
 * which is exactly the drift `tests/ui/sousAnswer.test.ts` and the arithmetic
 * guard exist to prevent.
 *
 * WHY SENTENCES AT ALL: the screen used to render `JSON.stringify(result)`. Paul
 * reads this one-handed in a kitchen. "You need 3.15 kg of chicken breast — 4 × 1
 * kg packs" is the same data as `{from,to,lines:[…]}` and a completely different
 * product.
 */

import { formatMoney } from './form';
import { buildPrepView } from './prepView';
import { buildShoppingView } from './shoppingView';
import type { HowMuch, SousData, ToolResult } from '../sous/tools';

/**
 * A rendered answer.
 *
 * `lead` is the sentence; `detail` are the lines under it. Splitting them lets the
 * screen show the answer immediately and the workings underneath, rather than one
 * paragraph the owner has to parse.
 */
export interface Answer {
  readonly lead: string;
  readonly detail: readonly string[];
  /** Something he has to act on: a gap, an ambiguity, a missing record. */
  readonly flags: readonly string[];
}

/** Reads as a date a person would say, without inventing a locale format. */
const range = (from: string, to: string): string =>
  from === to ? `on ${from}` : `between ${from} and ${to}`;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

// ---------------------------------------------------------------------------

function howMuchAnswer(v: HowMuch): Answer {
  switch (v.state) {
    case 'no_such_ingredient':
      // Rule 8: an absent record and a zero requirement are different answers.
      return {
        lead: `You have no ingredient called "${v.asked}".`,
        detail: ['Add it in Ingredients if you use it, and it will appear in shopping.'],
        flags: [],
      };

    case 'ambiguous':
      // Naming the candidates IS the answer. Picking one would be a guess, and a
      // guess about which ingredient he meant is a wrong shopping quantity.
      return {
        lead: `More than one ingredient matches "${v.asked}".`,
        detail: v.matches.map((m) => m),
        flags: ['Ask again with the full name.'],
      };

    case 'none_needed':
      // THE ANSWER THE OLD ROUTING COULD NOT GIVE. A zero requirement is real and
      // has to be said, not swapped for an unrelated object.
      return {
        lead: `No ${v.name} needed ${range(v.from, v.to)}.`,
        detail: ['Nothing on the confirmed jobs in those dates uses it.'],
        flags: [],
      };

    case 'needed': {
      const line = v.line;
      const detail: string[] = [];

      // Every one of these strings came from the engine via the formatter. None is
      // recomputed here.
      if (line.onHand.value > 0) {
        detail.push(`${line.required.value} ${line.required.unit} needed, ${line.onHand.value} ${line.onHand.unit} already on the shelf.`);
      }
      if (line.surplus !== null) {
        detail.push(`You have ${line.surplus.value} ${line.surplus.unit} more than these dates need.`);
      }

      const flags: string[] = [];
      if (line.unreconciled > 0) {
        // Rule 4 surfacing: stock that could not be converted was left out of the
        // subtraction, so the figure OVER-states. Direction matters.
        flags.push(
          `Some stock could not be counted in ${line.outstanding.unit}, so this may be more than you actually need.`,
        );
      }
      if (v.pack?.assumed === true) {
        flags.push('The pack size is assumed, not confirmed — the pack count may be wrong.');
      }

      const packs =
        line.packs === null || v.pack === null
          ? null
          : `${line.packs.packs} × ${v.pack.size} ${v.pack.unit}`;

      if (line.outstanding.value <= 0) {
        return {
          lead: `You have enough ${v.name} — nothing to buy ${range(v.from, v.to)}.`,
          detail,
          flags,
        };
      }

      return {
        lead:
          packs === null
            ? `You need ${line.outstanding.value} ${line.outstanding.unit} of ${v.name} ${range(v.from, v.to)}.`
            : `You need ${line.outstanding.value} ${line.outstanding.unit} of ${v.name} — ${packs}.`,
        detail,
        flags: packs === null ? [...flags, 'No pack size set, so buy it by quantity.'] : flags,
      };
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Render any tool result.
 *
 * `data` is needed only to resolve names for the views that group by supplier or
 * job — it is never used to compute.
 */
export function renderAnswer(result: ToolResult, data: SousData): Answer {
  switch (result.kind) {
    case 'how_much':
      return howMuchAnswer(result.value);

    case 'clarify':
      // A QUESTION, never a fact. This is what a question the model could not map
      // turns into, instead of an answer from its own knowledge.
      return { lead: result.value.question, detail: [], flags: [] };

    case 'shopping': {
      const view = buildShoppingView(result.value.lines, result.value.gaps, data.ingredients, []);
      const lines = view.groups.flatMap((g) => g.lines);

      if (view.nothingToBuy) {
        return {
          lead: `Nothing to buy ${range(result.value.from, result.value.to)}.`,
          detail:
            result.value.jobCount === 0
              ? ['No confirmed jobs in those dates.']
              : ['Everything those jobs need is already in stock.'],
          flags: view.needsFixing.map((f) => `${f.label} — fix in ${f.where}`),
        };
      }

      return {
        lead: `${lines.length} ${plural(lines.length, 'thing', 'things')} to buy ${range(result.value.from, result.value.to)}.`,
        detail: lines.map((l) => `${l.buy ?? l.outstanding} — ${l.name}`),
        flags: [
          ...view.checkYourself.map((c) => c.label),
          ...view.needsFixing.map((f) => `${f.label} — fix in ${f.where}`),
        ],
      };
    }

    case 'prep': {
      const view = buildPrepView(result.value.days, [], data.jobs, data.customers, []);

      if (view.days.length === 0) {
        return {
          lead: `Nothing to make ${range(result.value.from, result.value.to)}.`,
          detail: [],
          flags: [],
        };
      }

      return {
        lead: `${view.days.length} prep ${plural(view.days.length, 'day', 'days')} ${range(result.value.from, result.value.to)}.`,
        detail: view.days.flatMap((d) =>
          d.lines.map((l) => `${d.prepDate}: ${l.batchLabel ?? `${l.portions} portions`} of ${l.recipeName}`),
        ),
        flags: view.needsFixing.map((f) => `${f.label} — fix in ${f.where}`),
      };
    }

    case 'money': {
      const t = result.value.total;

      return {
        lead: `${formatMoney(t.revenue.total, 'Revenue not known')} in, ${formatMoney(t.foodCost.total, 'food cost not known')} on food ${range(result.value.from, result.value.to)}.`,
        detail: [
          `Margin: ${formatMoney(t.margin.total, 'not known yet')}.`,
          `${t.jobs} ${plural(t.jobs, 'job', 'jobs')} in those dates.`,
        ],
        // Rule 11 surfacing: a subtotal that does not cover everything says so.
        flags: [
          ...(t.revenue.unpriced > 0
            ? [`${t.revenue.unpriced} ${plural(t.revenue.unpriced, 'job', 'jobs')} could not be priced, so the total does not cover ${plural(t.revenue.unpriced, 'it', 'them')}.`]
            : []),
          ...(t.foodCost.uncosted > 0
            ? [`${t.foodCost.uncosted} ${plural(t.foodCost.uncosted, 'job', 'jobs')} could not be costed.`]
            : []),
        ],
      };
    }

    case 'packing': {
      const job = result.value.job;
      if (job === null) return { lead: 'I could not find that job.', detail: [], flags: [] };

      return {
        lead: `Packing for ${job.serviceType ?? 'that job'} on ${job.serviceDate ?? 'an unset date'}.`,
        detail: [
          ...result.value.dishes.map(
            (d) => `${d.portions === null ? 'portions not set' : `${d.portions}`} — dish`,
          ),
          ...result.value.equipment.map((e) => e.item),
        ],
        flags:
          result.value.equipment.length === 0
            ? ['No equipment list for this service type yet — set one up in Setup.']
            : [],
      };
    }

    case 'job': {
      const job = result.value.job;
      if (job === null) return { lead: 'I could not find that job.', detail: [], flags: [] };

      const readiness = result.value.readiness;

      return {
        lead: `${job.serviceType ?? 'Job'} on ${job.serviceDate ?? 'an unset date'}, ${job.guests === null ? 'guest count not set' : `${job.guests} guests`}, ${job.status}.`,
        detail: [],
        // `met` is the field, and `detail` is nullable — an unmet item with no
        // detail falls back to its label rather than rendering an empty bullet.
        flags: (readiness?.items ?? [])
          .filter((i) => !i.met)
          .map((i) => i.detail ?? i.label),
      };
    }

    case 'problems': {
      const anomalies = result.value.anomalies;

      if (anomalies.length === 0) {
        return {
          lead: `Nothing looks wrong ${range(result.value.from, result.value.to)}.`,
          detail: [],
          flags: [],
        };
      }

      return {
        lead: `${anomalies.length} ${plural(anomalies.length, 'thing', 'things')} to look at ${range(result.value.from, result.value.to)}.`,
        detail: anomalies.map((a) => a.detail),
        flags: [],
      };
    }

    case 'proposal':
      // The proposal renders its own before/after through the impact it carries.
      // Rule 7: this is a suggestion until he taps confirm, and the wording says so.
      return {
        lead: 'Here is what that change would do. Nothing is saved until you confirm.',
        detail: [],
        flags: [],
      };
  }
}
