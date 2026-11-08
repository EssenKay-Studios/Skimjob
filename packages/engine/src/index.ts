// Skimjob rules engine — pure, deterministic, event-sourced.
// See docs/design.md §17.2 and CLAUDE.md "Engine rules".
export { CONTENT_VERSION } from "@skimjob/content";
export type { RoomId } from "@skimjob/content";
export * from "./types";
export * from "./rng";
export * from "./reduce";
export * from "./setup";
export * from "./job";
export * from "./overrides";
export * from "./round";
export * from "./meeting";
export * from "./end";
export { honesty } from "./shares";
export * from "./deck";
export * from "./claims";
export * from "./roles";
export * from "./evidence";
export * from "./perks";
export * from "./handle";
export * from "./view";
export * from "./reveal";
export const ENGINE_VERSION = "0.1.0";
