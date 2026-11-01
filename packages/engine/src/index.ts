// Skimjob rules engine — pure, deterministic, event-sourced.
// See docs/design.md §17.2 and CLAUDE.md "Engine rules".
export { CONTENT_VERSION } from "@skimjob/content";
export type { JobId, RoleId, RoomId } from "@skimjob/content";
export * from "./types";
export * from "./rng";
export * from "./reduce";
export * from "./setup";
export * from "./job";
export * from "./overrides";
export * from "./acts";
export * from "./round";
export * from "./meeting";
export * from "./end";
export * from "./deck";
export * from "./duel";
export * from "./handle";
export * from "./view";
export const ENGINE_VERSION = "0.1.0";
