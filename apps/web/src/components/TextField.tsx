// A paper text input inside a sketch frame.
import { useEffect, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { FrameArt, useElementSize } from "./SketchFrame";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly seed?: string;
  /** Hide the label visually (still read by screen readers). */
  readonly hideLabel?: boolean;
  /** Bump to shake the box (ui-style §9). The input is never remounted, so
   * focus and a phone's keyboard stay put. */
  readonly shake?: number;
}

const SHAKE: Keyframe[] = [{ translate: "0" }, { translate: "-4px" }, { translate: "3px" }, { translate: "-2px" }, { translate: "0" }];

export function TextField({ label, hint, error, seed = "field", hideLabel, shake = 0, className, ...rest }: TextFieldProps) {
  const id = useId();
  const [ref, size] = useElementSize<HTMLDivElement>();
  useEffect(() => {
    const box = ref.current;
    if (!shake || !box || typeof box.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    box.animate(SHAKE, { duration: 350, easing: "ease" });
  }, [shake, ref]);
  const note = error ?? hint;
  return (
    <div className={["field", error && "is-error", className].filter(Boolean).join(" ")}>
      <label htmlFor={id} className={hideLabel ? "visually-hidden" : "field__label"}>
        {label}
      </label>
      <div className="field__box" ref={ref}>
        {size && <FrameArt w={size.w} h={size.h} seed={seed} radius={10} wobble={0.8} stroke={1.5} shadow={0} grain={false} />}
        <input
          id={id}
          className="field__input"
          aria-invalid={!!error}
          {...(note ? { "aria-describedby": `${id}-note` } : {})}
          {...rest}
        />
      </div>
      {note !== undefined && (
        <p id={`${id}-note`} className="field__hint" role={error ? "alert" : undefined}>
          {note}
        </p>
      )}
    </div>
  );
}
