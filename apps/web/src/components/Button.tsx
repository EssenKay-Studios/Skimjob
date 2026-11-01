// Buttons (ui-style §5): primary, secondary, small, ghost, back, premium and
// danger (arm on the first click, confirm on the second).
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { FrameArt, useElementSize } from "./SketchFrame";
import type { Seed } from "./sketch";

export type ButtonVariant = "primary" | "secondary" | "small" | "ghost" | "back" | "premium" | "toggle";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  /** Seed for the frame's wobble; defaults to the variant name. */
  readonly seed?: Seed;
  /** Leading icon (a glyph or an inline SVG). */
  readonly icon?: ReactNode;
  /** Stretch to the container's width (primary on mobile). */
  readonly block?: boolean;
  /** Toggle buttons: on (clay fill). */
  readonly pressed?: boolean;
}

const SHADOW: Record<ButtonVariant, number> = {
  primary: 0.4,
  secondary: 0.4,
  small: 0.35,
  ghost: 0,
  back: 0.35,
  premium: 0.45,
  toggle: 0.35,
};

export function Button({
  variant = "secondary",
  seed,
  icon,
  block,
  pressed,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const [ref, size] = useElementSize<HTMLButtonElement>();
  const cls = ["btn", `btn--${variant}`, block && "btn--block", pressed && "is-on", className].filter(Boolean).join(" ");
  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      {...(variant === "toggle" && { "aria-pressed": !!pressed })}
      {...rest}
    >
      {size && variant !== "ghost" && (
        <FrameArt
          w={size.w}
          h={size.h}
          seed={seed ?? variant}
          radius={variant === "small" ? 9 : 12}
          stroke={variant === "premium" ? 2 : 1.8}
          wobble={0.9}
          shadow={SHADOW[variant]}
          grain={false}
        />
      )}
      {icon && (
        <span className="btn__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children && <span className="btn__label">{children}</span>}
    </button>
  );
}

export interface DangerButtonProps extends Omit<ButtonProps, "variant" | "onClick"> {
  /** Called on the second click, while armed. */
  readonly onConfirm: () => void;
  /** Label while armed. */
  readonly armedLabel?: ReactNode;
  /** Disarm after this many ms without a second click. */
  readonly disarmAfter?: number;
}

export function DangerButton({ onConfirm, armedLabel = "Sure? Click again", disarmAfter = 3000, children, className, ...rest }: DangerButtonProps) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), disarmAfter);
    return () => clearTimeout(t);
  }, [armed, disarmAfter]);
  return (
    <Button
      {...rest}
      variant="secondary"
      className={["btn--danger", armed && "is-armed", className].filter(Boolean).join(" ")}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? armedLabel : children}
    </Button>
  );
}
