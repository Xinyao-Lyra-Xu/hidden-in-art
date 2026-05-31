// A small, representative slice of the painting library for tests — enough to
// exercise artist matching, style/tag matching, and the "no match" path without
// depending on the full public JSON.

import type { AgentArtwork } from "@/domain/agent/types";

export const FIXTURE_LIBRARY: AgentArtwork[] = [
  {
    id: "met-436529",
    title: "La Grenouillère",
    artist: "Claude Monet",
    category: "landscape",
    tags: ["impressionist", "water", "outdoor", "reflections"],
    mood: ["serene"],
  },
  {
    id: "met-437980",
    title: "Water Lilies (Agapanthus)",
    artist: "Claude Monet",
    category: "landscape",
    tags: ["impressionist", "water", "flowers", "soft", "blue"],
    mood: ["calm"],
  },
  {
    id: "met-437984",
    title: "Wheat Field with Cypresses",
    artist: "Vincent van Gogh",
    category: "landscape",
    tags: ["post-impressionist", "expressive", "swirl", "field", "bold"],
    mood: ["dramatic"],
  },
  {
    id: "met-437394",
    title: "Aristotle with a Bust of Homer",
    artist: "Rembrandt",
    category: "portrait",
    tags: ["baroque", "portrait", "dark", "face"],
    mood: ["dramatic"],
  },
];
