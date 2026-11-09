// Role cards (design §11, §15.6, §20.2): your own card as a dialog (power, how
// you win, how to spot it, Claim and Use power) and the "Roles in play" panel
// whose chips each open that role's card, so you can read what the others might be.
import { useId, useState, type ReactNode } from "react";
import type { PlayerView } from "@skimjob/engine";
import { CrookAvatar } from "../art/Crook";
import { RoleIcon } from "../art/RoleIcon";
import { seatLooks } from "../game/board";
import { namesOf } from "../game/hud";
import { abilityFor, abilityTargets, explainSpot, roleInfo, roleListInfo, rolesOf, type RoleInfo } from "../game/roles";
import type { ClientCommand, Reply } from "../game/useGame";
import { Button } from "./Button";
import { InfoTip } from "./InfoTip";
import { DialogSheet } from "./MeetingKit";
import "./rolecard.css";

type Send = (cmd: ClientCommand, done?: string) => Promise<Reply>;

/** A role's icon, name, badges and the three lines, as on a card. `as` is the name's heading level. */
export function RoleCardBody({ info, as: Name = "h3", id }: { info: RoleInfo; as?: "h2" | "h3"; id?: string }) {
  return (
    <div className="rolecard__body">
      <div className="rolecard__title">
        <RoleIcon role={info.id} size={32} />
        <Name id={id} className="rolecard__name">
          {info.name}
        </Name>
        <InfoTip info={{ kind: "role", id: info.id }} />
      </div>
      <p className="rolecard__badges">
        <span className={`tag tag--${info.kind}`}>{info.kindLabel}</span>
        <span className="tag tag--cadence">{info.cadence}</span>
      </p>
      <dl className="rolecard__facts">
        <div>
          <dt>Power</dt>
          <dd>{info.power}</dd>
        </div>
        <div>
          <dt>How you win</dt>
          <dd>
            {info.howYouWin}
            <span className="meta rolecard__bust">{info.bust}</span>
          </dd>
        </div>
        <div>
          <dt>How to spot it</dt>
          <dd>{info.spot}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Detective and Auditor use their power from the card (`useAbility`); the rest choose it in their move. design §11.1, §17.2 */
function UsePower({ view, info, send, onClose }: { view: PlayerView; info: RoleInfo; send: Send; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const panel = useId();
  if (info.use === "passive") return null;
  const icon = <RoleIcon role={info.id} size={22} />;
  if (info.use === "move")
    return (
      <Button
        variant="primary"
        seed="role-power"
        icon={icon}
        onClick={() => {
          onClose();
          document.getElementById("move-h")?.scrollIntoView({ block: "center" });
        }}
      >
        Use power
      </Button>
    );
  const targets = abilityTargets(view, info.id);
  const use = async (target: string) => {
    setBusy(true);
    const r = await send({ type: "useAbility", ability: abilityFor(info.id, target) }, "Power used: see your case file.");
    setBusy(false);
    if (r.ok) onClose();
  };
  return (
    <>
      <Button variant="primary" seed="role-power" icon={icon} aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        {open ? "Never mind" : "Use power"}
      </Button>
      {open && (
        <div id={panel} className="rolecard__targets" role="group" aria-label={info.id === "detective" ? "Player to check" : "Room to audit"}>
          {targets.map((t) => (
            <Button key={t.id} variant="small" seed={`power-${t.id}`} disabled={busy} onClick={() => use(t.id)}>
              {t.name}
            </Button>
          ))}
        </div>
      )}
    </>
  );
}

export interface RoleCardDialogProps {
  readonly view: PlayerView;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly send: Send;
  /** The Claim control, which knows the claim rules (meetings screen). */
  readonly claim: ReactNode;
}

/** Your role card: secret, only you see it. */
export function RoleCardDialog({ view, open, onClose, send, claim }: RoleCardDialogProps) {
  const info = roleInfo(view.me.role, rolesOf(view));
  const look = seatLooks(view).get(view.me.id)?.look ?? 0;
  if (!info) return null;
  return (
    <DialogSheet open={open} onClose={onClose} seed="role-card-dialog" labelledBy="role-card-h">
      <div className="rolecard">
        <div className="rolecard__top">
          <p className="kicker">Your role · secret</p>
          <Button variant="small" seed="role-card-close" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="rolecard__main">
          <div className="rolecard__tile" aria-hidden="true">
            <CrookAvatar name={namesOf(view)(view.me.id)} look={look} size={92} />
          </div>
          <RoleCardBody info={info} as="h2" id="role-card-h" />
        </div>
        <div className="rolecard__actions">
          {claim}
          <UsePower view={view} info={info} send={send} onClose={onClose} />
        </div>
      </div>
    </DialogSheet>
  );
}

/** "Roles in play": one chip per role the host's list shows; a tap opens that role's card beneath. design §11.3, §15.6 */
export function RolesInPlay({ view }: { view: PlayerView }) {
  const list = roleListInfo(view);
  const roles = rolesOf(view);
  const [shown, setShown] = useState<string | null>(null);
  const head = useId();
  const info = shown ? roleInfo(shown, roles) : undefined;
  return (
    <section className="rolesinplay" aria-labelledby={head}>
      <header className="rolesinplay__head">
        <h3 id={head}>{list.title}</h3>
        <p className="meta">{list.note}</p>
      </header>
      {list.roles.length > 0 && (
        <ul className="rolesinplay__chips" aria-label={list.title}>
          {list.roles.map(({ id, count }) => (
            <li key={id}>
              <Button
                variant="toggle"
                seed={`rip-${id}`}
                icon={<RoleIcon role={id} size={20} />}
                pressed={shown === id}
                onClick={() => setShown(shown === id ? null : id)}
              >
                {roles[id]?.name ?? id}
                {count > 1 ? ` ×${count}` : ""}
                {id === view.me.role ? " (you)" : ""}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {info && <RoleCardBody info={info} />}
      {info && shown !== view.me.role && <p className="meta rolesinplay__why">{explainSpot(view, info.id)}</p>}
    </section>
  );
}
