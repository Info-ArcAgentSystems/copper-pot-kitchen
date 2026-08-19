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

import { NavLink, Route, Routes } from 'react-router-dom';
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
import { Ingredients } from './features/setup/Ingredients';
import { Recipes } from './features/setup/Recipes';
import { Jobs } from './features/jobs/Jobs';
import { ScanJobSheet } from './features/scan/ScanJobSheet';
import { Shopping } from './features/shopping/Shopping';
import { Prep } from './features/prep/Prep';
import { Packing } from './features/packing/Packing';
import { Money } from './features/money/Money';
import { AskSous } from './features/sous/AskSous';

const TABS = [
  { to: '/', label: 'Jobs' },
  { to: '/shopping', label: 'Shopping' },
  { to: '/prep', label: 'Prep' },
  { to: '/packing', label: 'Packing' },
  { to: '/money', label: 'Money' },
  { to: '/recipes', label: 'Recipes' },
  { to: '/ingredients', label: 'Ingredients' },
  { to: '/setup', label: 'Setup' },
] as const;

function Header(): ReactNode {
  const { state } = useKitchen();
  if (state.status !== 'ready') return null;

  return (
    <header className="app-header">
      <span>{state.membership.kitchenName}</span>
      {/* Ask Sous lives here rather than in the bottom bar: it is cross-cutting,
          and the bar is already past the point where another tab fits. */}
      <NavLink to="/sous" className="tap">
        Ask Sous
      </NavLink>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
      </button>
    </header>
  );
}

function TabBar(): ReactNode {
  return (
    <nav className="tabs" aria-label="Sections">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className="tap">
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App(): ReactNode {
  return (
    <KitchenProvider>
      <RequireKitchen>
        <Header />
        <main className="app-main">
          <Routes>
            <Route path="/" element={<Jobs />} />
            {/* Scan is NOT a tab. It produces jobs, so it is an action on the
                Jobs screen — and a ninth tab would put every tab under the 44px
                floor the rest of the app holds to. See ARCHITECTURE.md. */}
            <Route path="/scan/job-sheet" element={<ScanJobSheet />} />
            <Route path="/prep" element={<Prep />} />
            <Route path="/shopping" element={<Shopping />} />
            <Route path="/packing" element={<Packing />} />
            <Route path="/money" element={<Money />} />
            <Route path="/sous" element={<AskSous />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/ingredients" element={<Ingredients />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/setup/customers" element={<Customers />} />
            <Route path="/setup/properties" element={<Properties />} />
            <Route path="/setup/suppliers" element={<Suppliers />} />
            <Route path="/setup/rates" element={<RateCard />} />
            <Route path="/setup/templates" element={<ServiceTemplates />} />
            <Route path="/setup/backup" element={<BackupScreen />} />
          </Routes>
        </main>
        <TabBar />
      </RequireKitchen>
    </KitchenProvider>
  );
}
