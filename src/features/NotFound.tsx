/**
 * The screen for an address that matches nothing.
 *
 * IT EXISTS BECAUSE THE 404 FIX CREATED THE NEED FOR IT. `vercel.json` rewrites
 * every path Vercel cannot serve as a real file to `/index.html`, which is what
 * makes refreshing `/service/shopping` work. The same rewrite means a genuine
 * typo — `/sevice/shopping` — now also returns the app, with a 200, and until
 * this existed `<Routes>` matched nothing and rendered NOTHING: the header, the
 * tabs, and an empty column between them. A blank screen is a worse answer than
 * Vercel's 404, because Vercel's at least says what happened.
 *
 * THE PATH IS SHOWN BACK TO HIM. A typo is usually visible the moment you read
 * it, and "copper-pot…/sevice/shopping" is the whole diagnosis. React escapes it,
 * so a path carrying markup is text here and nothing else.
 *
 * It cannot send a real 404 status, and does not pretend to. The rewrite has
 * already answered 200 by the time any of this runs; the status belongs to the
 * static host and the honest thing here is to say it in words.
 */

import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Screen } from '../ui/Screen';

export function NotFound(): ReactNode {
  const location = useLocation();

  return (
    <Screen
      title="Nothing at that address"
      description="The link or bookmark points at a page this app does not have."
    >
      <p className="muted">
        You asked for <strong>{location.pathname}</strong>.
      </p>

      {/* Every old address from the eight-tab era still resolves — see the
          redirects in `App.tsx` — so a bookmark that used to work is not what
          brings him here. A typo is. */}
      <p className="muted">
        Old bookmarks still work, so this is most likely a mistyped address rather
        than something that has moved.
      </p>

      <p className="hint muted">
        <Link className="qlink" to="/">
          Go to Jobs
        </Link>
      </p>
    </Screen>
  );
}
