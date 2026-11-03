// "My games" (m2-plan M2-12): the games a signed-in player holds a seat in, each a link back in.
import type { MyGame, SessionLength } from "../api";
import { linkClick } from "../router";
import { Chip } from "./Chip";
import { SketchFrame } from "./SketchFrame";

const STATUS: Record<MyGame["status"], { label: string; colour: string }> = {
  lobby: { label: "In the lobby", colour: "var(--sky)" },
  running: { label: "Under way", colour: "var(--clay)" },
  ended: { label: "Finished", colour: "var(--mute)" },
};
const LENGTH: Record<SessionLength, string> = { quick: "15 min", "1h": "1 hour", "3h": "3 hours", "1d": "1 day", "3d": "3 days", "1w": "1 week" };

export const myGameHref = (g: Pick<MyGame, "id" | "status">) => `/${g.status === "lobby" ? "lobby" : "game"}/${encodeURIComponent(g.id)}`;

export function MyGames({ games, seed = "my-games" }: { games: readonly MyGame[]; seed?: string }) {
  return (
    <SketchFrame as="section" seed={seed} radius={16} fill="var(--paper-hi)" shadow={0.45} className="mygames" aria-labelledby={`${seed}-title`}>
      <h2 id={`${seed}-title`} className="mygames__title">
        My games
      </h2>
      {games.length === 0 ? (
        <p className="meta">No jobs yet. Plan a heist, or join one with an invite code.</p>
      ) : (
        <ul className="mygames__list">
          {games.map((g) => {
            const status = STATUS[g.status];
            return (
              <li key={g.id}>
                <a className="mygames__item" href={myGameHref(g)} onClick={linkClick}>
                  <span className="mygames__who">
                    <span className="mygames__name">{g.nickname}</span>
                    <span className="meta">
                      {g.youAreHost ? "You're the host" : `${g.host ?? "Someone"}'s crew`} · {g.seats} {g.seats === 1 ? "seat" : "seats"} · {LENGTH[g.sessionLength] ?? g.sessionLength}
                    </span>
                  </span>
                  <Chip colour={status.colour}>{status.label}</Chip>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </SketchFrame>
  );
}
