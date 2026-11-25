/**
 * "Save these dishes as your BBQ menu" — one tap from a job he has just built.
 *
 * Saved menus come from his own jobs, so a scanned or typed job is how the
 * standard gets made: no Setup screen, no typing the dishes twice. What to offer
 * is decided by `menuToSave` (engine, tested); this only writes it.
 *
 * His tap is the confirmation. It never runs by itself, and it never replaces a
 * menu he already has — `menuToSave` offers nothing once one exists.
 *
 * Written dish by dish. A failure part-way says how many made it and where to
 * finish, rather than leaving a short menu that looks complete.
 */

import { useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import { menuTemplateRepository } from '../../data/repositories';
import type { SavedMenu } from '../../engine/menus';
import type { KitchenId, MenuTemplateId } from '../../engine/types';

export function SaveAsMenu({
  menu,
  kitchenId,
  onSaved,
}: {
  readonly menu: SavedMenu;
  readonly kitchenId: KitchenId;
  /** Told what happened, so the screen can keep saying it after the offer goes. */
  readonly onSaved: (said: string) => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = menu.recipeIds.length;
  const dishes = `${count} dish${count === 1 ? '' : 'es'}`;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const repo = menuTemplateRepository(supabaseDb());
    let written = 0;
    try {
      for (const [position, recipeId] of menu.recipeIds.entries()) {
        await repo.create({
          id: '' as MenuTemplateId,
          kitchenId,
          serviceType: menu.serviceType,
          recipeId,
          position,
        });
        written += 1;
      }
      onSaved(
        `Saved as your ${menu.serviceType} menu. Every ${menu.serviceType} job will offer ${count === 1 ? 'this dish' : `these ${dishes}`}.`,
      );
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : 'it could not be saved';
      setError(
        written === 0
          ? `The menu was not saved — ${why}.`
          : `Only ${written} of ${count} dishes were saved (${why}). Finish it in Setup → Saved menus.`,
      );
      if (written > 0) onSaved(`Part of your ${menu.serviceType} menu was saved — check it in Setup → Saved menus.`);
    }
    setBusy(false);
  };

  return (
    <div className="save-as-menu">
      <p className="muted">
        You have no {menu.serviceType} menu yet. Save {count === 1 ? 'this dish' : `these ${dishes}`} as
        your {menu.serviceType} menu, and every {menu.serviceType} job will offer{' '}
        {count === 1 ? 'it' : 'them'} with one tap.
      </p>
      <button type="button" disabled={busy || kitchenId === ''} onClick={() => void save()}>
        {busy ? 'Saving…' : `Save as your ${menu.serviceType} menu`}
      </button>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
