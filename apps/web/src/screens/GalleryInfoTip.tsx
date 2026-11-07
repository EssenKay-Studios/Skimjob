// /dev/gallery: the InfoTip, one of each kind of thing it explains, at the edge
// of the page and inside a bottom sheet (design §15.6, §20.5).
import { useState } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { Button } from "../components/Button";
import { InfoTip } from "../components/InfoTip";
import { SketchFrame } from "../components/SketchFrame";
import { Underline } from "../components/Underline";
import type { InfoRef } from "@skimjob/content";

const SAMPLES: readonly { readonly label: string; readonly info: InfoRef }[] = [
  { label: "Duffel", info: { kind: "term", id: "duffel" } },
  { label: "Stash", info: { kind: "term", id: "stash" } },
  { label: "Bell", info: { kind: "tip", id: "bell" } },
  { label: "Vault", info: { kind: "room", id: "vault" } },
  { label: "Mole", info: { kind: "role", id: "mole" } },
  { label: "Soft shoes", info: { kind: "perk", id: "softShoes" } },
  { label: "Lockdown", info: { kind: "event", id: "lockdown" } },
];

export function InfoTipSection() {
  const [open, setOpen] = useState(false);
  return (
    <SketchFrame as="section" seed="g-infotip" radius={16} shadow={0.5} className="g-section" aria-labelledby="g-infotip">
      <header className="g-section__head">
        <h3 id="g-infotip">
          <Underline seed="infotip">InfoTip</Underline>
        </h3>
        <p className="meta">design §15.6, §20.5 · tap, hover or focus · the line comes from content</p>
      </header>
      <ul className="g-row g-infotips">
        {SAMPLES.map((s) => (
          <li key={s.label} className="g-infotips__item">
            <span className="hand">{s.label}</span>
            <InfoTip info={s.info} />
          </li>
        ))}
      </ul>
      <div className="g-row g-infotips__edge">
        <Button variant="secondary" seed="g-infotip-sheet" onClick={() => setOpen(true)}>
          Open a sheet with a tip
        </Button>
        <InfoTip info={{ kind: "tip", id: "suspect" }} />
      </div>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Pocket" seed="g-infotip-sheet">
        <p className="g-infotips__item">
          <span>Your pocket</span>
          <InfoTip info={{ kind: "tip", id: "movePocket" }} />
        </p>
      </BottomSheet>
    </SketchFrame>
  );
}
