// The game menu (design §15.6): the settings that live inside a game. Today
// that is the Tips setting, the same one as on the landing page, and the
// host's controls (design §16), passed in as `children`.
import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { DialogSheet } from "./MeetingKit";
import { TipsToggle } from "./TipsToggle";

export function GameMenu({ tips, busy, onChange, children }: { tips: boolean; busy: boolean; onChange: (on: boolean) => void; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="small" seed="game-menu-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Menu
      </Button>
      <DialogSheet open={open} onClose={() => setOpen(false)} seed="game-menu" labelledBy="game-menu-h">
        <h2 id="game-menu-h">Game menu</h2>
        <TipsToggle tips={tips} busy={busy} onChange={onChange} />
        {children}
        <Button variant="small" seed="game-menu-close" onClick={() => setOpen(false)}>
          Close
        </Button>
      </DialogSheet>
    </>
  );
}
