/**
 * Library — Recipes and Ingredients under one tab.
 *
 * A shell, like Service: both screens stay in `src/features/setup/`, keep their
 * own files, and are rendered here. Nothing about how they load or save changes.
 *
 * The view lives in the URL (`/library/ingredients`) so it is bookmarkable and
 * so `gapRouting`'s "fix in Library → Ingredients" has somewhere exact to point.
 */

import type { ReactNode } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { Recipes } from '../setup/Recipes';
import { Ingredients } from '../setup/Ingredients';
import { Segmented, SegmentPanel, type Segment } from '../../ui/Segmented';

type View = 'recipes' | 'ingredients';

const SEGMENTS: readonly Segment<View>[] = [
  { key: 'recipes', label: 'Recipes' },
  { key: 'ingredients', label: 'Ingredients' },
];

const isView = (value: string | undefined): value is View =>
  value === 'recipes' || value === 'ingredients';

export function Library(): ReactNode {
  const { view } = useParams<{ view: string }>();
  const navigate = useNavigate();

  if (!isView(view)) return <Navigate to="/library/recipes" replace />;

  return (
    <section>
      <h1>Library</h1>
      <p className="page-sub">Your recipes and the ingredients they are built from.</p>

      <Segmented
        label="Library view"
        segments={SEGMENTS}
        active={view}
        onChange={(next) => navigate(`/library/${next}`)}
      />

      <SegmentPanel segment={view}>
        {view === 'recipes' && <Recipes />}
        {view === 'ingredients' && <Ingredients />}
      </SegmentPanel>
    </section>
  );
}
