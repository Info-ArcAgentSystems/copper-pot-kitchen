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
import { Ingredients } from './features/setup/Ingredients';
import { Recipes } from './features/setup/Recipes';
import { Jobs } from './features/jobs/Jobs';
import { Shopping } from './features/shopping/Shopping';
import { Prep } from './features/prep/Prep';
import { Packing } from './features/packing/Packing';

const TABS = [
  { to: '/', label: 'Jobs' },
  { to: '/shopping', label: 'Shopping' },
  { to: '/prep', label: 'Prep' },
  { to: '/packing', label: 'Packing' },
  { to: '/recipes', label: 'Recipes' },
  { to: '/ingredients', label: 'Stock' },
  { to: '/setup', label: 'Setup' },
] as const;

function Header(): ReactNode {
  const { state } = useKitchen();
  if (state.status !== 'ready') return null;

  return (
    <header className="app-header">
      <span>{state.membership.kitchenName}</span>
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
            <Route path="/prep" element={<Prep />} />
            <Route path="/shopping" element={<Shopping />} />
            <Route path="/packing" element={<Packing />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/ingredients" element={<Ingredients />} />
            <Route path="/setup" element={<Setup />} />
            <Route path="/setup/customers" element={<Customers />} />
            <Route path="/setup/properties" element={<Properties />} />
            <Route path="/setup/suppliers" element={<Suppliers />} />
            <Route path="/setup/rates" element={<RateCard />} />
            <Route path="/setup/templates" element={<ServiceTemplates />} />
          </Routes>
        </main>
        <TabBar />
      </RequireKitchen>
    </KitchenProvider>
  );
}
