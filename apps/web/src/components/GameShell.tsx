// The one-screen game layout (design §15.6): the status strip, the bank board in
// the middle, and the panels around it. Laptops (1024 px and up) show three
// columns (side tabs, board with plan board under it, "This round"); phones and
// tablets show the board with a dock and a tab bar, and each panel opens as a
// bottom sheet. The shell only places things: what goes inside comes from the
// caller. Each panel is rendered once, for the layout in use.
import { useEffect, useState, type ReactNode } from "react";
import { useMedia } from "../game/useMedia";
import { BottomSheet } from "./BottomSheet";
import { Button } from "./Button";
import { SketchFrame } from "./SketchFrame";

/** Where a panel lives on laptops. `sheet` panels exist only as phone sheets (pick a room, grab and split). */
export type ShellPlace = "left" | "centre" | "right" | "sheet";

export interface ShellPanel {
  readonly id: string;
  readonly title: string;
  readonly place: ShellPlace;
  /** A button in the phone tab bar. */
  readonly tab?: { readonly icon: ReactNode; readonly badge?: number };
  readonly node: ReactNode;
}

export interface GameShellProps {
  /** The strip across the top: round, Wanted, bank, honesty, share. */
  readonly status: ReactNode;
  /** The bank board. */
  readonly board: ReactNode;
  /** Phones: the peek above the tab bar (your room and the next step). */
  readonly dock?: ReactNode;
  readonly panels: readonly ShellPanel[];
  /** Phones: the id of the open sheet. */
  readonly open: string | null;
  readonly onOpen: (id: string | null) => void;
}

/** From here the laptop layout takes over. */
const SHELL_WIDE_QUERY = "(min-width: 1024px)";

export function GameShell(props: GameShellProps) {
  const wide = useMedia(SHELL_WIDE_QUERY);
  const { open, onOpen } = props;
  // A sheet left open on a phone must not pop up again when the window narrows.
  useEffect(() => {
    if (wide && open !== null) onOpen(null);
  }, [wide, open, onOpen]);
  return wide ? <WideShell {...props} /> : <NarrowShell {...props} />;
}

const at = (panels: readonly ShellPanel[], place: ShellPlace) => panels.filter((p) => p.place === place);

function WideShell({ status, board, panels }: GameShellProps) {
  const left = at(panels, "left");
  const [leftId, setLeftId] = useState(left[0]?.id);
  const shown = left.find((p) => p.id === leftId) ?? left[0];
  return (
    <div className="shell shell--wide">
      <SketchFrame as="header" seed="shell-status" radius={12} shadow={0.4} className="shell__status">
        {status}
      </SketchFrame>
      {shown && (
        <SketchFrame as="aside" seed="shell-left" radius={16} shadow={0.5} className="shell__left" aria-label="Crew, case, notes and chat">
          <div className="shell__seg" role="group" aria-label="Side panel">
            {left.map((p) => (
              <Button
                key={p.id}
                variant="toggle"
                seed={`shell-tab-${p.id}`}
                pressed={p.id === shown.id}
                aria-label={p.tab?.badge ? `${p.title}, ${p.tab.badge} new` : p.title}
                onClick={() => setLeftId(p.id)}
              >
                {p.title}
                {!!p.tab?.badge && (
                  <b className="shell__count" aria-hidden="true">
                    {p.tab.badge}
                  </b>
                )}
              </Button>
            ))}
          </div>
          <div className="shell__scroll">{shown.node}</div>
        </SketchFrame>
      )}
      <main className="shell__centre">
        <section className="shell__board" aria-label="Bank board">
          {board}
        </section>
        {at(panels, "centre").map((p) => (
          <WidePanel key={p.id} panel={p} className="shell__plan" />
        ))}
      </main>
      <div className="shell__right">
        {at(panels, "right").map((p) => (
          <WidePanel key={p.id} panel={p} />
        ))}
      </div>
    </div>
  );
}

function WidePanel({ panel, className }: { panel: ShellPanel; className?: string }) {
  return (
    <SketchFrame as="section" seed={`shell-${panel.id}`} radius={16} shadow={0.5} className={["shell__panel", className].filter(Boolean).join(" ")} aria-labelledby={`shell-${panel.id}-h`}>
      <h2 id={`shell-${panel.id}-h`}>{panel.title}</h2>
      <div className="shell__scroll">{panel.node}</div>
    </SketchFrame>
  );
}

function NarrowShell({ status, board, dock, panels, open, onOpen }: GameShellProps) {
  const sheet = panels.find((p) => p.id === open);
  return (
    <div className="shell shell--narrow">
      <SketchFrame as="header" seed="shell-status" radius={12} shadow={0.4} className="shell__status">
        {status}
      </SketchFrame>
      <main className="shell__board" aria-label="Bank board">
        {board}
      </main>
      <div className="shell__bar">
        {dock && (
          <SketchFrame seed="shell-dock" radius={14} shadow={0.5} className="shell__dock">
            {dock}
          </SketchFrame>
        )}
        <nav className="shell__tabs" aria-label="Game panels">
          {panels
            .filter((p) => p.tab)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                aria-haspopup="dialog"
                aria-label={p.tab?.badge ? `${p.title}, ${p.tab.badge} new` : p.title}
                onClick={() => onOpen(p.id)}
              >
                {p.tab?.icon}
                <span>{p.title}</span>
                {!!p.tab?.badge && (
                  <b className="shell__count" aria-hidden="true">
                    {p.tab.badge}
                  </b>
                )}
              </button>
            ))}
        </nav>
      </div>
      <BottomSheet open={!!sheet} onClose={() => onOpen(null)} title={sheet?.title ?? ""} seed={`shell-sheet-${sheet?.id ?? ""}`}>
        {sheet?.node}
      </BottomSheet>
    </div>
  );
}
