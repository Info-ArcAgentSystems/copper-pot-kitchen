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

const TABS = [
  { to: '/', label: 'Jobs' },
  { to: '/prep', label: 'Prep' },
  { to: '/shopping', label: 'Shopping' },
  { to: '/recipes', label: 'Recipes' },
  { to: '/setup', label: 'Setup' },
] as const;

function NotBuiltYet({ name }: { name: string }): ReactNode {
  return (
    <div className="empty">
      <h2>{name}</h2>
      <p className="muted">This screen is not built yet.</p>
    </div>
  );
}

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
            <Route path="/" element={<NotBuiltYet name="Jobs" />} />
            <Route path="/prep" element={<NotBuiltYet name="Prep" />} />
            <Route path="/shopping" element={<NotBuiltYet name="Shopping" />} />
            <Route path="/recipes" element={<NotBuiltYet name="Recipes" />} />
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
