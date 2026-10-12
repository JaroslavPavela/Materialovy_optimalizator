import { useState } from 'react';
import { parseNumber } from '../core/import/csv.ts';

interface Props {
  readonly value: number | null | undefined;
  /** Volá se s platnou hodnotou po opuštění pole nebo Enteru; `null` = prázdné. */
  readonly onCommit: (value: number | null) => void;
  readonly label: string;
  readonly min?: number;
  readonly integer?: boolean;
  /** Prázdná hodnota je povolená (např. neomezený sklad). */
  readonly allowEmpty?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
}

const format = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : String(v).replace('.', ',');

/** Číselné pole s desetinnou čárkou i tečkou; neplatný vstup se vrátí na poslední hodnotu. */
export function NumberInput({
  value,
  onCommit,
  label,
  min,
  integer = false,
  allowEmpty = false,
  placeholder,
  className,
}: Props) {
  const [text, setText] = useState(format(value));
  const [invalid, setInvalid] = useState(false);
  // Změna hodnoty zvenku (store) přepíše rozepsaný text – úprava stavu při vykreslení.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(format(value));
    setInvalid(false);
  }

  const commit = () => {
    const parsed = parseNumber(text);
    if (!parsed.ok) {
      if (parsed.empty && allowEmpty) {
        setInvalid(false);
        if (value !== null && value !== undefined) onCommit(null);
        return;
      }
      setInvalid(true);
      return;
    }
    const v = parsed.value;
    if ((min !== undefined && v < min) || (integer && !Number.isInteger(v))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (v !== value) onCommit(v);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid}
      className={`num ${invalid ? 'invalid' : ''} ${className ?? ''}`}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}
