import { describe, expect, it } from "vitest";
import { TAG_NAME_MAX, compareTagNames, duplicateTagNames, tagNameKey, tagsByAsset, validateTagName } from "./tags";

describe("validateTagName", () => {
  it.each([
    ["a plain name", "ETF", "ETF"],
    ["a name with surrounding spaces, trimmed", "  Long term  ", "Long term"],
    ["a one-character name", "x", "x"],
    ["exactly 32 characters", "a".repeat(32), "a".repeat(32)],
    ["32 characters after trimming", `  ${"b".repeat(32)}\t`, "b".repeat(32)],
    ["32 emoji (code points, not UTF-16 units)", "💰".repeat(32), "💰".repeat(32)],
    ["inner spaces kept", "Emergency  fund", "Emergency  fund"],
  ])("accepts %s", (_label, raw, expected) => {
    expect(validateTagName(raw)).toEqual({ ok: true, name: expected });
  });

  it.each([
    ["an empty string", "", "name must not be empty"],
    ["only whitespace", " \t\n ", "name must not be empty"],
    ["33 characters", "a".repeat(33), `name must be at most ${TAG_NAME_MAX} characters`],
    ["33 emoji", "💰".repeat(33), `name must be at most ${TAG_NAME_MAX} characters`],
    ["a number", 42, "name must be a string"],
    ["null", null, "name must be a string"],
    ["undefined", undefined, "name must be a string"],
    ["an array", ["ETF"], "name must be a string"],
  ])("rejects %s", (_label, raw, message) => {
    expect(validateTagName(raw)).toEqual({ ok: false, message });
  });
});

describe("tagNameKey and duplicateTagNames", () => {
  it.each([
    ["ETF", "etf"],
    ["  Bonds ", "bonds"],
    ["Ünïcode", "ünïcode"],
  ])("tagNameKey(%j) is %j", (name, key) => {
    expect(tagNameKey(name)).toBe(key);
  });

  it.each([
    ["no names", [], []],
    ["distinct names", ["ETF", "Bonds", "Cash"], []],
    ["a case-only clash", ["ETF", "etf"], ["ETF"]],
    ["a clash after trimming", ["Cash", " cash "], ["Cash"]],
    ["one clash reported once", ["a", "A", "a", "b"], ["a"]],
    ["two clashes", ["x", "Y", "X", "y"], ["x", "Y"]],
  ])("%s", (_label, names, dupes) => {
    expect(duplicateTagNames(names)).toEqual(dupes);
  });
});

describe("tagsByAsset", () => {
  const tags = [
    { id: "t-etf", name: "ETF" },
    { id: "t-bonds", name: "bonds" },
    { id: "t-cash", name: "Cash" },
  ];

  it.each([
    ["no links", [], {}],
    [
      "one asset, two tags, sorted by name regardless of case",
      [
        { asset_id: "a1", tag_id: "t-etf" },
        { asset_id: "a1", tag_id: "t-bonds" },
      ],
      {
        a1: [
          { id: "t-bonds", name: "bonds" },
          { id: "t-etf", name: "ETF" },
        ],
      },
    ],
    [
      "two assets sharing a tag",
      [
        { asset_id: "a1", tag_id: "t-cash" },
        { asset_id: "a2", tag_id: "t-cash" },
      ],
      { a1: [{ id: "t-cash", name: "Cash" }], a2: [{ id: "t-cash", name: "Cash" }] },
    ],
    ["a link to an unknown tag is skipped", [{ asset_id: "a1", tag_id: "t-gone" }], {}],
  ])("%s", (_label, links, expected) => {
    expect(tagsByAsset(tags, links)).toEqual(expected);
  });

  it("compareTagNames breaks a name tie by id, so the order is total", () => {
    const list = [
      { id: "b", name: "Same" },
      { id: "a", name: "same" },
    ];
    expect([...list].sort(compareTagNames).map((t) => t.id)).toEqual(["a", "b"]);
  });
});
