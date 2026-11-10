// Server start-up: a bad DATABASE_URL is one clean line, not a driver stack.
// QA on PR #16.
import { describe, expect, it } from "vitest";
import { loadConfig, StartupError } from "./config";
import { databaseLabel, openDatabase, serverDeps } from "./startup";

describe("openDatabase", () => {
  it.each([
    ["unreachable", "postgres://alice:s3cret@127.0.0.1:1/skimjob", /^could not reach the database at DATABASE_URL \(127\.0\.0\.1:1\/skimjob\): .+/],
    ["malformed", "garbage", /^could not reach the database at DATABASE_URL \(an unreadable URL\): .+/],
  ])("fails with a one-line StartupError for an %s DATABASE_URL", { timeout: 20_000 }, async (_name, url, message) => {
    const err = await openDatabase(loadConfig({ DATABASE_URL: url })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartupError);
    expect((err as Error).message).toMatch(message);
    expect((err as Error).message).not.toContain("\n");
    expect((err as Error).message).not.toContain("s3cret");
  });
});

describe("databaseLabel", () => {
  it("names host, port and database, never the user or password", () => {
    expect(databaseLabel("postgres://u:p@db.local:5433/skimjob")).toBe("db.local:5433/skimjob");
    expect(databaseLabel("postgres://db.local/skimjob")).toBe("db.local:5432/skimjob");
    expect(databaseLabel("not a url")).toBe("an unreadable URL");
  });
});

describe("serverDeps", () => {
  it("lets a start request name the game seed outside production only (E2E replays)", () => {
    expect(serverDeps(loadConfig({})).seedFromRequest).toBe(true);
    expect(serverDeps(loadConfig({ NODE_ENV: "production", PUBLIC_ORIGIN: "https://skimjob.example" })).seedFromRequest).toBe(false);
  });
});
