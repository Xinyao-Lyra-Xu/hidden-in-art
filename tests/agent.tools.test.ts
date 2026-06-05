import { test } from "node:test";
import assert from "node:assert/strict";
import { ART_AGENT_TOOLS, executeTool, type ToolContext } from "@/domain/agent/tools";
import { DEFAULT_SETTINGS } from "@/domain/agent/types";
import { FIXTURE_LIBRARY } from "./fixtures";

function ctx(overrides: Partial<ToolContext["settings"]> = {}): ToolContext {
  return {
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    library: FIXTURE_LIBRARY,
  };
}

test("every tool definition exposes a name, description and object schema", () => {
  for (const tool of ART_AGENT_TOOLS) {
    assert.ok(tool.name, "tool has a name");
    assert.ok(tool.description.length > 10, "tool has a description");
    assert.equal(tool.input_schema.type, "object");
  }
});

test("set_target_painting resolves a style to an artwork id", () => {
  const res = executeTool("set_target_painting", { query: "Monet water reflections" }, ctx());
  assert.equal(res.ok, true);
  // Either of Monet's water paintings is a valid match for this request.
  assert.ok(["met-436529", "met-437980"].includes(res.patch.targetArtworkId as string));
  assert.match(res.summary, /Monet/);
});

test("set_target_painting fails gracefully on no match", () => {
  const res = executeTool("set_target_painting", { query: "zzzzz nonsense" }, ctx());
  assert.equal(res.ok, false);
  assert.deepEqual(res.patch, {});
  assert.match(res.summary, /Nothing in the library/);
});

test("set_target_painting prefers the semantic hit over keyword matching", () => {
  // Query has no keyword overlap with any title/artist/tag, but the retriever
  // resolves it to Van Gogh — the semantic path must win.
  const res = executeTool(
    "set_target_painting",
    { query: "a turbulent restless feeling" },
    {
      ...ctx(),
      retrieval: [
        { id: "met-437984", title: "Wheat Field with Cypresses", artist: "Vincent van Gogh", text: "swirling", score: 0.8 },
      ],
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.patch.targetArtworkId, "met-437984");
});

test("set_target_painting fuses keyword + semantic so an exact artist wins", () => {
  // Semantic ranks Monet first and Rembrandt second; the keyword matcher nails
  // "Rembrandt" (artist match). Fusion must surface Rembrandt over the semantic
  // #1 — neither signal alone would pick it here.
  const res = executeTool(
    "set_target_painting",
    { query: "Rembrandt" },
    {
      ...ctx(),
      retrieval: [
        { id: "met-436529", title: "La Grenouillère", artist: "Claude Monet", text: "water", score: 0.7 },
        { id: "met-437394", title: "Aristotle with a Bust of Homer", artist: "Rembrandt", text: "baroque", score: 0.65 },
      ],
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.patch.targetArtworkId, "met-437394");
});

test("set_target_painting ignores a semantic hit outside the live library", () => {
  // The top hit isn't in FIXTURE_LIBRARY, so it must fall back to keyword match.
  const res = executeTool(
    "set_target_painting",
    { query: "Monet water reflections" },
    {
      ...ctx(),
      retrieval: [
        { id: "not-in-library", title: "Ghost", artist: "Nobody", text: "n/a", score: 0.99 },
      ],
    },
  );
  assert.equal(res.ok, true);
  assert.ok(["met-436529", "met-437980"].includes(res.patch.targetArtworkId as string));
});

test("set_patch_density accepts an absolute value (snapped + clamped)", () => {
  const res = executeTool("set_patch_density", { value: 3333 }, ctx());
  assert.equal(res.ok, true);
  assert.equal(res.patch.patchCount, 3300);
});

test("set_patch_density supports relative direction with amount", () => {
  const res = executeTool("set_patch_density", { direction: "more", amount: "large" }, ctx({ patchCount: 2000 }));
  assert.equal(res.ok, true);
  assert.equal(res.patch.patchCount, 3600);
});

test("set_patch_density fails when given neither value nor direction", () => {
  const res = executeTool("set_patch_density", {}, ctx());
  assert.equal(res.ok, false);
});

test("set_color_matching validates the algorithm", () => {
  const ok = executeTool("set_color_matching", { algorithm: "dither", abstraction: 0.8 }, ctx());
  assert.equal(ok.ok, true);
  assert.equal(ok.patch.colorMatch, "dither");
  assert.equal(ok.patch.abstraction, 0.8);

  const bad = executeTool("set_color_matching", { algorithm: "rainbow" }, ctx());
  assert.equal(bad.ok, false);
});

test("adjust_abstraction handles direction and absolute value", () => {
  const more = executeTool("adjust_abstraction", { direction: "more", amount: "slight" }, ctx({ abstraction: 0.35 }));
  assert.equal(more.ok, true);
  assert.equal(more.patch.abstraction, 0.5);

  const abs = executeTool("adjust_abstraction", { value: 0.9 }, ctx());
  assert.equal(abs.patch.abstraction, 0.9);

  const empty = executeTool("adjust_abstraction", {}, ctx());
  assert.equal(empty.ok, false);
});

test("set_focal_region validates the region name", () => {
  const ok = executeTool("set_focal_region", { region: "top-left" }, ctx());
  assert.equal(ok.ok, true);
  assert.equal(ok.patch.focalRegion, "top-left");

  const bad = executeTool("set_focal_region", { region: "middle-of-nowhere" }, ctx());
  assert.equal(bad.ok, false);
});

test("search_paintings formats the retrieval hits passed in context", () => {
  const res = executeTool(
    "search_paintings",
    { query: "swirling sky" },
    {
      ...ctx(),
      retrieval: [
        { id: "met-437984", title: "Wheat Field", artist: "Van Gogh", text: "swirling cypresses", score: 0.9 },
        { id: "met-436528", title: "Irises", artist: "Van Gogh", text: "pulsing energy", score: 0.7 },
      ],
    },
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.patch, {}); // search changes no settings
  assert.match(res.summary, /Wheat Field/);
  assert.match(res.summary, /swirling cypresses/);
  assert.match(res.summary, /Irises/);
});

test("search_paintings fails gracefully when no retrieval is available", () => {
  const res = executeTool("search_paintings", { query: "anything" }, ctx());
  assert.equal(res.ok, false);
  assert.match(res.summary, /No painting matched/);
});

test("search_paintings caps the number of results surfaced to the model", () => {
  const many = Array.from({ length: 6 }, (_, i) => ({
    id: `id-${i}`,
    title: `T${i}`,
    artist: "A",
    text: "x",
    score: 1 - i * 0.1,
  }));
  const res = executeTool("search_paintings", { query: "q" }, { ...ctx(), retrieval: many });
  assert.equal(res.ok, true);
  // Only the first three are listed.
  assert.match(res.summary, /T0/);
  assert.match(res.summary, /T2/);
  assert.doesNotMatch(res.summary, /T3/);
});

test("unknown tool names fail instead of throwing", () => {
  const res = executeTool("delete_everything", {}, ctx());
  assert.equal(res.ok, false);
  assert.match(res.summary, /Unknown tool/);
});
