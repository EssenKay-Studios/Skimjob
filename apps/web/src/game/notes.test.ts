// The recap's state machine (design §13, M2-10; QA on PR #46): a return from a
// hidden tab shows the recap, and nothing is marked seen that wasn't looked at.
import { describe, expect, it } from "vitest";
import { AWAY_START, awayStep, seenRetryMs, type AwayInput, type AwayState } from "./notes";

const run = (s: AwayState, ...inputs: AwayInput[]) => inputs.reduce(awayStep, s);
const tick = (top: number, news: boolean, visible = true): AwayInput => ({ type: "tick", visible, top, news });

describe("while you were away: when the mark moves (design §13)", () => {
  it("on load with news: opens the recap and keeps the mark until dismissed", () => {
    const s = run(AWAY_START, { type: "loaded", since: 5, first: false }, tick(9, true));
    expect(s).toMatchObject({ since: 5, open: true });
    expect(run(s, tick(12, true))).toMatchObject({ since: 5, open: true });
    expect(s.upTo).toBe(9);
    expect(run(s, { type: "dismiss", top: 12 })).toEqual({ since: 12, open: false, upTo: null, catchingUp: false });
  });

  it("while in front and caught up, the mark follows the view", () => {
    const s = run(AWAY_START, { type: "loaded", since: 5, first: false }, tick(5, false), { type: "caughtUp" }, tick(8, true));
    expect(s).toEqual({ since: 8, open: false, upTo: null, catchingUp: false });
  });

  it("while catching up, nothing is followed (a late view after a reconnect still gets a recap)", () => {
    let s = run(AWAY_START, { type: "loaded", since: 5, first: false }, tick(5, false));
    s = run(s, tick(6, false));
    expect(s.since).toBe(5);
    s = run(s, tick(7, true));
    expect(s).toMatchObject({ since: 5, open: true });
  });

  it("a hidden tab freezes the mark; coming back to the front shows the recap (QA bug, PR #46)", () => {
    let s = run(AWAY_START, { type: "loaded", since: 5, first: false }, { type: "caughtUp" }, tick(6, false));
    expect(s).toMatchObject({ since: 6, catchingUp: false });
    // Hidden: an emergency meeting reaches the view, but nobody is looking.
    s = run(s, tick(7, true, false), tick(8, true, false));
    expect(s).toMatchObject({ since: 6, open: false });
    // Back in front, in the same commit as the view: the recap opens, the mark stays.
    s = run(s, { type: "returned" }, tick(8, true));
    expect(s).toMatchObject({ since: 6, open: true });
    // Order matters: "returned" must be handled before the first visible tick (useAwayRecap declares
    // its visibility effect first). Without it, the tick would follow the view: the original bug.
    let t = run(AWAY_START, { type: "loaded", since: 5, first: false }, { type: "caughtUp" }, tick(8, true, false), tick(8, true));
    expect(t).toMatchObject({ since: 8 });
    t = run(AWAY_START, { type: "loaded", since: 5, first: false }, { type: "caughtUp" }, tick(8, true, false), { type: "returned" }, tick(8, true));
    expect(t).toMatchObject({ since: 5, open: true });
  });

  it("back with nothing worth saying: after catching up, the mark follows again", () => {
    const s = run(AWAY_START, { type: "loaded", since: 5, first: false }, { type: "caughtUp" }, tick(7, false, false), { type: "returned" }, tick(7, false));
    expect(s.since).toBe(5);
    expect(run(s, { type: "caughtUp" }, tick(7, false))).toMatchObject({ since: 7, open: false });
  });

  it("a first visit has nothing to catch up on: live news while loading never opens a recap", () => {
    const s = run(AWAY_START, { type: "loaded", since: 9, first: true }, tick(11, true));
    expect(s).toMatchObject({ since: 11, open: false });
  });

  it("never before the mark has loaded", () => {
    expect(run(AWAY_START, tick(9, true))).toEqual(AWAY_START);
  });

  it("retries a failed mark with growing waits, at most a minute", () => {
    expect([1, 2, 3, 10].map(seenRetryMs)).toEqual([2000, 4000, 8000, 60_000]);
  });
});
