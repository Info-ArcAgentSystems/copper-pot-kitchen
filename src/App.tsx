/**
 * The shell.
 *
 * A BOTTOM tab bar, not a top nav: this is used one-handed, and the top of a
 * phone is where a thumb cannot reach.
 *
 * The screens themselves land in later batches. The routes exist now so the shell
 * and the guard can be exercised, and each renders an honest "not built yet"
 * rather than a placeholder that looks like an empty kitchen — those are different
 * things, and Rule 1 makes the distinction matter.
 */

import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { KitchenProvider } from './auth/KitchenContext';
import { useKitchen } from './auth/kitchenState';
import { RequireKitchen } from './auth/RequireKitchen';
import { signOut } from './auth/session';
import { Setup } from './features/setup/Setup';
import { Customers } from './features/setup/Customers';
import { Properties } from './features/setup/Properties';
import { Suppliers } from './features/setup/Suppliers';
import { RateCard } from './features/setup/RateCard';
import { ServiceTemplates } from './features/setup/ServiceTemplates';
import { SavedMenus } from './features/setup/SavedMenus';
import { ClientGroups } from './features/setup/ClientGroups';
import { BackupScreen } from './features/setup/Backup';
import { Jobs } from './features/jobs/Jobs';
import { Service } from './features/service/Service';
import { Library } from './features/library/Library';
import { ScanHub } from './features/scan/ScanHub';
import { ScanJobSheet } from './features/scan/ScanJobSheet';
import { ScanRecipeCard } from './features/scan/ScanRecipeCard';
import { ScanInvoice } from './features/scan/ScanInvoice';
import { ScanMenu } from './features/scan/ScanMenu';
import { Money } from './features/money/Money';
import { NotFound } from './features/NotFound';
import { AskSous } from './features/sous/AskSous';
import { SousProvider } from './features/sous/SousContext';
import { Sheet } from './ui/Sheet';
import { Icon } from './ui/icons';

/*
 * FIVE, and each one is a job rather than a screen.
 *
 * Eight tabs did not fit: they scrolled sideways on a phone, which hid Recipes,
 * Ingredients and Setup behind a gesture nobody discovers, and left no room for
 * Scan at all. The owner reported being unable to find the camera — correctly,
 * because every scanner was a text link on somebody else's screen.
 *
 * Service and Library are shells over the existing screens, chosen so that no
 * feature directory moves and `tests/ui/derived.test.ts` keeps guarding Rule 6
 * unchanged. Setup leaves the bar for the header: it is configured once and then
 * rarely opened, which is exactly what a header link is for.
 */
const TABS = [
  { to: '/', label: 'Jobs' },
  { to: '/service', label: 'Service' },
  { to: '/money', label: 'Money' },
  { to: '/library', label: 'Library' },
  { to: '/scan', label: 'Scan' },
] as const;

function Header(): ReactNode {
  const { state } = useKitchen();
  const ref = useRef<HTMLElement>(null);

  /*
   * A hairline shadow once the page has scrolled under the bar, so the edge
   * reads as "content continues up here". Toggled on the element directly, not
   * through React state: a scroll handler that re-rendered the shell would
   * redraw every screen on every frame of a scroll.
   */
  useEffect(() => {
    if (state.status !== 'ready') return undefined;
    const main = document.querySelector('.app-main');
    const header = ref.current;
    if (main === null || header === null) return undefined;
    const onScroll = (): void => {
      header.classList.toggle('is-scrolled', main.scrollTop > 4);
    };
    onScroll();
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, [state.status]);

  if (state.status !== 'ready') return null;

  return (
    <header className="app-header" ref={ref}>
      {/* The BAR is full-width; its CONTENTS align to the reading column, so the
          bottom border still reaches both window edges. */}
      <div className="app-header-inner">
        <span>{state.membership.kitchenName}</span>
      <NavLink to="/setup" className="tap">
        Setup
      </NavLink>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

/*
 * One line icon per tab, drawn inline so nothing is fetched and the stroke takes
 * the tab's own colour through `currentColor` — idle grey, active accent.
 *
 * Decoration beside a label, never instead of one: `aria-hidden`, and the label
 * is always shown. A row of bare glyphs is a guessing game in a kitchen.
 *
 * Sized by attribute, not by CSS. `tests/ui/tokens.test.ts` scans the stylesheet
 * for any height under the 44px touch floor, and a 22px icon rule would trip it
 * for something nobody taps on its own.
 */
const ICON_PATHS: Readonly<Record<(typeof TABS)[number]['to'], readonly string[]>> = {
  // Jobs — a calendar page.
  '/': ['M4 6.5h16v13H4z', 'M4 10.5h16', 'M8.5 4v4', 'M15.5 4v4'],
  // Service — a clipboard with ticks: shopping, prep, packing.
  '/service': ['M7 5H5.5v15h13V5H17', 'M9 3.5h6v3H9z', 'M8.5 11l1.5 1.5 3-3', 'M8.5 16.5h7'],
  // Money — a note.
  '/money': ['M3.5 7h17v10h-17z', 'M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5', 'M6.5 10v4', 'M17.5 10v4'],
  // Library — an open book.
  '/library': ['M12 6.5C10 5 7 4.8 4 5.5v13c3-.7 6-.5 8 1', 'M12 6.5c2-1.5 5-1.7 8-1v13c-3-.7-6-.5-8 1', 'M12 6.5v13'],
  // Scan — a camera.
  '/scan': ['M4 8h3.5L9 5.5h6L16.5 8H20v11H4z', 'M12 10.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
};

function TabIcon({ to }: { readonly to: (typeof TABS)[number]['to'] }): ReactNode {
  return (
    <svg
      className="tab-icon"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[to].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/*
 * THE HIGHLIGHT SLIDES to the tab you chose instead of jumping, so the eye
 * follows where you went. One element, measured from whichever link NavLink
 * marked `aria-current`: a solid row behind the label on the rail, a short mark
 * over the icon on the phone bar.
 *
 * Progressive: until it has measured, the link's own `aria-current` style shows
 * the active tab, so a failed measure never leaves him without one. Its size is
 * set here, inline, because `tests/ui/tokens.test.ts` holds every px height in
 * the stylesheet to the 44px touch floor, and a 3px mark is decoration, not a
 * target.
 */
function useSlidingMark(): {
  readonly inner: RefObject<HTMLDivElement | null>;
  readonly mark: RefObject<HTMLSpanElement | null>;
} {
  const { pathname } = useLocation();
  const inner = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = inner.current;
    const el = mark.current;
    if (box === null || el === null) return undefined;

    const place = (): void => {
      const active = box.querySelector<HTMLElement>('a[aria-current="page"]');
      if (active === null) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      const rail = getComputedStyle(box).flexDirection === 'column';
      const w = rail ? active.offsetWidth : 26;
      const h = rail ? active.offsetHeight : 3;
      const x = rail ? active.offsetLeft : active.offsetLeft + (active.offsetWidth - w) / 2;
      const y = rail ? active.offsetTop : 0;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.dataset.rail = rail ? 'true' : 'false';
      // The first placement must not slide in from the corner.
      if (el.dataset.ready !== 'true') {
        requestAnimationFrame(() => {
          el.dataset.ready = 'true';
        });
      }
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [pathname]);

  return { inner, mark };
}

function TabBar(): ReactNode {
  const { inner, mark } = useSlidingMark();
  return (
    <nav className="tabs" aria-label="Sections">
      <div className="tabs-inner" ref={inner}>
        <span className="tabs-mark" ref={mark} aria-hidden="true" hidden />
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className="tap">
            <TabIcon to={tab.to} />
            <span className="tab-label">{tab.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/**
 * ASK SOUS, ONE TAP FROM ANY SCREEN.
 *
 * A round button in the corner opens the conversation in a panel over the page,
 * so asking "is Friday ready?" does not lose his place. The transcript lives in
 * `SousProvider`, above the router, so the panel and the full /sous page share
 * one conversation. Hidden on /sous itself, where it would open a copy of the
 * screen it sits on.
 */
function SousBubble({ onSaved }: { readonly onSaved: () => void }): ReactNode {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  if (pathname.startsWith('/sous')) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          className="sous-bubble"
          aria-label="Ask Sous"
          onClick={() => setOpen(true)}
        >
          <Icon name="chat" size={26} />
        </button>
      )}
      {open && (
        <Sheet title="Ask Sous" onClose={() => setOpen(false)}>
          <AskSous inPanel onSaved={onSaved} />
        </Sheet>
      )}
    </>
  );
}

export default function App(): ReactNode {
  const [dataVersion, setDataVersion] = useState(0);
  return (
    <KitchenProvider>
      {/* Above the router on purpose: the transcript has to outlive the Ask Sous
          screen, or leaving the tab loses the conversation. In memory only — a
          reload is a clean slate, and no storage layer exists for it. */}
      <SousProvider>
        <RequireKitchen>
          <Header />
          {/*
           * BETWEEN the header and the content, in the DOM, at every width.
           *
           * On desktop that is also the visual order, so Tab moves
           * header → sections → content, which is the order a keyboard user
           * expects and desktop is where keyboard navigation actually happens.
           * On a phone CSS moves the bar to the bottom of the viewport and the
           * two orders differ — acceptable there, because the way a screen
           * reader user reaches navigation on a phone is by landmark, and both
           * landmarks are real: this is a <nav aria-label="Sections"> and the
           * content below is a <main>.
           *
           * ONE render site. There is no header copy and no bottom-bar copy to
           * drift apart, so `aria-current`, the 44px targets and the focus ring
           * are the same element in both positions rather than two that have to
           * be kept in step.
           */}
          <TabBar />
          <main className="app-main">
            {/* Re-keyed when Sous saves a change from the bubble, so the page
                underneath re-reads instead of showing the job as it was. */}
            <div className="content" key={dataVersion}>
              <Routes>
              <Route path="/" element={<Jobs />} />
              {/* Bookmarks from the eight-tab era. Each resolves rather than
                  404s — see tests/ui/routes.test.ts. */}
              <Route path="/jobs" element={<Navigate to="/" replace />} />
              <Route path="/today" element={<Navigate to="/" replace />} />
              <Route path="/service" element={<Navigate to="/service/shopping" replace />} />
              <Route path="/service/:view" element={<Service />} />
              <Route path="/library" element={<Navigate to="/library/recipes" replace />} />
              <Route path="/library/:view" element={<Library />} />
              <Route path="/scan" element={<ScanHub />} />
              {/* Scan is NOT a tab. It produces jobs, so it is an action on the
                  Jobs screen — and a ninth tab would put every tab under the 44px
                  floor the rest of the app holds to. See ARCHITECTURE.md. */}
              <Route path="/scan/job-sheet" element={<ScanJobSheet />} />
              <Route path="/scan/recipe-card" element={<ScanRecipeCard />} />
              <Route path="/scan/invoice" element={<ScanInvoice />} />
              <Route path="/scan/menu" element={<ScanMenu />} />
              <Route path="/prep" element={<Navigate to="/service/prep" replace />} />
              <Route path="/shopping" element={<Navigate to="/service/shopping" replace />} />
              <Route path="/packing" element={<Navigate to="/service/packing" replace />} />
              <Route path="/money" element={<Money />} />
              <Route path="/sous" element={<AskSous />} />
              <Route path="/recipes" element={<Navigate to="/library/recipes" replace />} />
              <Route path="/ingredients" element={<Navigate to="/library/ingredients" replace />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/setup/customers" element={<Customers />} />
              <Route path="/setup/properties" element={<Properties />} />
              <Route path="/setup/suppliers" element={<Suppliers />} />
              <Route path="/setup/rates" element={<RateCard />} />
              <Route path="/setup/templates" element={<ServiceTemplates />} />
              <Route path="/setup/menus" element={<SavedMenus />} />
              <Route path="/setup/groups" element={<ClientGroups />} />
              <Route path="/setup/backup" element={<BackupScreen />} />

              {/* LAST, and it must stay last: `<Routes>` picks the best match
                  rather than the first, but a reader scanning this list should
                  find the catch-all where a catch-all belongs.

                  It exists because of `vercel.json`. The rewrite that makes a
                  refresh on `/service/shopping` work also answers a typo with
                  the app and a 200, and before this the typo rendered the shell
                  around an empty column. */}
              <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
          </main>
          <SousBubble onSaved={() => setDataVersion((v) => v + 1)} />
        </RequireKitchen>
      </SousProvider>
    </KitchenProvider>
  );
}
