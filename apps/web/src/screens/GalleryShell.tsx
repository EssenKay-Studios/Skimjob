// /dev/gallery: the one-screen layout shell and the bottom sheet. The shell's
// full-page demo lives at /dev/gallery/shell (placeholders in every region; the
// game's content arrives in S4).
import { useState, type ReactNode } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { Button } from "../components/Button";
import { GameShell, type ShellPanel } from "../components/GameShell";
import { ArrowBack, Bubble, Clock, Evidence, Star } from "../components/icons";
import { SketchFrame } from "../components/SketchFrame";
import { Underline } from "../components/Underline";
import { CaseBoardDemo } from "./GalleryNotes";
import { navigate } from "../router";
import { TopBar } from "./TopBar";

const Placeholder = ({ children }: { children: ReactNode }) => <p className="meta">{children}</p>;

const PANELS: readonly ShellPanel[] = [
  { id: "crew", title: "Crew", place: "left", tab: { icon: <Star /> }, node: <Placeholder>Seats and who has locked in.</Placeholder> },
  { id: "case", title: "Case", place: "left", tab: { icon: <Evidence /> }, node: <CaseBoardDemo seed="shell-case" /> },
  { id: "chat", title: "Chat", place: "left", tab: { icon: <Bubble />, badge: 3 }, node: <Placeholder>The crew chat.</Placeholder> },
  { id: "round", title: "This round", place: "right", tab: { icon: <Clock /> }, node: <Placeholder>Your move and its preview.</Placeholder> },
  { id: "pick", title: "Pick a room", place: "sheet", node: <Placeholder>The rooms to choose from.</Placeholder> },
  { id: "grab", title: "Grab and split", place: "sheet", node: <Placeholder>Coins, the duffel and your pocket.</Placeholder> },
];

/** The shell with placeholders in every region, on its own page. */
export function ShellDemo() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="page">
      <TopBar>
        <Button variant="back" seed="shell-back" icon={<ArrowBack />} onClick={() => navigate("/dev/gallery")}>
          Gallery
        </Button>
      </TopBar>
      <GameShell
        status={<span className="hand">Round 5 of 12 · Bank 58/96</span>}
        board={
          <SketchFrame seed="shell-board" radius={16} shadow={0.5} className="shell-demo__board">
            <Placeholder>The bank board</Placeholder>
          </SketchFrame>
        }
        dock={
          <>
            <span className="hand">Office</span>
            <span className="shell__fill" />
            <Button variant="small" seed="shell-pick" onClick={() => setOpen("pick")}>
              Change
            </Button>
            <Button variant="primary" seed="shell-grab" onClick={() => setOpen("grab")}>
              Grab coins
            </Button>
          </>
        }
        panels={PANELS}
        open={open}
        onOpen={setOpen}
      />
    </div>
  );
}

export function ShellSection() {
  const [open, setOpen] = useState(false);
  return (
    <SketchFrame as="section" seed="g-shell" radius={16} shadow={0.5} className="g-section" aria-labelledby="g-shell">
      <header className="g-section__head">
        <h3 id="g-shell">
          <Underline seed="shell">Game shell and bottom sheet</Underline>
        </h3>
        <p className="meta">design §15.6 · three columns from 1024 px, a tab bar and sheets below</p>
      </header>
      <div className="g-row">
        <Button variant="primary" seed="g-shell-open" onClick={() => navigate("/dev/gallery/shell")}>
          Open the shell demo
        </Button>
        <Button variant="secondary" seed="g-sheet-open" onClick={() => setOpen(true)}>
          Open a bottom sheet
        </Button>
      </div>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Pick a room" seed="g-sheet">
        <p>Esc, the close button or a tap outside closes it. Focus goes back to the button that opened it.</p>
      </BottomSheet>
    </SketchFrame>
  );
}
