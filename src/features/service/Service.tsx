/**
 * Service — Shopping, Prep and Packing under one tab, sharing one window.
 *
 * A SHELL, NOT A MOVE. The three screens stay exactly where they live, keep
 * their own files and their own tick repositories, and are rendered here as
 * children. `tests/ui/derived.test.ts` enforces Rule 6 by reading
 * `src/features/{shopping,prep,packing}/` by name — restructuring those
 * directories would have meant rewriting the one guard that stops a derived list
 * being stored, so nothing was restructured.
 *
 * THE WINDOW IS SHARED; ITS MEANING IS NOT. All three read the same two dates
 * and then filter on different fields — Shopping and Packing on the service
 * date, Prep on the prep date, which is the service date minus make-ahead days.
 * That is correct and pre-existing. The caption under the dates therefore says
 * what the window means on the view you are looking at, rather than claiming one
 * range drives all three: a job serving on the 6th with three make-ahead days
 * belongs in a 27th–3rd Prep window and not in the same Shopping window, and
 * unexplained that reads as a bug.
 *
 * The view lives in the URL (`/service/prep`) so it can be bookmarked and the
 * back button works, and so the old `/prep` link can redirect somewhere exact.
 */

import type { ReactNode } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { Shopping } from '../shopping/Shopping';
import { Prep } from '../prep/Prep';
import { Packing } from '../packing/Packing';
import { Segmented, SegmentPanel, type Segment } from '../../ui/Segmented';
import { Field } from '../../ui/Field';
import { RANGE_CAPTION, useDateRange } from '../../ui/dateRange';

type View = 'shopping' | 'prep' | 'packing';

const SEGMENTS: readonly Segment<View>[] = [
  { key: 'shopping', label: 'Shopping', shortLabel: 'Shop' },
  { key: 'prep', label: 'Prep', shortLabel: 'Prep' },
  { key: 'packing', label: 'Packing', shortLabel: 'Pack' },
];

const isView = (value: string | undefined): value is View =>
  value === 'shopping' || value === 'prep' || value === 'packing';

export function Service(): ReactNode {
  const { view } = useParams<{ view: string }>();
  const navigate = useNavigate();

  // An unknown segment in the URL is redirected rather than defaulted silently,
  // so a typo'd bookmark lands somewhere real with the address bar agreeing.
  if (!isView(view)) return <Navigate to="/service/shopping" replace />;

  return <ServiceView view={view} onView={(next) => navigate(`/service/${next}`)} />;
}

/**
 * Split out so the range hook runs below the redirect guard — a hook cannot sit
 * after a conditional return.
 */
function ServiceView({ view, onView }: { view: View; onView: (v: View) => void }): ReactNode {
  const range = useDateRange();

  return (
    <section>
      <h1>Service</h1>

      <Segmented label="Service view" segments={SEGMENTS} active={view} onChange={onView} />

      <fieldset className="units">
        <legend>Which dates</legend>
        <div className="date-pair">
          <Field label="From" value={range.from} onChange={range.setFrom} type="date" />
          <Field label="To" value={range.to} onChange={range.setTo} type="date" />
        </div>
        <p className="hint muted">{RANGE_CAPTION[view]}</p>
      </fieldset>

      {/* Not remounted on switch: each view holds live state — ticks in flight —
          and remounting would discard it. */}
      <SegmentPanel segment={view}>
        {view === 'shopping' && <Shopping range={range} />}
        {view === 'prep' && <Prep range={range} />}
        {view === 'packing' && <Packing range={range} />}
      </SegmentPanel>
    </section>
  );
}
