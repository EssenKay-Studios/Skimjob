import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, CONTENT_VERSION } from "./index";

describe("engine skeleton", () => {
  it("exposes versions", () => {
    expect(ENGINE_VERSION).toBe("0.1.0");
    expect(CONTENT_VERSION).toBe("0.26.0");
  });
});
