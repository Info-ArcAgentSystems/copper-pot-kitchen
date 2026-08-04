/**
 * A labelled form control.
 *
 * The label is wired with `htmlFor` rather than wrapping the input, so tapping it
 * focuses the control — a real difference on a phone, where the label is often an
 * easier target than the field.
 *
 * Sizing comes from `tokens.css`, not from here: 44px minimum and 16px text are
 * declared once for every input, and `tests/ui/tokens.test.ts` fails any rule
 * that goes below either.
 */

import type { ReactNode } from 'react';

let sequence = 0;
const nextId = (): string => `f${(sequence += 1)}`;

export interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  readonly error?: string | null;
  readonly required?: boolean;
  readonly multiline?: boolean;
  readonly inputMode?: 'text' | 'numeric' | 'decimal' | 'email' | 'tel';
  readonly autoComplete?: string;
  /** Right-aligned tabular numerals, for quantities and money. */
  readonly numeric?: boolean;
  readonly placeholder?: string;
}

export function Field({
  label,
  value,
  onChange,
  hint,
  error = null,
  required = false,
  multiline = false,
  inputMode = 'text',
  autoComplete,
  numeric = false,
  placeholder,
}: FieldProps): ReactNode {
  const id = nextId();
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === null ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter((x) => x !== undefined).join(' ') || undefined;

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {!required && <span className="muted"> (optional)</span>}
      </label>

      {multiline ? (
        <textarea
          id={id}
          value={value}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={error !== null}
          placeholder={placeholder}
        />
      ) : (
        <input
          id={id}
          type="text"
          className={numeric ? 'num' : undefined}
          value={value}
          inputMode={inputMode}
          autoComplete={autoComplete}
          autoCapitalize={inputMode === 'email' ? 'none' : undefined}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={error !== null}
          placeholder={placeholder}
        />
      )}

      {hint !== undefined && (
        <p id={hintId} className="hint muted">
          {hint}
        </p>
      )}
      {error !== null && (
        <p id={errorId} className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A small fixed set of choices. A native select is the right control on iOS. */
export function ChoiceField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}): ReactNode {
  const id = nextId();

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
