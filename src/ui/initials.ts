/**
 * Up to two letters for a row's thumbnail: "Full Irish" → "FI".
 *
 * Decoration, so the eye can find a row in a long list — never information:
 * the full name is always beside it, and the thumbnail is hidden from screen
 * readers.
 */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w !== '')
    .slice(0, 2)
    .map((w) => [...w][0] ?? '')
    .join('')
    .toUpperCase();
}
