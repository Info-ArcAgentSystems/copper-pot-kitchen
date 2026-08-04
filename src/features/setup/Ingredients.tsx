/**
 * Ingredients — where Rule 4 becomes a screen.
 *
 * "Three unit systems exist and are never conflated." They are the single most
 * common source of silently wrong answers, so the form does not present one
 * "unit" box. It presents three labelled groups with the question each answers:
 *
 *   How recipes measure it   150 **g** of chicken in a recipe
 *   How you count it         4.5 **kg** on the shelf
 *   How you buy it           a 1 **kg** pack
 *
 * Collapsing those into one field is exactly the conflation the engine is built
 * to avoid, and a form that invites it would undo the type-level separation in
 * `types.ts` at the point of entry.
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import {
  ingredientRepository,
  supplierRepository,
} from '../../data/repositories';
import { ChoiceField, Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { useAsync } from '../../ui/useAsync';
import {
  byName,
  formatMoney,
  moneyValue,
  parseCount,
  parseMoney,
  parseText,
  requireText,
  textValue,
} from '../../ui/form';
import { useKitchen } from '../../auth/kitchenState';
import type {
  Ingredient,
  IngredientId,
  KitchenId,
  PurchaseUnit,
  RecipeUnit,
  StockUnit,
  SupplierId,
} from '../../engine/types';

/** Mass and volume convert on their own; anything else needs the owner's factor. */
const DIMENSIONAL = new Set(['g', 'kg', 'ml', 'l', 'cl']);

const needsFactor = (recipeUnit: string, stockUnit: string): boolean => {
  const a = recipeUnit.trim().toLowerCase();
  const b = stockUnit.trim().toLowerCase();
  if (a === '' || b === '' || a === b) return false;
  return !(DIMENSIONAL.has(a) && DIMENSIONAL.has(b));
};

export function Ingredients(): ReactNode {
  const repo = ingredientRepository(supabaseDb());

  return (
    <RecordScreen<Ingredient>
      title="Ingredients"
      addLabel="Add an ingredient"
      emptyDescription="Each ingredient carries three units: how a recipe measures it, how you count it on hand, and how you buy it."
      load={async () => (await repo.list()).sort(byName((i) => i.name))}
      keyOf={(i) => i.id}
      renderRow={(i) => (
        <>
          <strong>{i.name}</strong>
          <span className="muted num">
            {[
              i.recipeUnit === null ? null : `recipe ${i.recipeUnit}`,
              `stock ${i.stockUnit}`,
              i.pack === null
                ? 'no pack size'
                : `${i.pack.size} ${i.pack.unit} pack${i.pack.assumed ? ' (assumed)' : ''}`,
              formatMoney(i.pricePerPack, 'unpriced'),
            ]
              .filter((x) => x !== null)
              .join(' · ')}
          </span>
        </>
      )}
      renderForm={(ingredient, done) => (
        <IngredientForm ingredient={ingredient} done={done} />
      )}
    />
  );
}

function IngredientForm({
  ingredient,
  done,
}: {
  ingredient: Ingredient | null;
  done: () => void;
}): ReactNode {
  const { state } = useKitchen();
  const db = supabaseDb();
  const repo = ingredientRepository(db);
  const suppliers = useAsync(() => supplierRepository(db).list(), []);

  const [name, setName] = useState(textValue(ingredient?.name ?? null));
  const [category, setCategory] = useState(textValue(ingredient?.category ?? null));

  const [recipeUnit, setRecipeUnit] = useState(textValue(ingredient?.recipeUnit ?? null));
  const [stockUnit, setStockUnit] = useState(textValue(ingredient?.stockUnit ?? null));
  const [factor, setFactor] = useState(
    ingredient?.recipeUnitsPerStockUnit === null || ingredient === null
      ? ''
      : String(ingredient.recipeUnitsPerStockUnit),
  );

  const [packSize, setPackSize] = useState(
    ingredient?.pack === null || ingredient === undefined || ingredient === null
      ? ''
      : String(ingredient.pack.size),
  );
  const [packUnit, setPackUnit] = useState(textValue(ingredient?.pack?.unit ?? null));
  // Defaults to assumed on a new ingredient: nothing is confirmed until he says so.
  const [packAssumed, setPackAssumed] = useState(ingredient?.pack?.assumed ?? true);

  const [supplierId, setSupplierId] = useState(ingredient?.supplierId ?? '');
  const [price, setPrice] = useState(moneyValue(ingredient?.pricePerPack ?? null));
  const [allergens, setAllergens] = useState((ingredient?.allergens ?? []).join(', '));

  const [nameError, setNameError] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const priceParse = parseMoney(price);
  const factorRequired = needsFactor(recipeUnit, stockUnit);

  const kitchenId =
    state.status === 'ready' ? (state.membership.kitchenId as KitchenId) : ('' as KitchenId);

  const save = async (): Promise<void> => {
    const n = requireText(name, 'Name');
    const s = requireText(stockUnit, 'Stock unit');
    setNameError(n);
    setStockError(s);
    if (n !== null || s !== null || priceParse.error !== null) return;

    setSaving(true);
    setError(null);

    const size = parseCount(packSize).value;
    const value: Ingredient = {
      id: ingredient?.id ?? ('' as IngredientId),
      kitchenId,
      name: parseText(name) ?? '',
      category: parseText(category),
      stockUnit: (parseText(stockUnit) ?? '') as StockUnit,
      recipeUnit: parseText(recipeUnit) as RecipeUnit | null,
      // Blank stays null. `units.ts` then REFUSES a non-dimensional conversion
      // rather than assuming a factor of 1 — which is the whole point.
      recipeUnitsPerStockUnit: factor.trim() === '' ? null : Number(factor),
      // A pack needs both a size and a unit. Half of one is not a pack.
      pack:
        size === null || parseText(packUnit) === null
          ? null
          : {
              size,
              unit: (parseText(packUnit) ?? '') as PurchaseUnit,
              assumed: packAssumed,
            },
      supplierId: supplierId === '' ? null : (supplierId as SupplierId),
      pricePerPack: priceParse.cents,
      previousPrice: ingredient?.previousPrice ?? null,
      priceChecked: ingredient?.priceChecked ?? null,
      allergens: allergens
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a !== ''),
    };

    try {
      if (ingredient === null) await repo.create(value);
      else await repo.update(ingredient.id, value);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (ingredient === null) return;
    setSaving(true);
    try {
      await repo.remove(ingredient.id);
      done();
    } catch (cause) {
      // `recipe_ingredients.ingredient_id` is `on delete restrict`, so the
      // database REFUSES this rather than silently orphaning a recipe line.
      setError(
        cause instanceof Error && cause.message.includes('violates foreign key')
          ? 'A recipe uses this ingredient, so it cannot be deleted. Remove it from the recipe first.'
          : cause instanceof Error
            ? cause.message
            : 'Could not delete.',
      );
      setSaving(false);
    }
  };

  const supplierOptions = [
    { value: '', label: 'No supplier' },
    ...(suppliers.state.status === 'ready'
      ? suppliers.state.data.map((s) => ({ value: s.id as string, label: s.name }))
      : []),
  ];

  return (
    <RecordForm
      saving={saving}
      error={error}
      onSave={() => void save()}
      onCancel={done}
      onDelete={ingredient === null ? undefined : () => void remove()}
      deleteWarningText="Delete this ingredient? If a recipe uses it, the database will refuse and you will need to remove it from the recipe first."
    >
      <Field label="Name" value={name} onChange={setName} required error={nameError} />
      <Field label="Category" value={category} onChange={setCategory} />

      {/* Rule 4 — three groups, three questions, never one "unit" box. */}
      <fieldset className="units">
        <legend>How recipes measure it</legend>
        <Field
          label="Recipe unit"
          value={recipeUnit}
          onChange={setRecipeUnit}
          hint="What a recipe line says: g, ml, each."
        />
      </fieldset>

      <fieldset className="units">
        <legend>How you count it</legend>
        <Field
          label="Stock unit"
          value={stockUnit}
          onChange={setStockUnit}
          required
          error={stockError}
          hint="What you count on the shelf: kg, L, each, jar."
        />
        {factorRequired && (
          <Field
            label={`How many ${recipeUnit} in one ${stockUnit}`}
            value={factor}
            onChange={setFactor}
            inputMode="decimal"
            numeric
            hint={`${recipeUnit} and ${stockUnit} do not convert on their own — g to kg does, "each" to kg does not. Leave blank and quantities using this ingredient stay unresolved rather than being guessed.`}
          />
        )}
      </fieldset>

      <fieldset className="units">
        <legend>How you buy it</legend>
        <Field
          label="Pack size"
          value={packSize}
          onChange={setPackSize}
          inputMode="decimal"
          numeric
          hint="How much is in one pack."
        />
        <Field label="Pack unit" value={packUnit} onChange={setPackUnit} />

        {/* Shown until confirmed. An assumed pack size trusted silently is a
            wrong shopping quantity. */}
        {packAssumed ? (
          <div className="unresolved-row">
            <p className="unresolved">Assumed — not confirmed against a real pack</p>
            <button type="button" onClick={() => setPackAssumed(false)}>
              I have checked this pack size
            </button>
          </div>
        ) : (
          <p className="muted">
            Confirmed.{' '}
            <button type="button" className="link" onClick={() => setPackAssumed(true)}>
              Mark as assumed again
            </button>
          </p>
        )}
      </fieldset>

      <ChoiceField
        label="Supplier"
        value={supplierId}
        options={supplierOptions}
        onChange={setSupplierId}
      />
      <Field
        label="Price per pack"
        value={price}
        onChange={setPrice}
        inputMode="decimal"
        numeric
        error={priceParse.error}
        hint="Leave blank if you have not priced it. Blank is not zero — an unpriced ingredient makes the whole food cost blank rather than wrong."
      />
      <Field
        label="Allergens"
        value={allergens}
        onChange={setAllergens}
        hint="Comma separated, in your own words. Nothing is assumed about what counts as an allergen."
      />
    </RecordForm>
  );
}
