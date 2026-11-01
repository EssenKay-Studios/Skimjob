// A labelled row of toggle buttons for one choice (host settings, bot
// personality). Read-only shows just the chosen value as an active chip.
import { useId, type ReactNode } from "react";
import { Button } from "./Button";
import { Chip } from "./Chip";

export interface SegmentedOption<T> {
  readonly value: T;
  readonly label: ReactNode;
}

export interface SegmentedProps<T> {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange?: (value: T) => void;
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  readonly seed: string;
}

export function Segmented<T extends string | boolean>({ label, hint, options, value, onChange, readOnly, disabled, seed }: SegmentedProps<T>) {
  const id = useId();
  const chosen = options.find((o) => o.value === value);
  return (
    <div className="seg" role="group" aria-labelledby={`${id}-l`}>
      <div className="seg__head">
        <span id={`${id}-l`} className="seg__label">
          {label}
        </span>
        {hint && <span className="meta">{hint}</span>}
      </div>
      <div className="seg__opts">
        {readOnly
          ? chosen && <Chip on>{chosen.label}</Chip>
          : options.map((o) => (
              <Button
                key={String(o.value)}
                variant="toggle"
                seed={`${seed}-${String(o.value)}`}
                pressed={o.value === value}
                disabled={disabled}
                onClick={() => o.value !== value && onChange?.(o.value)}
              >
                {o.label}
              </Button>
            ))}
      </div>
    </div>
  );
}
