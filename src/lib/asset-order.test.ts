import { describe, expect, it } from "vitest";
import { moveId, topSortOrder } from "./asset-order";

// Pure index math for the asset list order. Pinned directly rather than
// through the DOM: every drag outcome in AssetList reduces to `moveId`, and
// the top-slot placement of a new asset reduces to `topSortOrder`.

describe("moveId", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves an id down the list", () => {
    expect(moveId(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an id up the list", () => {
    expect(moveId(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("moves an id to the first position", () => {
    expect(moveId(ids, "c", "a")).toEqual(["c", "a", "b", "d"]);
  });

  it("moves an id to the last position", () => {
    expect(moveId(ids, "a", "d")).toEqual(["b", "c", "d", "a"]);
  });

  it("returns an unchanged copy when activeId is unknown", () => {
    expect(moveId(ids, "zz", "c")).toEqual(ids);
  });

  it("returns an unchanged copy when overId is unknown", () => {
    expect(moveId(ids, "a", "zz")).toEqual(ids);
  });

  it("returns an unchanged copy when activeId === overId", () => {
    expect(moveId(ids, "b", "b")).toEqual(ids);
  });

  it("handles a single-element list", () => {
    expect(moveId(["a"], "a", "a")).toEqual(["a"]);
  });

  it("handles an empty list", () => {
    expect(moveId([], "a", "b")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b", "c"];
    const result = moveId(input, "a", "c");
    expect(input).toEqual(["a", "b", "c"]);
    expect(result).not.toBe(input);
  });
});

describe("topSortOrder", () => {
  it("returns 0 for an empty list", () => {
    expect(topSortOrder([])).toBe(0);
  });

  it("returns -1 when every existing row is 0 (the post-backfill/restore case)", () => {
    expect(topSortOrder([0, 0, 0])).toBe(-1);
  });

  it("goes one below an already-negative minimum", () => {
    expect(topSortOrder([-3, 0, 5])).toBe(-4);
  });

  it("handles a single element", () => {
    expect(topSortOrder([7])).toBe(6);
  });

  it("ignores position in the array and uses the minimum", () => {
    expect(topSortOrder([4, 1, 9])).toBe(0);
  });
});
