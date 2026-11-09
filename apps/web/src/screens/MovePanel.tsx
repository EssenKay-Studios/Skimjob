// The move panel: pick a room, grab coins, drag each coin into the duffel or
// your pocket, with previews (the bell bulbs your grab lights, what the duffel
// adds to the share, "the bank may run short"), and use your role's power.
// design §3.2, §5.2, §11.1; mockup 1b
import { useMemo, useState } from "react";
import { ROLE_TEXT } from "@skimjob/content";
import type { Move, PlayerId, PlayerView, RoomId } from "@skimjob/engine";
import { MarketButton } from "../components/BlackMarket";
import { AlarmBell } from "../components/Bell";
import { CoinBags } from "../components/CoinBags";
import { Button } from "../components/Button";
import { InfoTip } from "../components/InfoTip";
import { Play } from "../components/icons";
import { SketchFrame } from "../components/SketchFrame";
import { Underline } from "../components/Underline";
import { useCountdown, type ClientCommand, type Reply } from "../game/useGame";
import { defaultRoom, justMissed, namesOf, roomOptions, type Timer } from "../game/hud";
import { abilityOf, bagsOf, bellPreview, grabOf, mayRunShort, moveCoin, powerControl, sameMove, shareEach, type PowerControl } from "../game/move";
import { roomName } from "../game/describeEvent";

export interface MovePanelProps {
  readonly view: PlayerView;
  readonly round: number;
  readonly timers: readonly Timer[];
  readonly offset: number;
  readonly send: (cmd: ClientCommand, done?: string) => Promise<Reply>;
  /** The room picked (here or on the bank board) for the round being planned, not yet locked in. */
  readonly pick: { readonly room: RoomId | null; readonly setRoom: (room: RoomId) => void };
}

/** What a room power points at: rooms (up to `control.pick`) or one other player. Optional: pick nothing to skip it. */
function PowerPick({ view, control, names, rooms, player, onRooms, onPlayer }: {
  view: PlayerView;
  control: PowerControl;
  names: ReadonlyMap<RoomId, string>;
  rooms: readonly RoomId[];
  player: PlayerId | null;
  onRooms: (rooms: readonly RoomId[]) => void;
  onPlayer: (player: PlayerId | null) => void;
}) {
  const role = ROLE_TEXT[view.me.role];
  const toggleRoom = (r: RoomId) => onRooms(rooms.includes(r) ? rooms.filter((x) => x !== r) : control.target === "room" ? [...rooms, r].slice(-control.pick) : rooms);
  return (
    <div className="move__power">
      <div className="move__power-head">
        <span className="hand">Your power · {role?.name ?? view.me.role}</span>
        <InfoTip info={{ kind: "role", id: view.me.role }} />
      </div>
      <p className="meta">{role?.power}</p>
      <div className="move__chips" role="group" aria-label={`${role?.name ?? "Role"} power target`}>
        {control.target === "room"
          ? control.rooms.map((r) => (
              <Button key={r} variant="toggle" seed={`power-${r}`} data-power-room={r} pressed={rooms.includes(r)} onClick={() => toggleRoom(r)}>
                {names.get(r) ?? roomName(r)}
              </Button>
            ))
          : control.players.map((id) => (
              <Button key={id} variant="toggle" seed={`power-${id}`} pressed={player === id} onClick={() => onPlayer(player === id ? null : id)}>
                {namesOf(view)(id)}
              </Button>
            ))}
      </div>
      {control.target === "room" && control.rooms.length === 0 && <p className="meta">No room to use it on right now.</p>}
    </div>
  );
}

export function MovePanel({ view, round, timers, offset, send, pick }: MovePanelProps) {
  const options = useMemo(() => roomOptions(view), [view]);
  const names = useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);
  const control = useMemo(() => powerControl(view), [view]);
  const mine = view.me.move;
  const { room, setRoom } = pick;
  const [wanted, setWanted] = useState<number | null>(mine ? mine.duffel + mine.pocket : null);
  const [pocket, setPocket] = useState(mine?.pocket ?? 0);
  const [watch, setWatch] = useState<RoomId | null>(mine?.watch ?? null);
  const [powerRooms, setPowerRooms] = useState<readonly RoomId[]>(() => {
    const a = mine?.ability;
    return a?.kind === "lookout" ? [...a.rooms] : a && "room" in a ? [a.room] : [];
  });
  const [powerPlayer, setPowerPlayer] = useState<PlayerId | null>(mine?.ability?.kind === "absolve" ? mine.ability.target : null);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const countdown = useCountdown(timers, `round:${round}`, offset);
  const picked = options.find((o) => o.id === room) ?? null;
  const grab = picked ? grabOf(picked.coins, wanted) : 0;
  const bags = bagsOf(grab, pocket);
  const missed = justMissed(view);
  const ability = abilityOf(control, powerRooms, powerPlayer);
  const move: Move | null = picked && picked.closed === null && (!picked.watcher || watch) ? { room: picked.id, duffel: bags.duffel, pocket: bags.pocket, ...(picked.watcher && watch ? { watch } : {}), ...(ability ? { ability } : {}) } : null;
  const changed = !mine || !sameMove(mine, move);
  const preview = picked && grab > 0 ? bellPreview(view, picked, grab) : null;

  const lock = async () => {
    if (!move) return;
    setBusy(true);
    // design §3.2: the grab is the coins in the two bags.
    await send({ type: "submitMove", move }, mine ? "Move updated." : "Locked in.");
    setBusy(false);
  };

  return (
    <SketchFrame as="section" seed="game-move" radius={18} shadow={0.5} className="panel move" aria-labelledby="move-h">
      <div className="panel__head">
        <h2 id="move-h" className="panel__title">
          <Underline seed={`move-${round}`}>Round {round} · Pick your room</Underline>
        </h2>
        {countdown && <span className="meta">locks in {countdown.text}</span>}
      </div>
      {missed && (
        <p className="move__missed" role="status">
          {missed.room === null
            ? `You missed round ${missed.round}: the default room is taped off, so you sat the round out.`
            : `You missed round ${missed.round}: the default move sent you to the ${roomName(missed.room)}, handing everything in.`}
        </p>
      )}
      {/* design §3.2: computed from public information (the bank, the rooms in play, the crew size). */}
      {mayRunShort(view, options) && (
        <p className="move__short" role="status">
          The bank may run short this round: grabs can be cut ({view.bank} coins left).
        </p>
      )}
      {picked && !changing ? (
        <div className="move__room">
          <h3 className="move__room-name">{picked.name}</h3>
          <InfoTip info={{ kind: "room", id: picked.id }} />
          {picked.notes.filter((n) => n !== "watch one room").map((n) => (
            <span key={n} className="meta">
              {n}
            </span>
          ))}
          <span className="move__fill" />
          <Button variant="ghost" seed="room-change" onClick={() => setChanging(true)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="move__chips" role="group" aria-label="Rooms">
          {options.map((o) => (
            <Button
              key={o.id}
              variant="toggle"
              seed={`room-${o.id}`}
              data-room={o.name}
              pressed={room === o.id}
              disabled={o.closed !== null}
              onClick={() => {
                setRoom(o.id);
                setChanging(false);
              }}
            >
              {o.name}
            </Button>
          ))}
        </div>
      )}
      {options.filter((o) => o.closed !== null).map((o) => (
        <p key={o.id} className="meta">
          {o.name}: {o.closed}
        </p>
      ))}
      {picked?.watcher && (
        <div className="move__watch">
          <p className="meta">Which room do the cameras watch?</p>
          <div className="move__chips" role="group" aria-label="Room to watch">
            {options
              .filter((o) => o.id !== picked.id)
              .map((o) => (
                <Button key={o.id} variant="toggle" seed={`watch-${o.id}`} pressed={watch === o.id} onClick={() => setWatch(o.id)}>
                  {o.name}
                </Button>
              ))}
          </div>
        </div>
      )}
      {picked && picked.coins === 0 && <p className="meta">No coins to grab here.</p>}
      {picked && preview && (
        <>
          <CoinBags
            limit={picked.coins}
            grab={grab}
            bags={bags}
            onGrab={setWanted}
            onMove={(bag) => setPocket(moveCoin(bags, bag).pocket)}
            bell={<AlarmBell bulbs={preview.bulbs} lit={preview.lit ?? 0} preview={preview.adds} hidden={preview.lit === null} />}
          />
          {/* design §5.3: the others' rings are unknown, so only your own grab is warned about. */}
          {preview.raid && <p className="move__warn">Your grab alone would light the last bulb: a raid, and you'd lose the grab.</p>}
          <p className="meta move__share" aria-live="polite">
            {bags.duffel > 0
              ? `Share is ${view.share}. Your ${bags.duffel} duffel ${bags.duffel === 1 ? "coin adds" : "coins add"} about ${Math.round(shareEach(view, bags.duffel) * 10) / 10} to each share.`
              : `Share is ${view.share}. Nothing from you goes to the share.`}
          </p>
        </>
      )}
      {control && <PowerPick view={view} control={control} names={names} rooms={powerRooms} player={powerPlayer} onRooms={setPowerRooms} onPlayer={setPowerPlayer} />}
      <div className="move__foot">
        {view.shop.length > 0 && <MarketButton view={view} send={send} />}
        <Button variant="primary" seed="lock" icon={<Play />} disabled={!move || busy || !changed} onClick={lock} className="move__lock">
          {mine && !changed ? "Locked in" : mine ? "Update move" : "Lock it in"}
        </Button>
        <p className="meta move__status" aria-live="polite">
          {mine
            ? `Locked in: ${roomName(mine.room)}${mine.pocket > 0 ? `, pocket ${mine.pocket}` : ", all to the duffel"}. You can change it until the deadline.`
            : `Miss the deadline and you go to the ${roomName(defaultRoom(view))}, handing everything in.`}
        </p>
      </div>
    </SketchFrame>
  );
}
