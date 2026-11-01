// Starts a game through the lobby API (M2-2) from inside a browser context, so
// the context's cookie is the host's session. The lobby screens (M2-5b) do the
// same with clicks; the game screen tests only need a started game.
import { expect, type APIRequestContext } from "@playwright/test";

export interface StartedGame {
  readonly id: string;
  readonly inviteCode: string;
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/**
 * Signs `host` in as a guest, creates a game, seats `guests` (each signed in
 * through the invite) and `bots` bots, and starts it.
 */
export async function startGame(
  host: APIRequestContext,
  {
    bots,
    guests = [],
    sessionLength = "quick",
    nickname = "Host",
    voteVisibility,
  }: { bots: number; guests?: readonly APIRequestContext[]; sessionLength?: string; nickname?: string; voteVisibility?: "hiddenThenRevealed" | "open" | "secret" },
): Promise<StartedGame> {
  await ok(await host.post("/api/auth/guest", { data: { nickname } }));
  const settings = { sessionLength, ...(voteVisibility && { voteVisibility }) };
  const game = await ok<StartedGame>(await host.post("/api/games", { data: { settings } }));
  for (const [i, g] of guests.entries()) await ok(await g.post(`/api/invites/${game.inviteCode}/join`, { data: { nickname: `Guest ${i + 1}` } }));
  for (let i = 0; i < bots; i++) await ok(await host.post(`/api/games/${game.id}/bots`, { data: {} }));
  await ok(await host.post(`/api/games/${game.id}/start`, { data: {} }));
  return game;
}
