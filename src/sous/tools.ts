/**
 * The fixed set of typed tools (Rule 3).
 *
 * "Ask Sous is a tool-calling layer, not a chat box. Adding a capability means
 * writing a new tool function, not extending a prompt."
 *
 * So this registry is the whole surface. The JSON schema sent to the model is
 * DERIVED from it below, which means the two cannot drift: a tool that is not
 * here is not offered, and a name the model invents is refused by the dispatcher
 * rather than executed.
 *
 * TWO KINDS, AND NO THIRD:
 *
 *   read     runs the engine and returns what it returned
 *   propose  runs `changeImpact` and returns a before/after diff — WRITES NOTHING
 *
 * There is deliberately no `commit` kind. Committing lives in `commit.ts`, is not
 * registered, and is called by the owner tapping confirm (Rule 7). A model that
 * returns `{tool: 'commit'}` gets an error back, because the dispatcher resolves
 * names against this object and finds nothing.
 *
 * NOTHING HERE CALCULATES. Every figure comes from the engine module each tool
 * wraps; this file selects and passes through. `tests/sous/guards.test.ts`
 * source-inspects it for arithmetic.
 */

import { anomalyScan, readinessCheck } from '../engine/checks';
import { rangeMoney } from '../engine/costing';
import { changeImpact } from '../engine/impact';
import { prepPlanByDay, productionBuckets } from '../engine/production';
import { applyBuffetSplit } from '../engine/rules';
import { outstandingShopping, requirementsForRange } from '../engine/shopping';
import { TOOL_NAMES, type Intent, type ToolName } from './intent';
import type { OutstandingLine } from '../engine/shopping';
import type {
  ClientRate,
  Customer,
  Ingredient,
  Job,
  Recipe,
  ServiceTemplate,
  StockLevel,
} from '../engine/types';

/** Everything the tools read. Loaded once by the screen, passed in. */
export interface SousData {
  readonly jobs: readonly Job[];
  readonly recipes: readonly Recipe[];
  readonly ingredients: readonly Ingredient[];
  readonly customers: readonly Customer[];
  readonly rates: readonly ClientRate[];
  readonly stock: readonly StockLevel[];
  readonly templates: readonly ServiceTemplate[];
  /**
   * The default window, supplied by the SCREEN rather than computed here.
   *
   * "How much adobo" carries no dates, and a tool that invented them would be
   * deciding business scope on its own. The screen owns the clock; this layer
   * stays pure and testable with a fixed date.
   */
  readonly today: string;
  readonly horizon: string;
}

export type ToolKind = 'read' | 'propose';

/** What a tool produced. Discriminated so the screen renders the right thing. */
export type ToolResult =
  | { readonly kind: 'how_much'; readonly value: HowMuch }
  | { readonly kind: 'clarify'; readonly value: { readonly question: string } }
  | { readonly kind: 'shopping'; readonly value: ReturnType<typeof shoppingFor> }
  | { readonly kind: 'prep'; readonly value: ReturnType<typeof prepFor> }
  | { readonly kind: 'packing'; readonly value: ReturnType<typeof packingFor> }
  | { readonly kind: 'money'; readonly value: ReturnType<typeof moneyFor> }
  | { readonly kind: 'job'; readonly value: ReturnType<typeof jobDetails> }
  | { readonly kind: 'problems'; readonly value: ReturnType<typeof attention> }
  | { readonly kind: 'proposal'; readonly value: Proposal };

/**
 * A proposed change, with the diff the owner is being asked to approve.
 *
 * `commit.ts` accepts nothing else. That is the fourth of the four things that
 * make Rule 7 a guarantee: even code holding a repository cannot commit without
 * an object the propose path built.
 */
export interface Proposal {
  readonly jobId: Job['id'];
  /** What the owner asked for, echoed. Never anything the model derived. */
  readonly changes: Record<string, unknown>;
  /** The before/after, straight from `changeImpact`. */
  readonly impact: ReturnType<typeof changeImpact>;
  /** The job as it would be saved. Built by the ENGINE path, not the model. */
  readonly after: Job;
}

/**
 * FOUR STATES, and conflating any two of them is the defect this tool exists to
 * fix. The bug that prompted it returned an unrelated anomalies object for a
 * quantity question; the fix is not just routing but being able to SAY each of
 * these.
 *
 *   no_such_ingredient   nothing by that name is recorded at all
 *   ambiguous            several match — names them, never picks (Rule 8)
 *   none_needed          it exists, and nothing in the window uses it
 *   needed               here is the quantity
 *
 * `none_needed` is the one the old code could not express. A zero requirement is
 * a real answer and has to be said out loud.
 */
export type HowMuch =
  | { readonly state: 'no_such_ingredient'; readonly asked: string }
  | { readonly state: 'ambiguous'; readonly asked: string; readonly matches: readonly string[] }
  | {
      readonly state: 'none_needed';
      readonly name: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly state: 'needed';
      readonly name: string;
      readonly from: string;
      readonly to: string;
      readonly line: OutstandingLine;
      readonly pack: Ingredient['pack'];
    };

const inRange = (jobs: readonly Job[], from: string, to: string): Job[] =>
  jobs.filter((j) => j.serviceDate !== null && j.serviceDate >= from && j.serviceDate <= to);

/** Same status filter the operational screens use. */
const OPERATIONAL = new Set(['confirmed', 'in_prep']);

// ---------------------------------------------------------------------------
// Read tools — each one a thin pass-through to the engine
// ---------------------------------------------------------------------------

function shoppingFor(data: SousData, from: string, to: string) {
  const jobs = inRange(data.jobs, from, to).filter((j) => OPERATIONAL.has(j.status));
  const requirements = requirementsForRange(jobs, data.recipes, data.ingredients);

  return {
    from,
    to,
    jobCount: jobs.length,
    lines: outstandingShopping(requirements.lines, data.stock, [], data.ingredients),
    gaps: requirements.gaps,
  };
}

function prepFor(data: SousData, from: string, to: string) {
  const jobs = data.jobs.filter((j) => OPERATIONAL.has(j.status));
  const days = prepPlanByDay(productionBuckets(jobs, data.recipes)).filter(
    (d) => d.prepDate >= from && d.prepDate <= to,
  );

  return { from, to, days };
}

function packingFor(data: SousData, jobId: string) {
  const job = data.jobs.find((j) => j.id === jobId);
  if (job === undefined) return { job: null, dishes: [], equipment: [] };

  // The same single implementation the packing screen uses to fill null portions.
  const dishes =
    job.guests === null ? job.dishes : applyBuffetSplit(job.guests, job.dishes, data.recipes);

  return {
    job,
    dishes,
    equipment: data.templates.filter((t) => t.serviceType === job.serviceType),
  };
}

function moneyFor(data: SousData, from: string, to: string) {
  const jobs = inRange(data.jobs, from, to);

  return {
    from,
    to,
    total: rangeMoney(jobs, data.customers, data.rates, data.recipes, data.ingredients),
  };
}

function jobDetails(data: SousData, jobId: string) {
  const job = data.jobs.find((j) => j.id === jobId);
  if (job === undefined) return { job: null, readiness: null };

  // Rule 5: readinessCheck takes these as INPUTS rather than recomputing them, so
  // the figures cannot disagree with the screens.
  const requirements = requirementsForRange([job], data.recipes, data.ingredients);
  const outstanding = outstandingShopping(
    requirements.lines,
    data.stock,
    [],
    data.ingredients,
  );
  const money = rangeMoney([job], data.customers, data.rates, data.recipes, data.ingredients);

  return {
    job,
    readiness: readinessCheck(job, {
      revenueKnown: money.revenue.total !== null,
      outstandingCount: outstanding.filter((l) => l.outstanding.value > 0).length,
      dietaryIssues: 0,
    }),
  };
}

function attention(data: SousData, from: string, to: string) {
  const jobs = inRange(data.jobs, from, to);
  return { from, to, anomalies: anomalyScan(jobs, data.recipes) };
}

/**
 * How much of ONE ingredient is needed.
 *
 * Runs the same cascade the Shopping screen runs and then picks one line out of
 * it, so the figure here and the figure there cannot disagree. It does no
 * arithmetic of its own — `outstandingShopping` already did the subtraction.
 */
function howMuch(data: SousData, asked: string, from: string, to: string): HowMuch {
  const wanted = asked.trim().toLowerCase();

  // Exact match first, then contains. "adobo" should find "Adobo seasoning"
  // without "chicken" finding every chicken dish when one is named exactly that.
  const exact = data.ingredients.filter((i) => i.name.trim().toLowerCase() === wanted);
  const matches =
    exact.length > 0 ? exact : data.ingredients.filter((i) => i.name.toLowerCase().includes(wanted));

  if (matches.length === 0) return { state: 'no_such_ingredient', asked };

  if (matches.length > 1) {
    // Rule 8: naming the candidates is an answer. Picking one is a guess, and a
    // guess about which ingredient he meant is a wrong shopping quantity.
    return { state: 'ambiguous', asked, matches: matches.map((i) => i.name) };
  }

  const ingredient = matches[0] as Ingredient;
  const jobs = inRange(data.jobs, from, to).filter((j) => OPERATIONAL.has(j.status));
  const requirements = requirementsForRange(jobs, data.recipes, data.ingredients);
  const lines = outstandingShopping(requirements.lines, data.stock, [], data.ingredients);
  const line = lines.find((l) => l.ingredientId === ingredient.id);

  // Nothing in the window uses it. A REAL answer, and the one the old routing
  // replaced with an unrelated object.
  if (line === undefined) {
    return { state: 'none_needed', name: ingredient.name, from, to };
  }

  return { state: 'needed', name: ingredient.name, from, to, line, pack: ingredient.pack };
}

// ---------------------------------------------------------------------------
// The propose tool — a diff, never a write
// ---------------------------------------------------------------------------

function proposeJobChange(
  data: SousData,
  args: { jobId: string; guests?: number; serviceDate?: string; serviceType?: string; status?: string },
): Proposal | null {
  const job = data.jobs.find((j) => j.id === args.jobId);
  if (job === undefined) return null;

  // Only the fields the owner actually named. An absent key is "unchanged", which
  // is not the same as null — null would mean "clear it" (Rule 8).
  const changes: Record<string, unknown> = {};
  if (args.guests !== undefined) changes['guests'] = args.guests;
  if (args.serviceDate !== undefined) changes['serviceDate'] = args.serviceDate;
  if (args.serviceType !== undefined) changes['serviceType'] = args.serviceType;
  if (args.status !== undefined) changes['status'] = args.status;

  return {
    jobId: job.id,
    changes,
    // The proposal IS the engine's diff. Rule 7's before/after is not something
    // invented here — it is what `changeImpact` has returned since it was written.
    impact: changeImpact(data.jobs, data.recipes, data.ingredients, job.id, changes, {
      customer: data.customers.find((c) => c.id === job.customerId),
      rates: data.rates,
    }),
    after: { ...job, ...changes } as Job,
  };
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  readonly name: ToolName;
  readonly kind: ToolKind;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly run: (data: SousData, args: Record<string, never>) => ToolResult | null;
}

const rangeSchema = {
  type: 'object',
  properties: {
    from: { type: 'string', description: 'First date, YYYY-MM-DD' },
    to: { type: 'string', description: 'Last date, YYYY-MM-DD' },
  },
  required: ['from', 'to'],
} as const;

const jobSchema = {
  type: 'object',
  properties: { jobId: { type: 'string', description: 'The job id from the context list' } },
  required: ['jobId'],
} as const;

/** Typed loosely at the boundary because the args arrive as JSON from the model. */
type Args = Record<string, string | number | undefined>;

export const TOOLS: Readonly<Record<ToolName, ToolDefinition>> = {
  how_much_ingredient: {
    name: 'how_much_ingredient',
    kind: 'read',
    // Leads with the phrasings, because the routing bug was a naming collision:
    // the old `what_needs_attention` captured "how much X do I NEED".
    description:
      "How much of ONE ingredient is needed. Use for 'how much X do I need', 'how many X', 'do I have enough X', 'have I got enough X'. Dates are optional.",
    parameters: {
      type: 'object',
      properties: {
        ingredient: { type: 'string', description: 'The ingredient name the owner used' },
        from: { type: 'string', description: 'Optional first date, YYYY-MM-DD' },
        to: { type: 'string', description: 'Optional last date, YYYY-MM-DD' },
      },
      required: ['ingredient'],
    },
    run: (d, a) => {
      const args = a as Args;
      // Dates optional: "how much adobo" is a question about the near future, and
      // refusing to answer without a range would be pedantry. The window used is
      // reported back so the answer states what it covered.
      const from = args.from === undefined ? d.today : String(args.from);
      const to = args.to === undefined ? d.horizon : String(args.to);

      return { kind: 'how_much', value: howMuch(d, String(args.ingredient), from, to) };
    },
  },

  clarify: {
    name: 'clarify',
    kind: 'read',
    description:
      'Ask the owner a question when you cannot tell which job, ingredient or dates are meant. Use this rather than guessing. Also use it when the question is not about this kitchen at all.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: 'What to ask him' } },
      required: ['question'],
    },
    // Returns a QUESTION, never a fact. This is what stops general knowledge
    // being answered from the model's own head: there is no tool for it, and the
    // only thing it can do with an unmappable question is hand it back.
    run: (_d, a) => ({ kind: 'clarify', value: { question: String((a as Args).question) } }),
  },

  shopping_for_range: {
    name: 'shopping_for_range',
    kind: 'read',
    description: 'What still needs buying between two dates.',
    parameters: rangeSchema,
    run: (d, a) => ({
      kind: 'shopping',
      value: shoppingFor(d, String((a as Args).from), String((a as Args).to)),
    }),
  },
  prep_for_range: {
    name: 'prep_for_range',
    kind: 'read',
    description: 'What to make on which day between two dates.',
    parameters: rangeSchema,
    run: (d, a) => ({
      kind: 'prep',
      value: prepFor(d, String((a as Args).from), String((a as Args).to)),
    }),
  },
  packing_for_job: {
    name: 'packing_for_job',
    kind: 'read',
    description: 'The food and equipment to pack for one job.',
    parameters: jobSchema,
    run: (d, a) => ({ kind: 'packing', value: packingFor(d, String((a as Args).jobId)) }),
  },
  money_for_range: {
    name: 'money_for_range',
    kind: 'read',
    description: 'Revenue, food cost and margin between two dates.',
    parameters: rangeSchema,
    run: (d, a) => ({
      kind: 'money',
      value: moneyFor(d, String((a as Args).from), String((a as Args).to)),
    }),
  },
  job_details: {
    name: 'job_details',
    kind: 'read',
    description: 'Everything about one job, and whether it is ready.',
    parameters: jobSchema,
    run: (d, a) => ({ kind: 'job', value: jobDetails(d, String((a as Args).jobId)) }),
  },
  problems_with_jobs: {
    name: 'problems_with_jobs',
    kind: 'read',
    // Worded off "need" entirely. The old name and description between them
    // captured quantity questions.
    description:
      'Anomalies and unresolved items — jobs missing a guest count, a menu, an address, or with a dietary that has not been pinned down.',
    parameters: rangeSchema,
    run: (d, a) => ({
      kind: 'problems',
      value: attention(d, String((a as Args).from), String((a as Args).to)),
    }),
  },
  propose_job_change: {
    name: 'propose_job_change',
    kind: 'propose',
    description:
      'Propose a change to a job. Returns a before/after for the owner to confirm. Does NOT save.',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        guests: { type: 'number', description: 'Only if the owner stated a new guest count' },
        serviceDate: { type: 'string' },
        serviceType: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['jobId'],
    },
    run: (d, a) => {
      const proposal = proposeJobChange(d, {
        jobId: String((a as Args).jobId),
        ...((a as Args).guests === undefined ? {} : { guests: Number((a as Args).guests) }),
        ...((a as Args).serviceDate === undefined
          ? {}
          : { serviceDate: String((a as Args).serviceDate) }),
        ...((a as Args).serviceType === undefined
          ? {}
          : { serviceType: String((a as Args).serviceType) }),
        ...((a as Args).status === undefined ? {} : { status: String((a as Args).status) }),
      });

      return proposal === null ? null : { kind: 'proposal', value: proposal };
    },
  },
};

/**
 * The schema sent to the model, DERIVED from the registry.
 *
 * Built rather than hand-written so the two cannot drift. A hand-maintained copy
 * would eventually offer a tool that does not exist, or hide one that does.
 */
export const toolSchema = (): readonly {
  name: string;
  description: string;
  input_schema: Readonly<Record<string, unknown>>;
}[] =>
  TOOL_NAMES.map((name) => ({
    name: TOOLS[name].name,
    description: TOOLS[name].description,
    input_schema: TOOLS[name].parameters,
  }));

/**
 * Run an intent.
 *
 * Resolves the name AGAINST THE REGISTRY. This is what makes "the model cannot
 * commit" structural rather than hopeful: a returned name that is not a key here
 * — `commit`, `delete_job`, anything — finds nothing and is refused.
 */
export function runIntent(data: SousData, intent: Intent): ToolResult | null {
  const tool = (TOOLS as Record<string, ToolDefinition | undefined>)[intent.tool];
  if (tool === undefined) return null;

  return tool.run(data, intent.args as unknown as Record<string, never>);
}
