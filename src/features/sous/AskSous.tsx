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
import { commitProposal } from '../../sous/commit';
import { runIntent, type Proposal, type SousData, type ToolResult } from '../../sous/tools';
import { buildShoppingView } from '../../ui/shoppingView';
import { buildPrepView } from '../../ui/prepView';
import { Field } from '../../ui/Field';
import { useAsync } from '../../ui/useAsync';
import { supabaseClient } from '../../data/client';

const today = (): string => new Date().toISOString().slice(0, 10);

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
  const [refusal, setRefusal] = useState<string | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

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
    };
  }, [ready, jobs.state, recipes.state, ingredients.state, customers.state, rates.state, stock.state, templates.state]);

  const ask = async (): Promise<void> => {
    if (data === null || question.trim() === '') return;

    setAsking(true);
    setRefusal(null);
    setResult(null);
    setOutcome(null);

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
      );

      if (reply.kind === 'unresolved') {
        setRefusal(reply.reason);
        return;
      }

      // The engine runs HERE, after the model is done.
      const ran = runIntent(data, reply.intent);
      if (ran === null) {
        setRefusal('Sous asked for something that does not exist here.');
        return;
      }
      setResult(ran);
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
      setResult(null);
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

      {/* A refusal is shown as itself, not as a failure. Rule 8 at the
          conversational layer: asking again is cheap, acting on the wrong job is
          not. */}
      {refusal !== null && <p className="unresolved">{refusal}</p>}
      {outcome !== null && <p className="muted">{outcome}</p>}

      {result !== null && data !== null && (
        <Answer result={result} data={data} onConfirm={confirm} committing={committing} />
      )}
    </div>
  );
}

function Answer({
  result,
  data,
  onConfirm,
  committing,
}: {
  result: ToolResult;
  data: SousData;
  onConfirm: (p: Proposal) => Promise<void>;
  committing: boolean;
}): ReactNode {
  // Every branch renders through the SAME formatter the matching screen uses, so
  // the two cannot disagree.
  switch (result.kind) {
    case 'shopping': {
      const view = buildShoppingView(
        result.value.lines,
        result.value.gaps,
        data.ingredients,
        [],
      );
      return (
        <section className="sous-answer">
          <h2>
            Shopping, {result.value.from} to {result.value.to}
          </h2>
          {view.nothingToBuy && <p className="muted">Nothing to buy.</p>}
          {view.groups.map((g) => (
            <ul key={g.supplierName} className="records">
              {g.lines.map((l) => (
                <li key={l.ingredientId} className="shop-line">
                  <span className="num buy">{l.buy ?? l.outstanding}</span>{' '}
                  <span className="shop-name">{l.name}</span>
                </li>
              ))}
            </ul>
          ))}
        </section>
      );
    }

    case 'prep': {
      const view = buildPrepView(result.value.days, [], data.jobs, data.customers, []);
      return (
        <section className="sous-answer">
          <h2>
            Prep, {result.value.from} to {result.value.to}
          </h2>
          {view.days.map((d) => (
            <div key={d.prepDate}>
              <h3>{d.prepDate}</h3>
              <ul className="records">
                {d.lines.map((l) => (
                  <li key={l.recipeId} className="prep-line">
                    <span className="num batch">{l.batchLabel ?? `${l.portions} portions`}</span>{' '}
                    <span className="prep-name">{l.recipeName}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      );
    }

    case 'proposal':
      return (
        <section className="sous-answer">
          <h2>Sous suggests this change</h2>
          <ProposalView proposal={result.value} onConfirm={onConfirm} committing={committing} />
        </section>
      );

    default:
      // The remaining read tools render their engine output directly. Terse by
      // design — this is the same data the screens show, not a summary of it.
      return (
        <section className="sous-answer">
          <pre className="backup-text num">{JSON.stringify(result.value, null, 2)}</pre>
        </section>
      );
  }
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
