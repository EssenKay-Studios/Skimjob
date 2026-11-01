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

type Env = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Env = process.env): ServerConfig {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT must be a port number, got ${env.PORT}`);
  const pgliteDir = env.PGLITE_DIR ?? ".pglite";
  return {
    port,
    // Loopback by default; HOST=0.0.0.0 lets phones on the LAN join.
    host: env.HOST || "127.0.0.1",
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: pgliteDir === "memory" ? null : pgliteDir,
    devLogin: env.DEV_LOGIN === "1",
  };
}
