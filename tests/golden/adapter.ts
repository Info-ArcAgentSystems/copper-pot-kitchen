/**
 * Fixture JSON -> engine domain objects.
 *
 * TEST-ONLY. If anything under `src/` ever imports this file, that is a bug
 * (Rule 1). The owner's historical data lives here so the engine can be run
 * against it; it must never ship.
 *
 * The fixture is not a schema. Component keys carry their unit as a suffix
 * (`chicken_breast_g`), and the expected-result keys are prose that does not
 * always match (`egg_each` in the recipe, `eggs_each` in the expectation). This
 * adapter does the structural half; the prose mismatches are mapped explicitly at
 * each assertion, where they are visible.
 */

import fixturesJson from '../fixtures/fixtures.json' with { type: 'json' };
import type {
  AllocatedDietary,
  Course,
  Ingredient,
  IngredientId,
  Job,
  JobDietary,
  JobDish,
  JobDishId,
  JobId,
  KitchenId,
  Recipe,
  RecipeId,
  RecipeLineId,
  RecipeUnit,
  StockUnit,
} from '../../src/engine/types';

export const fixtures = fixturesJson as unknown as Fixtures;

interface Fixtures {
  metadata: { name: string };
  business_rules: {
    pricing: Record<string, Record<string, { amount_eur_pp?: number; amount_eur_each?: number }>>;
    recipes: Record<string, RawRecipe>;
  };
  historical_jobs: RawJob[];
  weekend_benchmarks: { id: string; jobs?: string[]; expected_revenue_eur?: number }[];
  change_history_cases: { id: string; description: string; expected_behavior: string[] }[];
}

interface RawRecipe {
  per_portion?: Record<string, number | number[]>;
  per_tray?: Record<string, number>;
  per_meat_eating_guest?: Record<string, number>;
  per_guest?: Record<string, number>;
  yield_portions_per_tray?: number;
  other_components?: string[];
}

interface RawJob {
  id: string;
  date: string;
  service: string;
  guests: number;
  menu?: string[];
  choices?: Record<string, number>;
  guest_split?: Record<string, number>;
  dietaries?: { type: string; count: number; severity?: string; applies_to?: string }[];
  pricing?: { client?: string };
}

const KITCHEN = 'kitchen-golden' as KitchenId;

let seq = 0;
const nextId = (): string => `golden-${(seq += 1)}`;

/**
 * A component key carries its unit as a suffix. `chicken_breast_g` is 'chicken
 * breast' measured in grams. Plural supplier-ish units are normalised to their
 * singular so `curry_sauce_jars` and a `jar` pack agree.
 */
const UNIT_SUFFIXES: readonly (readonly [string, string])[] = [
  ['_g', 'g'],
  ['_ml', 'ml'],
  ['_kg', 'kg'],
  ['_each', 'each'],
  ['_jars', 'jar'],
  ['_units', 'unit'],
];

export function splitKey(key: string): { name: string; unit: string } {
  for (const [suffix, unit] of UNIT_SUFFIXES) {
    if (key.endsWith(suffix)) return { name: key.slice(0, -suffix.length), unit };
  }
  return { name: key, unit: 'each' };
}

function componentsFrom(
  source: Record<string, number | number[]>,
): { lines: Recipe['components']; ranged: string[] } {
  const lines: Recipe['components'][number][] = [];
  const ranged: string[] = [];

  for (const [key, value] of Object.entries(source)) {
    // Rule 13: a recipe quantity is one number. `types.ts` has no range type, so a
    // ranged value cannot be represented — and inventing one end of it would be
    // inventing owner data. It is recorded as unquantified instead.
    if (Array.isArray(value)) {
      ranged.push(key);
      continue;
    }

    const { name, unit } = splitKey(key);
    lines.push({
      kind: 'ingredient',
      id: nextId() as RecipeLineId,
      displayName: name,
      position: lines.length,
      qty: value,
      unit: unit as RecipeUnit,
      ingredientId: name as IngredientId,
    });
  }

  return { lines, ranged };
}

function makeRecipe(
  name: string,
  course: Course | null,
  source: Record<string, number | number[]>,
  extra: Partial<Recipe> = {},
  unquantifiedNames: readonly string[] = [],
): Recipe {
  const { lines, ranged } = componentsFrom(source);

  return {
    id: name as RecipeId,
    kitchenId: KITCHEN,
    name,
    course,
    yieldType: 'per_person',
    portionsPerBatch: null,
    batchUnit: null,
    confidence: 'confirm',
    makeAheadDays: 0,
    sameDayOnly: true,
    freezable: false,
    onsiteFinish: false,
    method: null,
    note: null,
    components: lines,
    unquantified: [...unquantifiedNames, ...ranged].map((item) => ({
      id: nextId() as RecipeLineId,
      item,
      reason: ranged.includes(item)
        ? 'stated as a range in the fixture; Rule 13 allows only a single number'
        : 'named in the fixture with no quantity',
    })),
    ...extra,
  };
}

/**
 * Every recipe in the pack.
 *
 * BBQ becomes TWO recipes. ARCHITECTURE is explicit that merging them back is the
 * defect the golden pack caught: meat scales to meat-eating guests, sides scale to
 * all guests.
 */
export function goldenRecipes(): Recipe[] {
  const r = fixtures.business_rules.recipes;

  return [
    makeRecipe('Chicken Curry', 'main', r['Chicken Curry']?.per_portion ?? {}),
    makeRecipe('Lasagne', 'main', r['Lasagne']?.per_tray ?? {}, {
      yieldType: 'batch',
      portionsPerBatch: r['Lasagne']?.yield_portions_per_tray ?? null,
      batchUnit: 'tray',
    }),
    makeRecipe('Pancakes', 'breakfast', r['Pancakes']?.per_portion ?? {}),
    makeRecipe('Continental', 'breakfast', r['Continental Breakfast']?.per_portion ?? {}),
    makeRecipe(
      'Full Irish',
      'breakfast',
      r['Full Irish']?.per_portion ?? {},
      {},
      r['Full Irish']?.other_components ?? [],
    ),
    makeRecipe('BBQ Meat', 'main', r['BBQ']?.per_meat_eating_guest ?? {}),
    makeRecipe('BBQ Sides', 'side', r['BBQ']?.per_guest ?? {}),
  ];
}

/** One ingredient per component name, in the unit the recipes use. */
export function goldenIngredients(recipes: readonly Recipe[]): Ingredient[] {
  const seen = new Map<IngredientId, Ingredient>();

  for (const recipe of recipes) {
    for (const c of recipe.components) {
      if (c.kind !== 'ingredient' || seen.has(c.ingredientId)) continue;

      seen.set(c.ingredientId, {
        id: c.ingredientId,
        kitchenId: KITCHEN,
        name: c.displayName,
        category: null,
        stockUnit: (c.unit ?? 'each') as unknown as StockUnit,
        recipeUnit: c.unit,
        recipeUnitsPerStockUnit: null,
        pack: null,
        supplierId: null,
        // The fixture carries no ingredient prices, so food cost is not derivable
        // from it. Rule 8: null, never a stand-in zero.
        pricePerPack: null,
        previousPrice: null,
        priceChecked: null,
        allergens: [],
      });
    }
  }

  return [...seen.values()];
}

const dish = (recipe: string, portions: number | null, position: number): JobDish => ({
  id: nextId() as JobDishId,
  jobId: 'unused' as JobId,
  recipeId: recipe as RecipeId,
  portions,
  note: null,
  position,
});

/** "Vegan chickpea curry x3" -> 3 portions. No suffix means the full guest count. */
function parseMenuLine(line: string, guests: number, position: number): JobDish {
  const match = /^(.*?)\s*x(\d+)$/.exec(line);
  return match === null
    ? dish(line, guests, position)
    : dish(match[1] as string, Number(match[2]), position);
}

/**
 * `{ type: 'gluten_free', count: 2 }` becomes two allocated records with distinct
 * guest refs.
 *
 * That is the fixture's own semantics — separate entries are separate people. It
 * also keeps Rule 16 honest: the engine counts distinct guests, and expanding a
 * count here is the adapter's job, not the engine's.
 */
function dietariesFrom(raw: RawJob): JobDietary[] {
  const out: JobDietary[] = [];

  for (const d of raw.dietaries ?? []) {
    for (let i = 0; i < d.count; i += 1) {
      const record: AllocatedDietary = {
        kind: 'allocated',
        id: nextId() as AllocatedDietary['id'],
        jobId: raw.id as JobId,
        dietType: d.type,
        severity: (d.severity ?? 'moderate') as AllocatedDietary['severity'],
        excludesMeat: false,
        details: d.applies_to ?? null,
        assignedRecipeId: null,
        guest: `${raw.id}-${d.type}-${i}` as AllocatedDietary['guest'],
      };
      out.push(record);
    }
  }

  return out;
}

export function goldenJob(id: string): Job {
  const raw = fixtures.historical_jobs.find((j) => j.id === id);
  if (raw === undefined) throw new Error(`golden fixture has no job "${id}"`);

  const dishes: JobDish[] = raw.choices
    ? Object.entries(raw.choices).map(([name, portions], i) => dish(name, portions, i))
    : (raw.menu ?? []).map((line, i) => parseMenuLine(line, raw.guests, i));

  return {
    id: raw.id as JobId,
    kitchenId: KITCHEN,
    customerId: null,
    propertyId: null,
    jobGroup: null,
    serviceDate: raw.date as Job['serviceDate'],
    serviceTime: null,
    serviceType: raw.service,
    guests: raw.guests,
    guestsConfirmed: true,
    // The owner's own figure, recorded in the fixture. Never derived by
    // subtracting dietary counts — that is the arithmetic Rule 16 forbids.
    meatEatingGuests: raw.guest_split?.['meat_eaters'] ?? null,
    pricing: { kind: 'rate_card' },
    status: 'paid',
    notes: null,
    dishes,
    dietaries: dietariesFrom(raw),
    extras: [],
  };
}

export const expectedFor = <T>(id: string, list: readonly { id: string }[]): T => {
  const found = list.find((t) => t.id === id);
  if (found === undefined) throw new Error(`golden pack has no case "${id}"`);
  return found as T;
};
