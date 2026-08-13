/**
 * Ask Sous.
 *
 * The model picks a tool. The ENGINE runs here, in the browser, after the model
 * has finished, and the existing formatters render the result — so an Ask Sous
 * answer and the equivalent screen cannot disagree, because they are the same
 * call through the same code.
 *
 * The model never sees a computed number, which is why Rule 2 needs no vigilance
 * on this screen: there is no path by which a figure it produced could arrive
 * here.
 *
 * A proposal renders the impact the propose tool ALREADY computed, rather than
 * going through `ImpactPreview` as first planned: that component re-runs
 * `changeImpact` from raw inputs, and running it twice for one proposal would be
 * a second computation of the thing the owner is being asked to approve. Same
 * engine output, rendered once (Rule 7).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { supabaseDb } from '../../data/client';
import {
  clientRateRepository,
  customerRepository,
  ingredientRepository,
  jobRepository,
  recipeRepository,
  serviceTemplateRepository,
  stockRepository,
} from '../../data/repositories';
import { askSous, buildContext } from '../../sous/askSous';
import { renderAnswer, type Answer } from '../../ui/sousAnswer';
import type { Turn } from '../../sous/intent';
import { commitProposal } from '../../sous/commit';
import { runIntent, type Proposal, type SousData, type ToolResult } from '../../sous/tools';
import { Field } from '../../ui/Field';
import { useAsync } from '../../ui/useAsync';
import { supabaseClient } from '../../data/client';

/**
 * One question and what came back.
 *
 * `tool` is the part that goes back to the model next turn — and it holds no
 * answer. `answer` and `result` stay on THIS side of the boundary, for rendering
 * only.
 */
interface Exchange {
  readonly question: string;
  /** The model's own words. Digit-free by validation, written before the engine ran. */
  readonly preamble: string | null;
  readonly answer: Answer | null;
  readonly refusal: string | null;
  readonly result: ToolResult | null;
  readonly tool: Turn | null;
}

const today = (): string => new Date().toISOString().slice(0, 10);

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
};

export function AskSous(): ReactNode {
  const db = supabaseDb();

  const jobs = useAsync(() => jobRepository(db).list(), []);
  const recipes = useAsync(() => recipeRepository(db).list(), []);
  const ingredients = useAsync(() => ingredientRepository(db).list(), []);
  const customers = useAsync(() => customerRepository(db).list(), []);
  const rates = useAsync(() => clientRateRepository(db).list(), []);
  const stock = useAsync(() => stockRepository(db).list(), []);
  const templates = useAsync(() => serviceTemplateRepository(db).list(), []);

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  /**
   * The conversation, session-only.
   *
   * Not persisted: there is no schema for a transcript, and inventing one to
   * store chat history is not something to do quietly. Closing the app is a
   * clean slate, which for a kitchen assistant is the right default anyway.
   */
  const [exchanges, setExchanges] = useState<Exchange[]>([]);

  /**
   * What goes BACK to the model: questions and the tools they used, never the
   * answers. See `Turn` in intent.ts — that omission is the whole design.
   */
  const turns: Turn[] = exchanges
    .filter((e): e is Exchange & { tool: Turn } => e.tool !== null)
    .map((e) => e.tool);

  const ready =
    jobs.state.status === 'ready' &&
    recipes.state.status === 'ready' &&
    ingredients.state.status === 'ready' &&
    customers.state.status === 'ready' &&
    rates.state.status === 'ready' &&
    stock.state.status === 'ready' &&
    templates.state.status === 'ready';

  const data: SousData | null = useMemo(() => {
    if (!ready) return null;

    return {
      jobs: jobs.state.status === 'ready' ? jobs.state.data : [],
      recipes: recipes.state.status === 'ready' ? recipes.state.data : [],
      ingredients: ingredients.state.status === 'ready' ? ingredients.state.data : [],
      customers: customers.state.status === 'ready' ? customers.state.data : [],
      rates: rates.state.status === 'ready' ? rates.state.data : [],
      stock: stock.state.status === 'ready' ? stock.state.data : [],
      templates: templates.state.status === 'ready' ? templates.state.data : [],
      // The screen owns the clock. A question with no dates gets the next week,
      // and the answer states which window it covered rather than implying "ever".
      today: today(),
      horizon: addDays(today(), 7),
    };
  }, [ready, jobs.state, recipes.state, ingredients.state, customers.state, rates.state, stock.state, templates.state]);

  const ask = async (): Promise<void> => {
    if (data === null || question.trim() === '') return;

    const asked = question.trim();
    setAsking(true);
    setOutcome(null);
    setQuestion('');

    try {
      const session = await supabaseClient().auth.getSession();
      const token = session.data.session?.access_token ?? '';
      const base = import.meta.env.VITE_SUPABASE_URL ?? '';

      const reply = await askSous(
        question,
        // Identifiers and labels only. No derived figure crosses this line.
        buildContext(
          data.jobs,
          data.recipes,
          data.ingredients,
          data.customers,
          today(),
        ),
        { url: `${base}/functions/v1/ask-sous`, token },
        // Prior turns, so "what about Sunday?" resolves. It works by RE-ROUTING —
        // the model picks the same tool with new dates — not by remembering an
        // answer it was never shown.
        turns,
      );

      if (reply.kind === 'unresolved') {
        setExchanges((prior) => [
          ...prior,
          { question: asked, preamble: null, answer: null, refusal: reply.reason, result: null, tool: null },
        ]);
        return;
      }

      // The engine runs HERE, after the model is done. This ordering is what makes
      // the preamble safe: the model wrote its line before any of this existed.
      const ran = runIntent(data, reply.intent);
      if (ran === null) {
        setExchanges((prior) => [
          ...prior,
          {
            question: asked,
            preamble: null,
            answer: null,
            refusal: 'Sous asked for something that does not exist here.',
            result: null,
            tool: null,
          },
        ]);
        return;
      }

      setExchanges((prior) => [
        ...prior,
        {
          question: asked,
          preamble: reply.preamble,
          answer: renderAnswer(ran, data),
          refusal: null,
          result: ran,
          tool: {
            question: asked,
            tool: reply.intent.tool,
            args: reply.intent.args as unknown as Record<string, unknown>,
          },
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const confirm = async (proposal: Proposal): Promise<void> => {
    setCommitting(true);
    setOutcome(null);

    // The ONLY call to commitProposal in the app, fired by this tap (Rule 7).
    const done = await commitProposal(db, proposal);

    setOutcome(done.ok ? 'Saved, and the change is in the job history.' : done.error);
    if (done.ok) {
      // The proposal is spent. Clearing it stops a second tap re-saving.
      setExchanges((prior) => prior.map((e) => ({ ...e, result: null })));
      jobs.reload();
    }
    setCommitting(false);
  };

  return (
    <div>
      <h1>Ask Sous</h1>

      <Field
        label="What do you want to know?"
        value={question}
        onChange={setQuestion}
        multiline
        hint="Sous can look at shopping, prep, packing, money and job readiness, and can propose a change to a job for you to confirm."
      />

      <button
        type="button"
        className="primary"
        disabled={asking || !ready || question.trim() === ''}
        onClick={() => void ask()}
      >
        {asking ? 'Asking…' : 'Ask'}
      </button>

      {outcome !== null && <p className="muted">{outcome}</p>}

      {/* The conversation. Oldest first, so it reads like a thread. */}
      {exchanges.map((exchange, i) => (
        <section key={`${i}-${exchange.question}`} className="sous-turn">
          <p className="sous-asked">{exchange.question}</p>

          {/* The model's own words — written BEFORE the engine ran, and rejected
              by validation if they contained a digit. Conversational glue only:
              every figure below comes from the engine. */}
          {exchange.preamble !== null && <p className="muted">{exchange.preamble}</p>}

          {/* A refusal is shown as itself, not as a failure. Rule 8 at the
              conversational layer: asking again is cheap, acting on the wrong job
              is not. */}
          {exchange.refusal !== null && <p className="unresolved">{exchange.refusal}</p>}

          {exchange.answer !== null && (
            <>
              <p className="sous-lead">{exchange.answer.lead}</p>

              {exchange.answer.detail.length > 0 && (
                <ul className="sous-detail num">
                  {exchange.answer.detail.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}

              {exchange.answer.flags.length > 0 && (
                <ul className="unresolved-block">
                  {exchange.answer.flags.map((flagText) => (
                    <li key={flagText}>{flagText}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* Rule 7: a proposal is a suggestion until he taps confirm. */}
          {exchange.result?.kind === 'proposal' && (
            <ProposalView
              proposal={exchange.result.value}
              onConfirm={confirm}
              committing={committing}
            />
          )}
        </section>
      ))}

    </div>
  );
}

function ProposalView({
  proposal,
  onConfirm,
  committing,
}: {
  proposal: Proposal;
  onConfirm: (p: Proposal) => Promise<void>;
  committing: boolean;
}): ReactNode {
  return (
    <>
      <ul>
        {Object.entries(proposal.changes).map(([field, value]) => (
          <li key={field}>
            {field}: <strong>{String(value)}</strong>
          </li>
        ))}
      </ul>

      {/* The diff the owner is approving. Straight from changeImpact — the same
          before/after the Jobs screen shows for the same change. */}
      <ul className="records">
        {proposal.impact.ingredients
          .filter((i) => i.required.delta !== 0)
          .map((i) => (
            <li key={i.ingredientId}>
              {i.name}: {i.required.before} → <strong>{i.required.after}</strong> {i.unit}
            </li>
          ))}
      </ul>

      {proposal.impact.gapsIntroduced.length > 0 && (
        <div className="unresolved-block">
          <p className="unresolved">This change leaves something unresolved</p>
          <ul>
            {proposal.impact.gapsIntroduced.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={committing}
          onClick={() => void onConfirm(proposal)}
        >
          {committing ? 'Saving…' : 'Confirm and save'}
        </button>
      </div>

      <p className="hint muted">
        Nothing is saved until you tap confirm. Sous cannot save this itself.
      </p>
    </>
  );
}
