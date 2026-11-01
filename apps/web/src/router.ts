// A tiny pathname router (m2-plan: no router library for a handful of routes).
import { useEffect, useState } from "react";

const EVENT = "skimjob:navigate";

export function navigate(to: string): void {
  if (to === location.pathname + location.search) return;
  history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo({ top: 0 });
}

/** The current pathname; re-renders on navigate() and back/forward. */
export function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return path;
}

/** Click handler for in-app links: plain clicks navigate, modified clicks open normally. */
export function linkClick(e: React.MouseEvent<HTMLAnchorElement>): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(e.currentTarget.getAttribute("href") ?? "/");
}
