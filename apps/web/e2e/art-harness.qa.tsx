// QA (PR #33, M2-9): a dev-only harness for the art, so e2e can place 1/6/12 crooks
// in one room or across rooms. Served by vite at /e2e/art-harness.qa.html; never built.
// Query: tier=small|mid|big  n=<crooks>  spread=one|all  time=day|dusk|night  lock=1  layout=auto|wide|stacked
//        bells=lit|preview|hidden (every open room, lit = its index)  taped=1 (Deposit boxes, else Office)  pile=<0..1>
import { createRoot } from "react-dom/client";
import "../src/theme.css";
import "../src/art/art.css";
import { BankCutaway, CORE_ROOMS, type BankOccupant, type RoomBell, type TimeOfDay } from "../src/art/BankCutaway";
import { BANK_ROOMS } from "../src/art/bankLayout";
import { CrookAvatar } from "../src/art/Crook";

const q = new URLSearchParams(location.search);
const tier = q.get("tier") ?? "big";
const rooms: readonly string[] = tier === "small" ? CORE_ROOMS : tier === "mid" ? [...CORE_ROOMS, "depositBoxes", "serverRoom"] : BANK_ROOMS;
const n = Number(q.get("n") ?? 0);
const NAMES = ["Mara", "Dez", "Lou", "Priya", "Otto", "Sam", "Ines", "Kofi", "Wren", "Bea", "Juno", "Tam"];
const occupants: Record<string, BankOccupant[]> = {};
for (let i = 0; i < n; i++) {
  const room = q.get("spread") === "all" ? rooms[i % rooms.length]! : "vault";
  (occupants[room] ??= []).push({ id: `p${i}`, name: NAMES[i]!, look: i, bot: i === 5 });
}
const tapedRoom = rooms.includes("depositBoxes") ? "depositBoxes" : "office";
const mode = q.get("bells");
const bells = Object.fromEntries(
  rooms.filter((r) => !q.get("taped") || r !== tapedRoom).map((r, i): [string, RoomBell] => [r, mode === "hidden" ? { lit: 0, hidden: true } : mode === "preview" ? { lit: i % 4, preview: 2 } : { lit: i % 4 }]),
);
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 12 }}>
    <BankCutaway
      rooms={rooms}
      time={(q.get("time") ?? "day") as TimeOfDay}
      layout={(q.get("layout") ?? "auto") as "auto"}
      selected="vault"
      onRoomSelect={() => {}}
      closed={q.get("lock") ? ["office", "lobby"] : []}
      {...(mode && { bells })}
      {...(q.get("taped") && { taped: { [tapedRoom]: 2 } })}
      {...(q.get("pile") && { pile: Number(q.get("pile")) })}
      occupants={occupants}
    />
    <div id="avatars" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
      {NAMES.map((name, i) => (
        <CrookAvatar key={name} name={name} look={i} size={48} />
      ))}
    </div>
  </main>,
);
