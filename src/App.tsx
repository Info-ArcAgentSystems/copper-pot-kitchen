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

import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
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
import { AskSous } from './features/sous/AskSous';
import { SousProvider } from './features/sous/SousContext';

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
  if (state.status !== 'ready') return null;

  return (
    <header className="app-header">
      {/* The BAR is full-width; its CONTENTS align to the reading column, so the
          bottom border still reaches both window edges. */}
      <div className="app-header-inner">
        <span>{state.membership.kitchenName}</span>
      {/* Ask Sous lives here rather than in the bottom bar: it is cross-cutting,
          and the bar is already past the point where another tab fits. */}
      <NavLink to="/sous" className="tap">
        Ask Sous
      </NavLink>
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

function TabBar(): ReactNode {
  return (
    <nav className="tabs" aria-label="Sections">
      <div className="tabs-inner">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className="tap">
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export default function App(): ReactNode {
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
            <div className="content">
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
              <Route path="/setup/backup" element={<BackupScreen />} />
              </Routes>
            </div>
          </main>
        </RequireKitchen>
      </SousProvider>
    </KitchenProvider>
  );
}
