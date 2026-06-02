// Deterministic natural-language → artwork ranking.
//
// The LLM phrases a request ("Monet's water reflections", "a dramatic
// portrait"); this resolves it to concrete library entries with no model call.
// Keeping it deterministic means the set_target_painting tool is testable and
// cheap, and the agent's painting choice is reproducible.

import type { AgentArtwork } from "./types";

// Filler words that carry no painting signal. A query made only of these
// resolves to nothing rather than matching everything.
const STOP_WORDS = new Set([
  "a", "an", "and", "the", "of", "to", "it", "is", "in", "on", "with", "for",
  "make", "look", "looks", "looking", "like", "style", "styled", "more", "less",
  "some", "use", "using", "my", "your", "this", "that", "please", "can", "you",
  "want", "would", "into", "as", "kind", "sort", "give", "me", "do", "be", "s",
]);

const ARTIST_WEIGHT = 3;
const CATEGORY_WEIGHT = 2;
const TAG_WEIGHT = 1;
const MOOD_WEIGHT = 1;

export type ArtworkMatch = { artwork: AgentArtwork; score: number };

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function scoreArtwork(tokens: string[], artwork: AgentArtwork): number {
  const artistWords = new Set(artwork.artist.toLowerCase().split(/[^a-z0-9]+/));
  const tags = new Set(artwork.tags.map((t) => t.toLowerCase()));
  const moods = new Set(artwork.mood.map((m) => m.toLowerCase()));
  const category = artwork.category.toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (artistWords.has(token)) score += ARTIST_WEIGHT;
    if (token === category) score += CATEGORY_WEIGHT;
    if (tags.has(token)) score += TAG_WEIGHT;
    if (moods.has(token)) score += MOOD_WEIGHT;
  }
  return score;
}

export function matchArtwork(query: string, library: AgentArtwork[]): ArtworkMatch[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  return library
    .map((artwork) => ({ artwork, score: scoreArtwork(tokens, artwork) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}
