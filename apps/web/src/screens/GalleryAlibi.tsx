// /dev/gallery: the alibi pop-up, the snapshot card on a 12-crook round (a raided Vault, a
// Lobby that rang with nobody in it, a "Shift change" card, 4 coins missing), the trust-mark
// pop-over in each of its states and the card's key, closed and open (design §10). No server.
import { BANK_JOB, type RoomId } from "@skimjob/content";
import type { AlibiMark, PlayerId } from "@skimjob/engine";
import { useState } from "react";
import { AlibiPopup } from "../components/AlibiPopup";
import { Button } from "../components/Button";
import { CardKey, MarkPopover, SnapshotCard } from "../components/SnapshotCard";
import { SketchFrame } from "../components/SketchFrame";
import { Underline } from "../components/Underline";
import type { SeatLook } from "../game/board";
import type { Snapshot, SnapshotRoom } from "../game/snapshot";

const NAMES = ["Sam", "Ava", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jo", "Kit"];
const CREW: ReadonlyMap<PlayerId, SeatLook> = new Map(NAMES.map((name, i) => [`p${i + 1}`, { look: i, name, bot: false, tag: name.slice(0, 2) }]));
const ROOMS = (["rooftop", "security", "office", "managersOffice", "serverRoom", "lobby", "vault", "depositBoxes"] as const).map((id) => ({ id, name: BANK_JOB.rooms[id]!.name }));

const room = (id: RoomId, bell: SnapshotRoom["bell"], crooks: [number, "says" | "fact"][], extra: Partial<SnapshotRoom> = {}): SnapshotRoom => ({
  id,
  name: BANK_JOB.rooms[id]!.name,
  bell,
  raided: null,
  quiet: false,
  crooks: crooks.map(([seat, kind]) => ({ player: `p${seat}`, kind })),
  ...extra,
});
const SNAP: Snapshot = {
  round: 4,
  floors: [
    [room("rooftop", 0, [[3, "says"], [9, "fact"]])],
    [room("security", 0, [[2, "says"]]), room("office", 2, [[1, "says"], [4, "says"]]), room("managersOffice", 1, [[5, "fact"]]), room("serverRoom", "hidden", [[6, "says"]])],
    [room("lobby", 1, [], { quiet: true })],
    [room("vault", 5, [[7, "says"], [8, "says"], [10, "fact"], [11, "says"], [12, "says"]], { raided: 3 }), room("depositBoxes", 2, [])],
  ],
  card: "shiftChange",
  missing: 4,
};

export function AlibiSection() {
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<ReadonlyMap<string, AlibiMark>>(new Map([["4/p3", "trusted"], ["4/p5", "liar"]]));
  return (
    <SketchFrame as="section" seed="g-alibi" radius={16} shadow={0.5} className="g-section" aria-labelledby="g-alibi">
      <header className="g-section__head">
        <h3 id="g-alibi">
          <Underline seed="alibi">Alibis and the snapshot card</Underline>
        </h3>
        <p className="meta">design §10 · the pop-up, a 12-crook card, the trust-mark pop-over and the key</p>
      </header>
      <div className="g-row">
        <Button variant="secondary" seed="g-alibi-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          Open the alibi pop-up
        </Button>
      </div>
      <AlibiPopup round={open ? 4 : null} rooms={ROOMS} left={{ text: "0:14", share: 0.7 }} onPost={async () => setOpen(false)} />
      <SnapshotCard
        snap={SNAP}
        crew={CREW}
        me="p1"
        marks={marks}
        bulbs={BANK_JOB.alarm.bulbs}
        onMark={(round, target, mark) =>
          setMarks((m) => {
            const next = new Map(m);
            if (mark) next.set(`${round}/${target}`, mark);
            else next.delete(`${round}/${target}`);
            return next;
          })
        }
      />
      <CardKey />
      <CardKey defaultOpen />
      <div className="g-row">
        {([null, "trusted", "liar"] as const).map((m) => (
          <PopoverDemo key={m ?? "none"} mark={m} />
        ))}
      </div>
    </SketchFrame>
  );
}

/** The pop-over in one state, opened at its button. */
function PopoverDemo({ mark }: { mark: AlibiMark | null }) {
  const [at, setAt] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button variant="small" seed={`g-mark-${mark ?? "none"}`} onClick={(e) => setAt(e.currentTarget)}>
        Pop-over: {mark === null ? "unmarked" : mark === "trusted" ? "Trusted" : "Liar"}
      </Button>
      {at && <MarkPopover name="Ava" mark={mark} anchor={at} onPick={() => setAt(null)} onClose={() => setAt(null)} />}
    </>
  );
}
