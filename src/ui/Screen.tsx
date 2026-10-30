/**
 * The container every screen sits in, and the one place a page title is drawn.
 *
 * TWO DEFECTS, ONE CAUSE. Both came from every screen building its own root.
 *
 * ONE BIG HEADING PER SCREEN. Service rendered `<h1>Service</h1>` and then
 * `Shopping` — a child screen rendering a shell's sibling — rendered
 * `<h1>Shopping</h1>` underneath it, so the screen opened with two titles and
 * two descriptions, the second of them answering a question the first had
 * already answered. Library did the same with Recipes and Ingredients. A title
 * cannot be rendered twice if there is exactly one component that renders one,
 * which is this.
 *
 * ONE SPACING RHYTHM. Thirty-one rules in `app.css` each gave some block its
 * own bottom margin — `.supplier-group` 24px, `.needs-fixing` 16px,
 * `.money-row` 12px — so the gap between two blocks depended on which two they
 * were, and a new block got no gap at all until somebody noticed. The rhythm
 * belongs to the container: `.screen > * + *` in `app.css` spaces whatever is
 * put inside it, and a block added next year inherits it without being told.
 *
 * THE TITLE AND ITS DESCRIPTION ARE ONE BLOCK, which is what `.page-head` is
 * for. They were two siblings in the rhythm before, and a 24px gap between a
 * title and the line explaining it reads as two separate statements. Inside
 * `.page-head` they sit 4px apart and the rhythm applies to the pair.
 *
 * `title` is optional, and the reason is `RecordScreen`: a screen rendered
 * inside a shell has already had its title drawn by the shell. See `inShell`
 * there.
 */

import type { ReactNode } from 'react';

export function Screen({
  title,
  description,
  children,
}: {
  readonly title?: string;
  /** The one line under the title saying what the screen is FOR, in his words. */
  readonly description?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="screen">
      {title !== undefined && (
        <div className="page-head">
          <h1>{title}</h1>
          {description !== undefined && <p className="page-sub">{description}</p>}
        </div>
      )}
      {children}
    </div>
  );
}
