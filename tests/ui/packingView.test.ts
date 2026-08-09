/**
 * The packing list, per job.
 *
 * PURE, so it runs in Node with no DOM.
 *
 * The behaviour that separates this screen from the other two derived ones is the
 * ABSENCE of consolidation. Shopping and Prep exist to roll up across jobs;
 * packing must not, because each job goes into its own boxes and its own van run.
 * A rollup here would produce a screen that is confidently useless — one line of
 * 39 portions for three deliveries.
 *
 * The other load-bearing behaviour is the tick key. `packing_state.item` is free
 * text, so the key has to be stable and namespaced or ticks collide and orphan.
 */

import { describe, expect, it } from 'vitest';
import { buildPackingView, foodKey, equipmentKey } from '../../src/ui/packingView';
import type { RequirementGap } from '../../src/engine/shopping';
import type {
  Customer,
  CustomerId,
  IsoDate,
  Job,
  JobDish,
  JobDishId,
  JobId,
  KitchenId,
  PackingState,
  Recipe,
  RecipeId,
  ServiceTemplate,
  ServiceTemplateId,
} from '../../src/engine/types';

const KITCHEN = 'k1' as KitchenId;

const recipe = (id: string, name: string, course: Recipe['course'] = 'main'): Recipe => ({
  id: id as RecipeId,
  kitchenId: KITCHEN,
  name,
  course,
  yieldType: 'batch',
  portionsPerBatch: 9,
  batchUnit: 'tray',
  confidence: 'locked',
  makeAheadDays: 0,
  sameDayOnly: true,
  freezable: false,
  onsiteFinish: false,
  method: null,
  note: null,
  components: [],
  unquantified: [],
});

const dish = (recipeId: string, portions: number | null, position = 0): JobDish => ({
  id: `d-${recipeId}-${position}` as JobDishId,
  jobId: 'j1' as JobId,
  recipeId: recipeId as RecipeId,
  portions,
  note: null,
  position,
});

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id: id as JobId,
  kitchenId: KITCHEN,
  customerId: 'c1' as CustomerId,
  propertyId: null,
  jobGroup: null,
  serviceDate: '2026-08-18' as IsoDate,
  serviceTime: null,
  serviceType: 'Buffet',
  guests: 18,
  guestsConfirmed: true,
  meatEatingGuests: null,
  pricing: { kind: 'rate_card' },
  status: 'confirmed',
  notes: null,
  dishes: [dish('lasagne', 18)],
  dietaries: [],
  extras: [],
  ...over,
});

const template = (
  id: string,
  item: string,
  kind: ServiceTemplate['kind'] = 'equipment',
  serviceType = 'Buffet',
  position = 0,
): ServiceTemplate => ({
  id: id as ServiceTemplateId,
  kitchenId: KITCHEN,
  serviceType,
  item,
  kind,
  position,
});

const customer = (id: string, name: string): Customer => ({
  id: id as CustomerId,
  kitchenId: KITCHEN,
  name,
  phone: null,
  email: null,
  clientGroup: null,
  notes: null,
});

const view = (
  jobs: Job[] = [job('j1')],
  recipes: Recipe[] = [recipe('lasagne', 'Lasagne')],
  templates: ServiceTemplate[] = [template('t1', '2 chafing dishes')],
  customers: Customer[] = [customer('c1', 'Nolan')],
  ticks: PackingState[] = [],
  gaps: RequirementGap[] = [],
) => buildPackingView(jobs, recipes, templates, customers, ticks, gaps);

describe('THE ONE THAT MATTERS: packing does NOT consolidate', () => {
  it('keeps two jobs needing the same dish as two separate lines', () => {
    // Shopping and Prep roll this up; packing must not. These go into different
    // boxes, into a van, to different addresses.
    const { jobs } = view([
      job('j1', { dishes: [dish('lasagne', 18)] }),
      job('j2', { dishes: [dish('lasagne', 12)] }),
    ]);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.food[0]?.portions).toBe(18);
    expect(jobs[1]?.food[0]?.portions).toBe(12);
  });

  it('never produces a line summing across jobs', () => {
    const { jobs } = view([
      job('j1', { dishes: [dish('lasagne', 18)] }),
      job('j2', { dishes: [dish('lasagne', 12)] }),
    ]);

    const everyPortion = jobs.flatMap((j) => j.food.map((f) => f.portions));
    expect(everyPortion).not.toContain(30);
  });

  it('gives each job its own tick namespace', () => {
    // Ticking the lasagne for one job must not tick it for the other.
    const ticks: PackingState[] = [
      { id: 'p1' as never, kitchenId: KITCHEN, jobId: 'j1' as JobId, itemKey: foodKey('lasagne' as RecipeId), done: true },
    ];

    const { jobs } = view(
      [job('j1', { dishes: [dish('lasagne', 18)] }), job('j2', { dishes: [dish('lasagne', 12)] })],
      undefined,
      undefined,
      undefined,
      ticks,
    );

    expect(jobs[0]?.food[0]?.done).toBe(true);
    expect(jobs[1]?.food[0]?.done).toBe(false);
  });
});

describe('the tick key is stable and namespaced', () => {
  it('keys food by recipe id, not by the label', () => {
    // A rename must not orphan the tick — it is the same dish, and he still
    // packed it.
    expect(foodKey('lasagne' as RecipeId)).toContain('lasagne');
    expect(foodKey('lasagne' as RecipeId)).toMatch(/^food:/);
  });

  it('keys equipment by template id', () => {
    expect(equipmentKey('t1' as ServiceTemplateId)).toMatch(/^equipment:/);
  });

  it('THE COLLISION IT PREVENTS: a recipe and an equipment item can share a name', () => {
    // "Chafing dish" is a plausible name for both. On a bare-label key they would
    // be one tick, and ticking the food would strike through the equipment.
    const { jobs } = view(
      [job('j1', { dishes: [dish('chafing', 4)] })],
      [recipe('chafing', 'Chafing dish')],
      [template('t1', 'Chafing dish')],
    );

    const foodK = jobs[0]!.food[0]!.itemKey;
    const equipK = jobs[0]!.equipment[0]!.itemKey;

    expect(foodK).not.toBe(equipK);
  });

  it('a tick on the food does not strike through the equipment of the same name', () => {
    const { jobs } = view(
      [job('j1', { dishes: [dish('chafing', 4)] })],
      [recipe('chafing', 'Chafing dish')],
      [template('t1', 'Chafing dish')],
      undefined,
      [{ id: 'p1' as never, kitchenId: KITCHEN, jobId: 'j1' as JobId, itemKey: foodKey('chafing' as RecipeId), done: true }],
    );

    expect(jobs[0]?.food[0]?.done).toBe(true);
    expect(jobs[0]?.equipment[0]?.done).toBe(false);
  });
});

describe('food lines', () => {
  it('shows the portions the engine derived', () => {
    const { jobs } = view();
    expect(jobs[0]?.food[0]?.portions).toBe(18);
    expect(jobs[0]?.food[0]?.label).toBe('Lasagne');
  });

  it('derives a null portions figure from the guest count, via applyBuffetSplit', () => {
    // The same single implementation Prep and Shopping use. One main, 18 guests,
    // so the dish takes the full count.
    const { jobs } = view([job('j1', { guests: 18, dishes: [dish('lasagne', null)] })]);

    expect(jobs[0]?.food[0]?.portions).toBe(18);
  });

  it('RULE 8: leaves portions UNSET rather than guessing when it cannot derive them', () => {
    // No guest count, so nothing to divide. A number here would be an invention.
    const { jobs } = view([job('j1', { guests: null, dishes: [dish('lasagne', null)] })]);

    expect(jobs[0]?.food[0]?.portions).toBeNull();
    expect(jobs[0]?.food[0]?.note).toContain('not set');
  });

  it('names a dish whose recipe is missing rather than dropping it', () => {
    // Dropping it would mean a dish silently never packed.
    const { jobs } = view([job('j1', { dishes: [dish('ghost', 5)] })], []);

    expect(jobs[0]?.food).toHaveLength(1);
    expect(jobs[0]?.food[0]?.note).toContain('recipe');
  });

  it('says so when the menu is empty', () => {
    const { jobs } = view([job('j1', { dishes: [] })]);

    expect(jobs[0]?.food).toEqual([]);
    expect(jobs[0]?.emptyMenu).toBe(true);
  });
});

describe('equipment and tasks come from the owner’s templates', () => {
  it('matches templates on the job’s service type', () => {
    const { jobs } = view([job('j1', { serviceType: 'Buffet' })], undefined, [
      template('t1', 'Chafing dishes', 'equipment', 'Buffet'),
      template('t2', 'Carving board', 'equipment', 'BBQ'),
    ]);

    expect(jobs[0]?.equipment.map((e) => e.label)).toEqual(['Chafing dishes']);
  });

  it('splits things to DO from things to PACK', () => {
    const { jobs } = view([job('j1')], undefined, [
      template('t1', 'Chafing dishes', 'equipment'),
      template('t2', 'Preheat the van', 'task'),
    ]);

    expect(jobs[0]?.equipment.map((e) => e.label)).toEqual(['Chafing dishes']);
    expect(jobs[0]?.tasks.map((t) => t.label)).toEqual(['Preheat the van']);
  });

  it('keeps the owner’s template order', () => {
    const { jobs } = view([job('j1')], undefined, [
      template('t2', 'second', 'equipment', 'Buffet', 1),
      template('t1', 'first', 'equipment', 'Buffet', 0),
    ]);

    expect(jobs[0]?.equipment.map((e) => e.label)).toEqual(['first', 'second']);
  });
});

describe('THE EMPTY-TEMPLATE TRAP', () => {
  it('distinguishes "no template written yet" from "nothing to pack"', () => {
    // Rule 1: the app ships empty, so this is the NORMAL state in week one. An
    // empty section would read as "no equipment needed", which is a different and
    // wrong statement.
    const { jobs } = view([job('j1', { serviceType: 'Buffet' })], undefined, []);

    expect(jobs[0]?.equipment).toEqual([]);
    expect(jobs[0]?.noTemplate).toBe(true);
  });

  it('is not flagged when a template for that service type does exist', () => {
    const { jobs } = view();
    expect(jobs[0]?.noTemplate).toBe(false);
  });

  it('says something different again when the job has no service type at all', () => {
    // Nothing can be matched, and the fix is on the job rather than in Setup.
    const { jobs } = view([job('j1', { serviceType: null })]);

    expect(jobs[0]?.noServiceType).toBe(true);
    expect(jobs[0]?.noTemplate).toBe(false);
  });
});

describe('job headings', () => {
  it('names the customer, the date and the service', () => {
    const { jobs } = view();
    expect(jobs[0]?.heading).toContain('Nolan');
    expect(jobs[0]?.heading).toContain('2026-08-18');
  });

  it('orders jobs by what leaves first', () => {
    const { jobs } = view([
      job('j2', { serviceDate: '2026-08-20' as IsoDate }),
      job('j1', { serviceDate: '2026-08-18' as IsoDate }),
    ]);

    expect(jobs.map((j) => j.jobId)).toEqual(['j1', 'j2']);
  });

  it('still labels a job with no customer', () => {
    const { jobs } = view([job('j1', { customerId: null })]);

    expect(jobs[0]?.heading).not.toContain('undefined');
    expect(jobs[0]?.heading.length).toBeGreaterThan(0);
  });
});

describe('gap flags — the shared vocabulary', () => {
  it('routes a missing recipe to Recipes', () => {
    const { needsFixing } = view(undefined, undefined, undefined, undefined, undefined, [
      { reason: 'missing_recipe', detail: 'no recipe found' },
    ]);

    expect(needsFixing[0]?.where).toBe('Recipes');
  });

  it('routes an unquantified component to check-yourself', () => {
    const { checkYourself } = view(undefined, undefined, undefined, undefined, undefined, [
      { reason: 'unquantified', detail: 'Tapas: "seasoning" has no quantity' },
    ]);

    expect(checkYourself).toHaveLength(1);
  });

  it('EVERY reason lands somewhere', () => {
    const all: RequirementGap['reason'][] = [
      'unquantified', 'named_unquantified', 'missing_sub_recipe', 'no_portions_per_batch',
      'no_components', 'cycle', 'missing_recipe', 'no_service_date', 'no_portions',
      'missing_ingredient', 'unresolved_conversion', 'no_pack_size',
    ];

    for (const reason of all) {
      const { checkYourself, needsFixing } = view(
        undefined, undefined, undefined, undefined, undefined,
        [{ reason, detail: 'x' }],
      );
      expect(
        checkYourself.length + needsFixing.length,
        `reason "${reason}" was routed nowhere`,
      ).toBe(1);
    }
  });
});
