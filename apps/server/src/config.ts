// Server settings from the environment. Unset DATABASE_URL means PGlite, so
// `pnpm dev` works with nothing installed.
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  /** Real Postgres; null falls back to PGlite. */
  readonly databaseUrl: string | null;
  /** PGlite data directory; null keeps it in memory. Ignored with databaseUrl. */
  readonly pgliteDir: string | null;
  /** DEV_LOGIN=1 enables the dev sign-in stub (M2-2). Never in a deployment. */
  readonly devLogin: boolean;
}

/** A startup failure whose message is the whole story: print it, exit 1. */
export class StartupError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Env = process.env): ServerConfig {
  // Unset or blank means the default, like HOST. Otherwise digits only, so
  // "0x50" or "1e3" isn't read as a number by accident.
  const rawPort = env.PORT?.trim() || "3000";
  const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : NaN;
  if (!(port >= 1 && port <= 65535)) throw new StartupError(`PORT must be a whole number from 1 to 65535, got ${JSON.stringify(env.PORT)}`);
  const pgliteDir = env.PGLITE_DIR?.trim() || ".pglite";
  return {
    port,
    // Loopback by default; HOST=0.0.0.0 lets phones on the LAN join.
    host: env.HOST || "127.0.0.1",
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: pgliteDir === "memory" ? null : pgliteDir,
    devLogin: env.DEV_LOGIN === "1",
  };
}
