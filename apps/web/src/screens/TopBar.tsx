import type { ReactNode } from "react";
import { Wordmark } from "../components/Wordmark";
import { linkClick } from "../router";

/** The page header every screen shares: the wordmark (home) and an optional action. */
export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <a href="/" onClick={linkClick} className="topbar__home" aria-label="Skimjob home">
        <Wordmark size={28} />
      </a>
      {children && <nav className="topbar__nav">{children}</nav>}
    </header>
  );
}
