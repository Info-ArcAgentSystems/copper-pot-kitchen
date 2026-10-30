/**
 * Recipes.
 *
 * The only screen that edits an aggregate: a header plus component lines plus
 * unquantified items, saved through the `save_recipe` RPC so all three land in
 * one transaction.
 *
 * Two rules are structural here rather than advisory:
 *
 *   Rule 13 — a component quantity is ONE number. There is no min/max pair on
 *   this form and there will not be one.
 *
 *   Rule 8 — an unquantified component has NO quantity field at all. Not a blank
 *   input: the control does not exist, so a zero cannot be typed into it.
 */

import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabaseDb } from '../../data/client';
import { ingredientRepository, recipeRepository } from '../../data/repositories';
import { ChoiceField, Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { SourceNotice } from '../../ui/SourceNotice';
import { sourceState, type DataSource } from '../../ui/sourceState';
import { useAsync } from '../../ui/useAsync';
import { findRecipes } from '../../scan/findRecipes';
import { fillStub, reviewWebRecipe, type WebRecipeReview } from '../../scan/webRecipe';
import { WebCandidates } from '../scan/WebCandidates';
import { supabaseClient } from '../../data/client';
import { byName, parseCount, parseText, requireText, textValue } from '../../ui/form';
import { courseDerivable } from '../../engine/rules';
import { useKitchen } from '../../auth/kitchenState';
import type {
  Course,
  IngredientId,
  KitchenId,
  Recipe,
  RecipeComponent,
  RecipeConfidence,
  RecipeId,
  RecipeLineId,
  RecipeUnit,
  RecipeUnquantified,
  YieldType,
} from '../../engine/types';

const COURSES = [
  { value: '', label: 'No course' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'main', label: 'Main' },
  { value: 'side', label: 'Side' },
  { value: 'dessert', label: 'Dessert' },
];

/**
 * What THIS choice will do, shown only when the choice is consequential.
 *
 * A main, a side or a dessert says nothing: a hint that fires on the normal case
 * is one the owner learns to scroll past, and then misses on the day it matters.
 * Rule 12 wants the need for a figure obvious AT THE POINT OF USE — which means
 * when the selection actually costs him something, not permanently.
 *
 * `courseDerivable` is asked rather than testing for `''`, so breakfast — which
 * fails in exactly the same way — is covered without being listed here. A second
 * copy of {main, side, dessert} in this file is how the form would start
 * disagreeing with the engine.
 */
function courseHint(course: string): string | undefined {
  if (courseDerivable(course === '' ? null : course)) return undefined;

  const consequence =
    'the guest count cannot fill in portions, so every job using this recipe needs a portions figure typed in — otherwise the dish is left off prep, shopping and cost.';

  return course === ''
    ? `Without a course, ${consequence}`
    : `Breakfast is a choice rather than an even split, so ${consequence}`;
}

const YIELDS = [
  { value: 'per_person', label: 'Per person' },
  { value: 'batch', label: 'Batch (trays, cakes)' },
];

const CONFIDENCE = [
  { value: 'locked', label: 'Locked — quantities are right' },
  { value: 'confirm', label: 'Confirm — needs checking' },
  { value: 'missing', label: 'Missing — quantities unknown' },
];

export function Recipes(): ReactNode {
  const repo = recipeRepository(supabaseDb());
  const location = useLocation();
  const navigate = useNavigate();

  /*
   * A DRAFT ARRIVING FROM A WEB SEARCH — from the menu scanner, or from this
   * screen's own "find it online".
   *
   * Carried in router state rather than saved anywhere: a web recipe is someone
   * else's portions, and it must not reach shopping, prep or cost before he has
   * looked at it. `confidence` cannot enforce that — nothing in the engine reads
   * it — so the guarantee is that no row exists until he presses save here.
   *
   * The cost is honest: navigating away loses the draft. That is the same trade
   * the Ask Sous proposal makes, and for the same reason.
   *
   * THE DRAFT ARRIVES AT `/library/recipes`, NEVER AT `/recipes`. `/recipes` is
   * a bookmark redirect now (271f179), and a redirect REPLACES the location:
   * `<Navigate>` passes no state, so react-router calls `createLocation(…, to,
   * undefined)` and the default `= null` takes over. The draft is destroyed in
   * transit, this reads null, and the list renders instead of the editor — which
   * is exactly what happened to every web import between 27 October and now.
   * See `tests/ui/navigation.test.ts`.
   */
  const draft = (location.state as { draft?: Recipe } | null)?.draft ?? null;

  if (draft !== null) {
    return (
      <RecipeForm
        recipe={draft}
        done={() => navigate('/library/recipes', { replace: true, state: null })}
      />
    );
  }

  return (
    <>
    <RecordScreen<Recipe>
      title="Recipes"
      /* Library draws the title and names the view. See `inShell`. */
      inShell
      why="the menu is built from them, and prep quantities and shopping are scaled from them"
      addLabel="Add a recipe"
      emptyDescription="Recipes scale to the portions a job needs. Per-person recipes scale linearly; batch recipes round up to whole trays."
      load={async () => (await repo.list()).sort(byName((r) => r.name))}
      keyOf={(r) => r.id}
      renderRow={(r) => (
        <>
          <strong>{r.name}</strong>
          <span className="muted num">
            {[
              r.course ?? 'no course',
              r.yieldType === 'batch'
                ? `${r.portionsPerBatch ?? '?'} per ${r.batchUnit ?? 'batch'}`
                : 'per person',
              `${r.components.length} component${r.components.length === 1 ? '' : 's'}`,
              r.unquantified.length > 0 ? `${r.unquantified.length} unquantified` : null,
            ]
              .filter((x) => x !== null)
              .join(' · ')}
          </span>
          {/* Confidence on the row, not buried in the form: this is how he sees
              at a glance which recipes he does not yet trust. */}
          {r.confidence !== 'locked' && (
            <span className="unresolved">
              {r.confidence === 'missing' ? 'quantities missing' : 'needs confirming'}
            </span>
          )}
        </>
      )}
      renderForm={(recipe, done) => <RecipeForm recipe={recipe} done={done} />}
    />
    </>
  );
}

interface LineDraft {
  readonly key: string;
  kind: 'ingredient' | 'sub_recipe';
  target: string;
  displayName: string;
  qty: string;
  unit: string;
}

let seq = 0;
const newKey = (): string => `l${(seq += 1)}`;

function RecipeForm({ recipe, done }: { recipe: Recipe | null; done: () => void }): ReactNode {
  const { state } = useKitchen();
  const navigate = useNavigate();
  const db = supabaseDb();
  const repo = recipeRepository(db);
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const recipes = useAsync(() => repo.list(), []);

  /*
   * Both reads feed dropdowns that fall back to `[]`, which is why their `why`
   * clauses name the LINE rather than the list. An empty "Choose an
   * ingredient" is not a dropdown he can work around — he saves a recipe with
   * no components, and that costs null while still showing a production bucket.
   */
  const sources: readonly DataSource[] = [
    {
      what: 'your ingredients',
      why: 'the lines of a recipe are chosen from them, and without them none can be added',
      state: ingredients.state,
      reload: ingredients.reload,
    },
    {
      what: 'your other recipes',
      why: 'a recipe can contain one of them as a sub-recipe',
      state: recipes.state,
      reload: recipes.reload,
    },
  ];

  const [name, setName] = useState(textValue(recipe?.name ?? null));
  const [course, setCourse] = useState<string>(recipe?.course ?? '');
  const [yieldType, setYieldType] = useState<string>(recipe?.yieldType ?? 'per_person');
  const [portionsPerBatch, setPortionsPerBatch] = useState(
    recipe?.portionsPerBatch === null || recipe === null ? '' : String(recipe.portionsPerBatch),
  );
  const [batchUnit, setBatchUnit] = useState(textValue(recipe?.batchUnit ?? null));
  const [confidence, setConfidence] = useState<string>(recipe?.confidence ?? 'confirm');
  const [makeAhead, setMakeAhead] = useState(String(recipe?.makeAheadDays ?? 0));
  const [sameDayOnly, setSameDayOnly] = useState(recipe?.sameDayOnly ?? true);
  const [method, setMethod] = useState(textValue(recipe?.method ?? null));
  const [note, setNote] = useState(textValue(recipe?.note ?? null));

  /*
   * FINDING A STUB'S INGREDIENTS ONLINE.
   *
   * A stub is a recipe that is a name and nothing else — usually one created
   * when a scanned job sheet named a dish with no recipe behind it. Until it
   * has ingredients it cannot be costed or shopped, and the prep sheet marks
   * the line as such. This is the shortest route from that state to a real
   * recipe, and it is the same search `ScanMenu` uses, asked by name.
   *
   * Nothing here writes. A pick builds a filled DRAFT and opens it in this same
   * editor for him to confirm — the identity stays the stub's, so saving
   * updates rather than inserting (`fillStub`).
   */
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<readonly WebRecipeReview[]>([]);
  const [refusedCount, setRefusedCount] = useState(0);
  /** Sources already offered, so "show me others" does not repeat itself. */
  const [seen, setSeen] = useState<readonly string[]>([]);

  const [lines, setLines] = useState<LineDraft[]>(
    (recipe?.components ?? []).map((c) => ({
      key: newKey(),
      kind: c.kind,
      target: c.kind === 'ingredient' ? c.ingredientId : c.subRecipeId,
      displayName: c.displayName,
      qty: c.qty === null ? '' : String(c.qty),
      unit: c.unit ?? '',
    })),
  );
  const [unquantified, setUnquantified] = useState<{ key: string; item: string; reason: string }[]>(
    (recipe?.unquantified ?? []).map((u) => ({
      key: newKey(),
      item: u.item,
      reason: u.reason ?? '',
    })),
  );

  const [nameError, setNameError] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const kitchenId =
    state.status === 'ready' ? (state.membership.kitchenId as KitchenId) : ('' as KitchenId);

  const isBatch = yieldType === 'batch';

  const save = async (): Promise<void> => {
    const n = requireText(name, 'Name');
    // A batch recipe with no batch size cannot be scaled AT ALL — portionsToUnits
    // returns null and every quantity becomes a gap. Better to refuse here.
    const b =
      isBatch && parseCount(portionsPerBatch).value === null
        ? 'A batch recipe needs its portions per batch, or it cannot be scaled'
        : null;
    setNameError(n);
    setBatchError(b);
    if (n !== null || b !== null) return;

    setSaving(true);
    setError(null);

    const components: RecipeComponent[] = lines
      .filter((l) => l.target !== '')
      .map((l) => {
        const base = {
          id: '' as RecipeLineId,
          displayName: l.displayName === '' ? l.target : l.displayName,
          position: 0,
          qty: l.qty.trim() === '' ? null : Number(l.qty),
          unit: parseText(l.unit) as RecipeUnit | null,
        };
        return l.kind === 'ingredient'
          ? { ...base, kind: 'ingredient' as const, ingredientId: l.target as IngredientId }
          : { ...base, kind: 'sub_recipe' as const, subRecipeId: l.target as RecipeId };
      });

    const value: Recipe = {
      id: recipe?.id ?? ('' as RecipeId),
      kitchenId,
      name: parseText(name) ?? '',
      course: course === '' ? null : (course as Course),
      yieldType: yieldType as YieldType,
      portionsPerBatch: isBatch ? parseCount(portionsPerBatch).value : null,
      batchUnit: isBatch ? parseText(batchUnit) : null,
      confidence: confidence as RecipeConfidence,
      makeAheadDays: parseCount(makeAhead).value ?? 0,
      sameDayOnly,
      freezable: recipe?.freezable ?? false,
      onsiteFinish: recipe?.onsiteFinish ?? false,
      method: parseText(method),
      note: parseText(note),
      components,
      unquantified: unquantified
        .filter((u) => u.item.trim() !== '')
        .map((u) => ({
          id: '' as RecipeLineId,
          item: u.item.trim(),
          reason: parseText(u.reason),
        })) as RecipeUnquantified[],
    };

    try {
      await repo.save(value);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (recipe === null) return;
    setSaving(true);
    try {
      await repo.remove(recipe.id);
      done();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.includes('violates foreign key')
          ? 'Another recipe uses this one as a sub-recipe, or a job has it on its menu. Remove it there first.'
          : cause instanceof Error
            ? cause.message
            : 'Could not delete.',
      );
      setSaving(false);
    }
  };

  /*
   * THE STUB THIS ACTION IS FOR, captured once rather than re-asked.
   *
   * `recipe.components.length === 0` is the stub condition the rest of the app
   * uses. `lines.length === 0` is the second half: if he has started typing
   * components here, filling from a page would replace what he wrote — and
   * "fill" is the wrong word for that. A recipe with no name has nothing to
   * search for.
   *
   * Bound as a value so the non-null narrowing survives into the pick
   * callback, which is nested far enough that TypeScript cannot carry it.
   */
  const stub =
    recipe !== null && recipe.components.length === 0 && lines.length === 0 && name.trim() !== ''
      ? recipe
      : null;

  /** Ask the same search `ScanMenu` uses, by this recipe's name. */
  const findOnline = async (): Promise<void> => {
    /*
     * RULE 8, AND THE REASON THIS GUARD IS FIRST.
     *
     * Everything below matches the page's ingredients against HIS, and a failed
     * or still-loading read used to fall back to `[]`. Nothing errored: every
     * ingredient simply failed to match and came back as unquantified, which is
     * character-for-character what the screen shows when none of them are in his
     * library. A broken read, rendered as a legitimate absence — the exact
     * substitution Rule 8 forbids, and the one the rest of this app guards.
     *
     * It is checked here rather than by disabling the button because the button
     * is where he would look for the reason, and a disabled control gives none.
     */
    if (ingredients.state.status !== 'ready') {
      setFindError(
        ingredients.state.status === 'error'
          ? 'Your ingredients could not be loaded, and an import is matched against them. Everything would come back with no quantity, which looks exactly like none of them being in your library. Try again once that read works.'
          : 'Still loading your ingredients. An import is matched against them, so give it a moment and try again.',
      );
      return;
    }

    setFinding(true);
    setFindError(null);

    const reply = await findRecipes(name.trim(), seen, {
      url: `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1/find-recipes`,
      token: (await supabaseClient().auth.getSession()).data.session?.access_token ?? '',
    });

    setFinding(false);

    if (reply.kind === 'unresolved') {
      // The function's own words, passed through. "The key is not set" must not
      // become "no recipes found", and a timeout must not either.
      setFindError(reply.reason);
      return;
    }

    /*
     * Reviewed HERE, against his own ingredients, by the same matcher every
     * other import uses. The search function resolved nothing — it reported
     * what a page said.
     *
     * A candidate with no source is refused outright and counted rather than
     * shown: there is nothing to judge it by, and provenance is the whole basis
     * on which he is being asked to trust any of this.
     */
    const owner = { ingredients: ingredients.state.data };
    const outcomes = reply.candidates.map((c) => reviewWebRecipe(c, owner));
    const kept = outcomes.flatMap((o) => (o.kind === 'reviewed' ? [o.review] : []));

    setCandidates(kept);
    setRefusedCount(outcomes.length - kept.length);
    setSeen((prior) => [...prior, ...kept.map((k) => k.sourceUrl)]);

    /*
     * A SEARCH THAT FOUND NOTHING SAYS SO.
     *
     * `setCandidates([])` renders nothing at all and the button goes back to
     * reading "Find it online" — identical to never having pressed it. Twenty
     * seconds of waiting, and then the screen looks like the tap missed.
     *
     * The three endings are different facts and are worded as three:
     * nothing came back, things came back but none could be checked, or he has
     * already been shown everything the search can find for this name.
     */
    if (kept.length === 0) {
      const refused = outcomes.length - kept.length;
      setFindError(
        refused > 0
          ? `Found ${refused} page${refused === 1 ? '' : 's'}, but ${refused === 1 ? 'it came' : 'they came'} back with no source link, so there is nothing to check ${refused === 1 ? 'it' : 'them'} against. Try again.`
          : seen.length > 0
            ? 'Nothing new this time — you have already seen what the search can find for this name. Try a different name.'
            : 'Found nothing for that name. Try a different wording, or add the components yourself.',
      );
    }
  };

  const targetOptions = (kind: LineDraft['kind']) =>
    kind === 'ingredient'
      ? [
          { value: '', label: 'Choose an ingredient' },
          ...(ingredients.state.status === 'ready'
            ? ingredients.state.data.map((i) => ({ value: i.id as string, label: i.name }))
            : []),
        ]
      : [
          { value: '', label: 'Choose a recipe' },
          ...(recipes.state.status === 'ready'
            ? recipes.state.data
                .filter((r) => r.id !== recipe?.id)
                .map((r) => ({ value: r.id as string, label: r.name }))
            : []),
        ];

  const patchLine = (key: string, patch: Partial<LineDraft>): void =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <RecordForm
      saving={saving}
      error={error}
      onSave={() => void save()}
      onCancel={done}
      onDelete={recipe === null ? undefined : () => void remove()}
      deleteWarningText="Delete this recipe? If another recipe uses it as a sub-recipe, or a job has it on the menu, the database will refuse."
    >
      {/* Above the fields, because the consequence lands at the Lines section
          below and an empty dropdown there says nothing for itself. Inline, no
          title: `RecordScreen` has already put the heading on. */}
      <SourceNotice state={sourceState(sources)} />

      <Field label="Name" value={name} onChange={setName} required error={nameError} />
      <ChoiceField
        label="Course"
        value={course}
        options={COURSES}
        onChange={setCourse}
        hint={courseHint(course)}
      />

      <ChoiceField label="Yield" value={yieldType} options={YIELDS} onChange={setYieldType} />
      {isBatch && (
        <>
          <Field
            label="Portions per batch"
            value={portionsPerBatch}
            onChange={setPortionsPerBatch}
            required
            error={batchError}
            inputMode="numeric"
            numeric
            hint="9 portions per tray means 29 portions is 4 trays, not 3.2."
          />
          <Field
            label="Batch unit"
            value={batchUnit}
            onChange={setBatchUnit}
            hint="tray, batch, cake."
          />
        </>
      )}

      <ChoiceField
        label="Confidence"
        value={confidence}
        options={CONFIDENCE}
        onChange={setConfidence}
      />

      <Field
        label="Make-ahead days"
        value={makeAhead}
        onChange={setMakeAhead}
        inputMode="numeric"
        numeric
        hint="Prep date is the service date minus this."
      />
      <label className="check">
        <input
          type="checkbox"
          checked={sameDayOnly}
          onChange={(e) => setSameDayOnly(e.target.checked)}
        />
        Same day only — overrides make-ahead days, because it is the harder constraint
      </label>

      {/* --- components ------------------------------------------------- */}
      <fieldset className="units">
        <legend>Components</legend>
        {lines.length === 0 && <p className="muted">No components yet.</p>}

        {lines.map((line) => (
          <div key={line.key} className="line">
            <ChoiceField
              label="Type"
              value={line.kind}
              options={[
                { value: 'ingredient', label: 'Ingredient' },
                { value: 'sub_recipe', label: 'Sub-recipe' },
              ]}
              onChange={(v) =>
                // An ingredient OR a sub-recipe, never both — the schema's XOR
                // check. Changing type clears the target so a stale id cannot
                // land in the wrong column.
                patchLine(line.key, { kind: v as LineDraft['kind'], target: '' })
              }
            />
            <ChoiceField
              label={line.kind === 'ingredient' ? 'Ingredient' : 'Sub-recipe'}
              value={line.target}
              options={targetOptions(line.kind)}
              onChange={(v) => {
                const found = targetOptions(line.kind).find((o) => o.value === v);
                patchLine(line.key, { target: v, displayName: found?.label ?? '' });
              }}
            />
            <Field
              label={line.kind === 'ingredient' ? 'Quantity' : 'Portions of it'}
              value={line.qty}
              onChange={(v) => patchLine(line.key, { qty: v })}
              inputMode="decimal"
              numeric
              hint={
                line.kind === 'sub_recipe'
                  ? 'How many portions of the sub-recipe, per portion or batch of this one.'
                  : undefined
              }
            />
            {line.kind === 'ingredient' && (
              <Field
                label="Unit"
                value={line.unit}
                onChange={(v) => patchLine(line.key, { unit: v })}
              />
            )}
            <button
              className="sm"
              type="button"
              onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
            >
              Remove this component
            </button>
          </div>
        ))}

        <div className="actions">
          <button
            type="button"
            onClick={() =>
              setLines((all) => [
                ...all,
                {
                  key: newKey(),
                  kind: 'ingredient',
                  target: '',
                  displayName: '',
                  qty: '',
                  unit: '',
                },
              ])
            }
          >
            Add a component
          </button>

          {stub !== null && (
            <button type="button" disabled={finding} onClick={() => void findOnline()}>
              {finding ? 'Searching…' : candidates.length === 0 ? 'Find it online' : 'Show me others'}
            </button>
          )}
        </div>

        {findError !== null && (
          <p className="error" role="alert">
            {findError}
          </p>
        )}

        {stub !== null && candidates.length > 0 && (
          <>
            <p className="hint muted">
              Nothing is saved. Picking one opens it here, filled in, for you to check against
              your own portions first — the quantities below are the page's, not yours.
            </p>

            {/* The same renderer `ScanMenu` uses. What picking MEANS differs:
                there it opens a NEW recipe, here it fills THIS one — which is
                why the draft carries this recipe's id.

                The LIVE route, not `/recipes`: a redirect would strip the draft
                off the location and drop us on the list. */}
            <WebCandidates
              candidates={candidates}
              refused={refusedCount}
              pickLabel="Fill this recipe"
              onPick={(candidate) =>
                navigate('/library/recipes', { state: { draft: fillStub(stub, candidate) } })
              }
            />
          </>
        )}
      </fieldset>

      {/* --- unquantified ----------------------------------------------- */}
      <fieldset className="units">
        <legend>Unquantified components</legend>
        <p className="muted">
          Named things with no measured amount. They appear on the shopping list as “check this
          yourself”, never as a number. <strong>There is deliberately no quantity box here</strong>
          — a zero would look like a real answer.
        </p>

        {unquantified.map((u) => (
          <div key={u.key} className="line">
            <Field
              label="Item"
              value={u.item}
              onChange={(v) =>
                setUnquantified((all) =>
                  all.map((x) => (x.key === u.key ? { ...x, item: v } : x)),
                )
              }
            />
            <Field
              label="Why it has no quantity"
              value={u.reason}
              onChange={(v) =>
                setUnquantified((all) =>
                  all.map((x) => (x.key === u.key ? { ...x, reason: v } : x)),
                )
              }
            />
            <button
              className="sm"
              type="button"
              onClick={() => setUnquantified((all) => all.filter((x) => x.key !== u.key))}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setUnquantified((all) => [...all, { key: newKey(), item: '', reason: '' }])
          }
        >
          Add an unquantified item
        </button>
      </fieldset>

      <Field label="Method" value={method} onChange={setMethod} multiline />
      <Field label="Note" value={note} onChange={setNote} multiline />
    </RecordForm>
  );
}
