// The pin writer: in order, newest list wins, a refusal shows the server's list. design §15.4
import { describe, expect, it } from "vitest";
import { pinSync, type PinIo } from "./pinSync";

/** A server whose writes finish when the test says so (in any order). */
function fakeServer(initial: string[] = []) {
  let saved: readonly string[] = initial;
  const puts: { list: readonly string[]; done: () => void; fail: (e: unknown) => void }[] = [];
  const io: PinIo = {
    put: (list) =>
      new Promise((resolve, reject) => {
        puts.push({ list, done: () => ((saved = list), resolve()), fail: reject });
      }),
    load: async () => saved,
  };
  return { io, puts, saved: () => saved };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("pin writes (design §15.4)", () => {
  it("sends one write at a time, so two quick taps can't land out of order, and the last choice is what's saved", async () => {
    const s = fakeServer();
    const shown: (readonly string[])[] = [];
    const sync = pinSync(s.io, [], (l) => shown.push(l), () => {});
    sync.toggle("a");
    sync.toggle("b");
    await tick();
    // Only the first write is out; the second waits for it.
    expect(s.puts.map((p) => p.list)).toEqual([["a"]]);
    s.puts[0]!.done();
    await tick();
    expect(s.puts.map((p) => p.list)).toEqual([["a"], ["a", "b"]]);
    s.puts[1]!.done();
    await tick();
    expect(s.saved()).toEqual(["a", "b"]);
    expect(shown.at(-1)).toEqual(["a", "b"]);
  });

  it("sends only the newest list after a burst of taps", async () => {
    const s = fakeServer();
    const sync = pinSync(s.io, [], () => {}, () => {});
    for (const id of ["a", "b", "c", "a"]) sync.toggle(id);
    await tick();
    s.puts[0]!.done();
    await tick();
    expect(s.puts.map((p) => p.list)).toEqual([["a"], ["b", "c"]]);
  });

  it("after a refusal (429) shows what the server really holds, not a refused pin, then works again", async () => {
    const s = fakeServer(["x"]);
    const shown: (readonly string[])[] = [];
    const errors: unknown[] = [];
    const sync = pinSync(s.io, ["x"], (l) => shown.push(l), (e) => errors.push(e));
    sync.toggle("a");
    sync.toggle("b"); // waits behind the first
    await tick();
    s.puts[0]!.fail(new Error("429"));
    await tick();
    expect(shown.at(-1)).toEqual(["x"]);
    expect(errors).toHaveLength(1);
    // The second tap's write was dropped with the rollback; nothing else is sent.
    expect(s.puts).toHaveLength(1);
    sync.toggle("c");
    await tick();
    expect(s.puts.at(-1)!.list).toEqual(["x", "c"]);
    s.puts.at(-1)!.done();
    await tick();
    expect(s.saved()).toEqual(["x", "c"]);
  });

  it("falls back to the last saved list when the server can't be asked either", async () => {
    const shown: (readonly string[])[] = [];
    const io: PinIo = { put: () => Promise.reject(new Error("down")), load: () => Promise.reject(new Error("down")) };
    const sync = pinSync(io, ["x"], (l) => shown.push(l), () => {});
    sync.toggle("a");
    await tick();
    expect(shown).toEqual([["x", "a"], ["x"]]);
  });
});
