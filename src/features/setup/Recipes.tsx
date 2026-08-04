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
import { supabaseDb } from '../../data/client';
import { ingredientRepository, recipeRepository } from '../../data/repositories';
import { ChoiceField, Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { useAsync } from '../../ui/useAsync';
import { byName, parseCount, parseText, requireText, textValue } from '../../ui/form';
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

  return (
    <RecordScreen<Recipe>
      title="Recipes"
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
  const db = supabaseDb();
  const repo = recipeRepository(db);
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const recipes = useAsync(() => repo.list(), []);

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
      <Field label="Name" value={name} onChange={setName} required error={nameError} />
      <ChoiceField label="Course" value={course} options={COURSES} onChange={setCourse} />

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
              type="button"
              onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
            >
              Remove this component
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setLines((all) => [
              ...all,
              { key: newKey(), kind: 'ingredient', target: '', displayName: '', qty: '', unit: '' },
            ])
          }
        >
          Add a component
        </button>
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
