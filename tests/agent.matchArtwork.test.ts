import { test } from "node:test";
import assert from "node:assert/strict";
import { matchArtwork } from "@/domain/agent/matchArtwork";
import { FIXTURE_LIBRARY } from "./fixtures";

test("matches Monet's water reflections to a Monet water painting", () => {
  const results = matchArtwork("use Monet's water reflections style", FIXTURE_LIBRARY);
  assert.ok(results.length > 0);
  assert.equal(results[0].artwork.artist, "Claude Monet");
  // both Monet water pieces should rank above the non-water entries
  assert.ok(results[0].artwork.tags.includes("water"));
});

test("matches by artist name alone", () => {
  const results = matchArtwork("van gogh", FIXTURE_LIBRARY);
  assert.ok(results.length > 0);
  assert.equal(results[0].artwork.artist, "Vincent van Gogh");
});

test("matches an abstract/expressive request to the expressive painting", () => {
  const results = matchArtwork("something more abstract and expressive", FIXTURE_LIBRARY);
  assert.ok(results.length > 0);
  assert.equal(results[0].artwork.id, "met-437984");
});

test("matches a dramatic portrait to the Rembrandt", () => {
  const results = matchArtwork("a dramatic portrait", FIXTURE_LIBRARY);
  assert.ok(results.length > 0);
  assert.equal(results[0].artwork.category, "portrait");
});

test("returns empty array when nothing matches", () => {
  assert.deepEqual(matchArtwork("zxcvbnm qwerty", FIXTURE_LIBRARY), []);
});

test("stop words alone do not produce matches", () => {
  assert.deepEqual(matchArtwork("make it look like the style of", FIXTURE_LIBRARY), []);
});
