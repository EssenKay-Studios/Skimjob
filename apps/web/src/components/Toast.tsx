// Toasts (ui-style §8): small sketch-framed pills centred near the bottom.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { SketchFrame } from "./SketchFrame";

export type ToastTone = "info" | "good" | "bad";
interface ToastItem {
  readonly id: number;
  readonly text: ReactNode;
  readonly tone: ToastTone;
}
type Show = (text: ReactNode, tone?: ToastTone) => void;

const ToastContext = createContext<Show>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastIcon({ tone }: { tone: ToastTone }) {
  const fill = tone === "good" ? "var(--olive)" : tone === "bad" ? "var(--bad)" : "var(--gold)";
  return (
    <svg className="toast__icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10.6" cy="10.8" r="7.4" fill={fill} opacity="0.9" />
      <circle cx="10" cy="10" r="7.6" fill="none" stroke="#2a2320" strokeWidth="1.6" />
      {tone === "good" ? (
        <path d="M6.4 10.4l2.5 2.4 4.8-5.2" fill="none" stroke="#2a2320" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      ) : tone === "bad" ? (
        <path d="M10 5.8v5.1M10 13.6v.3" stroke="#2a2320" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M10 9.1v4.6M10 6.3v.3" stroke="#2a2320" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function Toast({ text, tone = "info", seed = "toast" }: { text: ReactNode; tone?: ToastTone; seed?: string | number }) {
  return (
    <SketchFrame seed={seed} radius={14} shadow={0.35} grain={false} className="toast" role="status">
      <ToastIcon tone={tone} />
      <span>{text}</span>
    </SketchFrame>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const next = useRef(1);
  const show = useCallback<Show>((text, tone = "info") => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4200);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <Toast key={t.id} text={t.text} tone={t.tone} seed={t.id} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
