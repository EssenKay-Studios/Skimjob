// The summary report printed after a batch: the design §17.4 balance metrics,
// one column per player count. Pure: a Summary in, text out.
import type { GroupWins, Metrics, Summary } from "./metrics";
import { HONEST_MAX_SHARE, MODERATE_MAX_SHARE, POCKET_BANDS } from "./metrics";

const pct = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 100)}%`);
const num = (v: number | null): string => (v === null ? "—" : v.toFixed(2));
const signed = (v: number | null): string => (v === null ? "" : `${v >= 0 ? "+" : ""}${Math.round(v)}`);

interface Row {
  readonly label: string;
  readonly target: string;
  readonly cell: (m: Metrics) => string;
}

const share = (lo: number) => `${Math.round(lo * 100)}%`;
const ROWS: readonly Row[] = [
  { label: "Games", target: "", cell: (m) => String(m.games) },
  { label: "Heist success rate", target: "55–70%", cell: (m) => pct(m.successRate) },
  { label: "Bust rate", target: "8–20%", cell: (m) => pct(m.bustRate) },
  { label: "Raids per game", target: "1–3", cell: (m) => num(m.raids.perGame) },
  { label: "Games with a raid", target: "50–90%", cell: (m) => pct(m.raids.games) },
  { label: "Rooftop stalls (rounds)", target: "≤ 15%", cell: (m) => pct(m.raids.stalls) },
  { label: "Busted before Act 3", target: "", cell: (m) => pct(m.endedBeforeAct3) },
  { label: "Checkpoints missed per game", target: "", cell: (m) => num(m.checkpointsMissedPerGame) },
  { label: "Bank emptied", target: "", cell: (m) => pct(m.bankEmptied) },
  { label: "Shakedowns per game", target: "", cell: (m) => num(m.shakedowns.perGame) },
  { label: "Shakedown accuracy (caught loot)", target: "50–70%", cell: (m) => pct(m.shakedowns.accuracy) },
  { label: "Shakedown target had pocketed", target: "", cell: (m) => pct(m.shakedowns.hitPocketer) },
  { label: `Win rate, honest (pocket ≤${share(HONEST_MAX_SHARE)})`, target: "< moderate", cell: (m) => pct(m.pocketing.honest?.winRate ?? null) },
  { label: `Win rate, moderate (≤${share(MODERATE_MAX_SHARE)})`, target: "> honest", cell: (m) => pct(m.pocketing.moderate?.winRate ?? null) },
  { label: `Win rate, heavy (>${share(MODERATE_MAX_SHARE)})`, target: "< 50%", cell: (m) => pct(m.pocketing.heavy?.winRate ?? null) },
  { label: "Comeback: Act 1 leader wins (successes)", target: "< 50%", cell: (m) => pct(m.comeback.rate) },
  { label: "Decided before Act 3 (successes)", target: "< 15%", cell: (m) => pct(m.decidedEarly.rate) },
];

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: readonly string[]) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join("  ").trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}

function columns(summary: Summary): [string, Metrics][] {
  const cols: [string, Metrics][] = Object.entries(summary.byPlayers).map(([n, m]) => [`${n}p`, m]);
  if (cols.length > 1) cols.push(["all", summary.overall]);
  return cols;
}

/** Rows of "win share (Δ pp vs fair share)" for each group key seen in any column. */
function groupTable(cols: readonly [string, Metrics][], pickGroup: (m: Metrics) => Record<string, GroupWins>, cell: (g: GroupWins) => string): string {
  const keys = [...new Set(cols.flatMap(([, m]) => Object.keys(pickGroup(m))))].sort();
  const rows = keys.map((k) => [k, ...cols.map(([, m]) => {
    const g = pickGroup(m)[k];
    return g ? cell(g) : "";
  })]);
  return table(["", ...cols.map(([c]) => c)], rows);
}

export function formatReport(summary: Summary, title: string): string {
  const cols = columns(summary);
  const hasMole = cols.some(([, m]) => m.moleWins.games > 0);
  // design §17.4: Mole win rate when present: games a Mole won ÷ games with a Mole (moleWinMetric).
  // Reported only: under one crew the Mole is held to role parity (extension.md Build notes "Sim").
  const moleRow: Row = { label: "Mole win rate (games with a Mole)", target: "report", cell: (m) => pct(m.moleWins.rate) };
  const rows = hasMole ? [...ROWS, moleRow] : ROWS;
  const main = table(
    ["Balance metric (design §17.4)", "target", ...cols.map(([c]) => c)],
    rows.map((r) => [r.label, r.target, ...cols.map(([, m]) => r.cell(m))]),
  );
  const roles = groupTable(cols, (m) => m.roles, (g) => `${pct(g.successWinShare)} ${signed(g.deltaPp)}`.trim());
  const people = groupTable(cols, (m) => m.personalities, (g) => `${pct(g.winRate)}`);
  const pockets = groupTable(
    cols,
    (m) => Object.fromEntries(POCKET_BANDS.flatMap((b) => (m.pocketing[b] ? [[b, m.pocketing[b]]] : []))),
    (g) => String(g.seats),
  );
  const mole = hasMole ? "" : "\nMole win rate: — (no Moles dealt)";
  const rejections = summary.overall.rejections > 0 ? `\nWARNING: bots sent ${summary.overall.rejections} refused commands (should be 0).` : "";
  return [
    title,
    "",
    main,
    "",
    "Role win share in successful heists, with pp vs fair share 1 ÷ crew (target ±5 pp)",
    roles,
    "",
    "Personality win rate (all games; a failed heist is a loss)",
    people,
    "",
    "Seats per pocketing band (Inside Men left out: they can't pocket)",
    pockets,
  ].join("\n") + mole + rejections + "\n";
}
