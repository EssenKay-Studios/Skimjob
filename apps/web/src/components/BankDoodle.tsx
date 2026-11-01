// Landing illustration: the M2-9 bank cutaway at dusk with a few of the crew
// at work (room labels and name tags off: decoration, not players; not interactive). Kept under this name so the landing
// and gallery keep importing it.
import { BankCutaway, CORE_ROOMS, type BankOccupant } from "../art/BankCutaway";

const OCCUPANTS: Partial<Record<string, readonly BankOccupant[]>> = {
  vault: [{ id: "a", name: "Mara", look: 0, expression: "smug", sack: true }],
  office: [{ id: "b", name: "Dez", look: 1, expression: "nervous" }],
  lobby: [
    { id: "c", name: "Lou", look: 2 },
    { id: "d", name: "Priya", look: 3, expression: "smug" },
  ],
  rooftop: [{ id: "e", name: "Otto", look: 4 }],
};

export function BankDoodle({ className }: { className?: string }) {
  return (
    <BankCutaway
      className={className}
      rooms={CORE_ROOMS}
      layout="wide"
      time="dusk"
      labels={false}
      nameTags={false}
      figureScale={1.3}
      occupants={OCCUPANTS}
      title="First National Bank cut away like a dollhouse, masked crooks sneaking through its rooms"
    />
  );
}
