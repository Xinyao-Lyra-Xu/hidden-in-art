// Builds the searchable text corpus the agent's RAG embeds and retrieves over.
//
// Each painting becomes one document combining the agent-facing metadata
// (title, artist, category, tags, mood) with the curated curatorial notes from
// paintingInfo — the story and the brushwork description. Those notes are the
// real knowledge the keyword matcher can't reach, so folding them into the
// embedded text is what lets "a swirling emotional sky" or "loose painterly
// dabs" find the right canvas. Pure string assembly: no I/O, no model call.

import { PAINTING_DESCRIPTIONS, STROKE_DESCRIPTIONS } from "@/domain/artwork/paintingInfo";
import type { AgentArtwork } from "./types";

export type CorpusDoc = {
  id: string;
  title: string;
  artist: string;
  // The flattened text that gets embedded and, for retrieved hits, handed back
  // to the model as grounding context.
  text: string;
};

export function buildCorpusDoc(artwork: AgentArtwork): CorpusDoc {
  const description = PAINTING_DESCRIPTIONS[artwork.id] ?? "";
  const strokes = STROKE_DESCRIPTIONS[artwork.id] ?? "";

  const parts = [
    `${artwork.title} by ${artwork.artist}.`,
    `Category: ${artwork.category}.`,
    artwork.tags.length ? `Tags: ${artwork.tags.join(", ")}.` : "",
    artwork.mood.length ? `Mood: ${artwork.mood.join(", ")}.` : "",
    description,
    strokes,
  ];

  return {
    id: artwork.id,
    title: artwork.title,
    artist: artwork.artist,
    text: parts.filter(Boolean).join(" "),
  };
}

export function buildCorpus(library: AgentArtwork[]): CorpusDoc[] {
  return library.map(buildCorpusDoc);
}
