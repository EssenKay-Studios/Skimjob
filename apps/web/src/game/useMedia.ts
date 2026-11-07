import { useEffect, useState } from "react";

/** Whether a CSS media query matches now; follows it as the window changes. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return on;
}
