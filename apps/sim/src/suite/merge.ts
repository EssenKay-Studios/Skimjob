// Combining shard outputs into one suite result. Each shard holds whole cells
// (tallies), so merging is putting the cells back in matrix order: the report
// built from them is byte-identical to an unsharded run's.
import { buildMatrix, shardCells, type SuiteOptions } from "./matrix";
import { REPORT_FORMAT, SHARD_KIND, type ShardFile, type Versions } from "./report";
import type { CellResult } from "./run";

export interface Merged {
  readonly options: SuiteOptions;
  readonly versions: Versions;
  readonly cells: readonly CellResult[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Check that `shards` are the n shards of one suite run, each once; then the cells in matrix order. Or the problem. */
export function mergeShards(shards: readonly unknown[]): Merged | string {
  if (shards.length === 0) return "no shard files";
  const files: ShardFile[] = [];
  for (const [i, s] of shards.entries()) {
    if (!isObject(s) || s.kind !== SHARD_KIND) return `file ${i + 1} isn't a suite shard (kind "${SHARD_KIND}")`;
    if (s.format !== REPORT_FORMAT) return `file ${i + 1} has format ${String(s.format)}, expected ${REPORT_FORMAT}`;
    files.push(s as unknown as ShardFile);
  }
  const first = files[0] as ShardFile;
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const count = first.shard.count;
  const seen = new Set<number>();
  for (const f of files) {
    if (!same(f.versions, first.versions)) return `shards come from different engine/content versions (${JSON.stringify(f.versions)} vs ${JSON.stringify(first.versions)})`;
    if (!same(f.options, first.options)) return "shards come from runs with different settings";
    if (f.shard.count !== count) return `shard ${f.shard.index}/${f.shard.count} doesn't belong with ${first.shard.index}/${count}`;
    if (seen.has(f.shard.index)) return `shard ${f.shard.index}/${count} given twice`;
    seen.add(f.shard.index);
  }
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((i) => !seen.has(i));
  if (missing.length > 0) return `missing shard${missing.length > 1 ? "s" : ""} ${missing.map((i) => `${i}/${count}`).join(", ")}`;

  const matrix = buildMatrix(first.options);
  const byKey = new Map<string, CellResult>();
  for (const f of files) {
    const want = shardCells(matrix, f.shard.index, count).map((c) => c.key);
    const got = f.cells.map((c) => c.key);
    if (!same(want, got)) return `shard ${f.shard.index}/${count} doesn't hold the cells it should (${got.join(", ")})`;
    for (const c of f.cells) byKey.set(c.key, c);
  }
  return { options: first.options, versions: first.versions, cells: matrix.map((c) => byKey.get(c.key) as CellResult) };
}
