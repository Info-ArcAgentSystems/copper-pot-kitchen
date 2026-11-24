/**
 * Saved menus — the dishes a service type usually has.
 *
 * "BBQ" on his notebook pages means his standard BBQ menu. This is where he
 * writes that menu down, from his own recipes, so a job sheet that just says
 * "B.B.Q" can be given its dishes in one tap rather than typed in every time.
 *
 * Owner-built entirely (Rule 1): there is no idea here of what a BBQ is. A menu
 * is OFFERED on a job — "Use your BBQ menu" — and never applied by itself.
 *
 * The BBQ split rule still holds downstream: meat and sides are separate
 * recipes, and the existing checks flag a BBQ with meat and no sides.
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import { menuTemplateRepository, recipeRepository } from '../../data/repositories';
import { serviceTypeKey } from '../../engine/menus';
import { ChoiceField, Field } from '../../ui/Field';
import { RecordForm, RecordScreen } from '../../ui/RecordScreen';
import { byName, parseText, requireText, textValue } from '../../ui/form';
import { useAsync } from '../../ui/useAsync';
import { SourceNotice } from '../../ui/SourceNotice';
import { sourceState, type DataSource } from '../../ui/sourceState';
import { useKitchen } from '../../auth/kitchenState';
import type { KitchenId, MenuTemplate, MenuTemplateId, Recipe, RecipeId } from '../../engine/types';

/** One menu: every saved row sharing a service type, in his order. */
interface MenuRecord {
  readonly key: string;
  readonly serviceType: string;
  readonly rows: readonly MenuTemplate[];
}

function group(rows: readonly MenuTemplate[]): MenuRecord[] {
  const byKey = new Map<string, MenuTemplate[]>();
  for (const r of rows) {
    const key = serviceTypeKey(r.serviceType);
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  return [...byKey.entries()]
    .map(([key, rs]) => {
      const sorted = [...rs].sort((a, b) => a.position - b.position);
      return { key, serviceType: sorted[0]?.serviceType ?? '', rows: sorted };
    })
    .sort((a, b) => a.serviceType.localeCompare(b.serviceType));
}

export function SavedMenus(): ReactNode {
  const db = supabaseDb();
  const repo = menuTemplateRepository(db);
  const recipes = useAsync(() => recipeRepository(db).list(), []);

  /*
   * A menu is built FROM his recipes, so a failed recipes read must say so —
   * not render an empty picker that reads as "you have no recipes yet".
   */
  const sources: readonly DataSource[] = [
    {
      what: 'your recipes',
      why: 'a menu is built from them, so none can be picked until they load',
      state: recipes.state,
      reload: recipes.reload,
    },
  ];
  const loaded = sourceState(sources);
  const ready = loaded.kind === 'ready';

  const nameOf = new Map(
    (recipes.state.status === 'ready' ? recipes.state.data : []).map((r) => [r.id as string, r.name]),
  );

  return (
    <RecordScreen<MenuRecord>
      title="Saved menus"
      why="a job sheet that just says “BBQ” can then be given your usual dishes in one tap"
      addLabel="Add a menu"
      emptyDescription="The dishes a service type usually has — your BBQ, your breakfast. Built from your own recipes, and offered on a job, never added by itself."
      load={async () => group(await repo.list())}
      keyOf={(m) => m.key}
      sheetTitle={(m) => `${m.serviceType} menu`}
      renderRow={(m) => (
        <>
          <strong>{m.serviceType}</strong>
          <span className="muted">
            {m.rows.length} dish{m.rows.length === 1 ? '' : 'es'} ·{' '}
            {m.rows.map((r) => nameOf.get(r.recipeId) ?? 'a recipe').join(', ')}
          </span>
        </>
      )}
      renderForm={(menu, done) => (
        <>
          <SourceNotice state={loaded} />
          {ready && (
            <MenuForm
              menu={menu}
              recipes={recipes.state.status === 'ready' ? recipes.state.data : []}
              done={done}
            />
          )}
        </>
      )}
    />
  );
}

function MenuForm({
  menu,
  recipes,
  done,
}: {
  menu: MenuRecord | null;
  recipes: readonly Recipe[];
  done: (said?: string) => void;
}): ReactNode {
  const { state } = useKitchen();
  const repo = menuTemplateRepository(supabaseDb());
  const kitchenId =
    state.status === 'ready' ? (state.membership.kitchenId as KitchenId) : ('' as KitchenId);

  const [serviceType, setServiceType] = useState(textValue(menu?.serviceType ?? null));
  const [dishes, setDishes] = useState<readonly string[]>(menu?.rows.map((r) => r.recipeId) ?? ['']);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const options = [
    { value: '', label: 'Pick a recipe' },
    ...[...recipes].sort(byName((r) => r.name)).map((r) => ({ value: r.id as string, label: r.name })),
  ];

  const move = (i: number, by: number): void =>
    setDishes((d) => {
      const j = i + by;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j] ?? '', next[i] ?? ''];
      return next;
    });

  const save = async (): Promise<void> => {
    const t = requireText(serviceType, 'Service type');
    setTypeError(t);
    if (t !== null) return;

    const chosen = dishes.filter((d) => d !== '');
    if (chosen.length === 0) {
      setError('Pick at least one recipe for this menu.');
      return;
    }
    if (new Set(chosen).size !== chosen.length) {
      setError('A recipe is on this menu twice — remove one.');
      return;
    }

    setSaving(true);
    setError(null);
    const type = parseText(serviceType) ?? '';
    const old = menu?.rows ?? [];

    /*
     * Written row by row, keeping what already exists: a dish already on the
     * menu is UPDATED in place, a new one is added, and only then are dropped
     * ones removed. A failure part-way leaves extra dishes, never a menu that
     * has silently lost its own.
     */
    try {
      for (const [position, recipeId] of chosen.entries()) {
        const existing = old.find((r) => r.recipeId === recipeId);
        const value: MenuTemplate = {
          id: existing?.id ?? ('' as MenuTemplateId),
          kitchenId,
          serviceType: type,
          recipeId: recipeId as RecipeId,
          position,
        };
        if (existing === undefined) await repo.create(value);
        else await repo.update(existing.id, value);
      }
      for (const r of old) {
        if (!chosen.includes(r.recipeId)) await repo.remove(r.id);
      }
      done('Saved');
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.includes('duplicate key')
          ? `There is already a ${type} menu — open that one instead.`
          : cause instanceof Error
            ? cause.message
            : 'Could not save.',
      );
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (menu === null) return;
    setSaving(true);
    try {
      for (const r of menu.rows) await repo.remove(r.id);
      done('Deleted');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete.');
      setSaving(false);
    }
  };

  return (
    <RecordForm
      saving={saving}
      error={error}
      onSave={() => void save()}
      onCancel={done}
      onDelete={menu === null ? undefined : () => void remove()}
      deleteWarningText="Delete this menu? Your recipes are kept; jobs that already have these dishes keep them."
    >
      <Field
        label="Service type"
        value={serviceType}
        onChange={setServiceType}
        required
        error={typeError}
        hint="As you write it on jobs — “BBQ”. A sheet that says “B.B.Q” or “bbq” still finds it."
      />

      <fieldset className="units">
        <legend>Dishes, in order</legend>
        {recipes.length === 0 && (
          <p className="muted">Add the dishes as recipes in the Library first, then pick them here.</p>
        )}
        {dishes.map((d, i) => (
          <div key={i} className="line">
            <ChoiceField
              label={`Dish ${i + 1}`}
              value={d}
              options={options}
              onChange={(v) => setDishes((all) => all.map((x, j) => (j === i ? v : x)))}
            />
            <div className="actions">
              <button type="button" className="sm" disabled={i === 0} onClick={() => move(i, -1)}>
                Move up
              </button>
              <button
                type="button"
                className="sm"
                disabled={i === dishes.length - 1}
                onClick={() => move(i, 1)}
              >
                Move down
              </button>
              <button
                type="button"
                className="sm"
                onClick={() => setDishes((all) => all.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setDishes((all) => [...all, ''])}>
          Add a dish
        </button>
        <p className="hint">
          For a BBQ, keep the meat and the sides as separate recipes — meat scales to meat-eaters,
          sides to everyone.
        </p>
      </fieldset>
    </RecordForm>
  );
}
