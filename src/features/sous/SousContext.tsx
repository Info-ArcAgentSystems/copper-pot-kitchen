/**
 * Where the Ask Sous conversation lives between screens.
 *
 * IN MEMORY ONLY. Mounted above the router, so it outlives the Ask Sous screen
 * and survives navigating between tabs; a full reload is a clean slate, which for
 * a kitchen assistant is the right default and needs no schema, no migration and
 * no storage layer.
 *
 * WHAT THIS DELIBERATELY DOES NOT HOLD is the live `Proposal`. That stays in the
 * Ask Sous component, so it dies when the screen unmounts. See `ui/transcript.ts`
 * for why: a proposal is computed from one snapshot of the data, and one that
 * outlives its snapshot can be confirmed into a write nobody checked.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  addExchange,
  emptyTranscript,
  type Exchange,
  type Transcript,
} from '../../ui/transcript';

interface SousStore {
  readonly transcript: Transcript;
  readonly add: (exchange: Exchange) => void;
  readonly clear: () => void;
}

const SousStoreContext = createContext<SousStore | null>(null);

export function SousProvider({ children }: { children: ReactNode }): ReactNode {
  const [transcript, setTranscript] = useState<Transcript>(emptyTranscript);

  const store = useMemo<SousStore>(
    () => ({
      transcript,
      add: (exchange) => setTranscript((prior) => addExchange(prior, exchange)),
      clear: () => setTranscript(emptyTranscript()),
    }),
    [transcript],
  );

  return <SousStoreContext.Provider value={store}>{children}</SousStoreContext.Provider>;
}

export function useSousStore(): SousStore {
  const store = useContext(SousStoreContext);
  if (store === null) {
    throw new Error('useSousStore must be used inside SousProvider');
  }
  return store;
}
