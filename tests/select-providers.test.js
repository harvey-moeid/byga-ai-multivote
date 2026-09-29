import { describe, it, expect } from "vitest";
import { selectProviders } from "../src/orchestrator/select-providers.js";

const all = ["a", "b", "c"].map((id) => ({ meta: { provider: id } }));
const ids = (list) => list.map((p) => p.meta.provider);

describe("selectProviders", () => {
  it("runs every provider when no selection is given", () => {
    expect(ids(selectProviders(all, undefined))).toEqual(["a", "b", "c"]);
    expect(ids(selectProviders(all, null))).toEqual(["a", "b", "c"]);
    expect(ids(selectProviders(all, "a"))).toEqual(["a", "b", "c"]);
  });

  it("filters to the requested providers and keeps registry order", () => {
    expect(ids(selectProviders(all, ["c", "a"]))).toEqual(["a", "c"]);
  });

  it("ignores unknown ids and non-string entries", () => {
    expect(ids(selectProviders(all, ["b", "zzz", 42, null]))).toEqual(["b"]);
  });

  it("falls back to every provider when nothing valid is requested", () => {
    expect(ids(selectProviders(all, []))).toEqual(["a", "b", "c"]);
    expect(ids(selectProviders(all, ["zzz"]))).toEqual(["a", "b", "c"]);
  });
});
