// A small, recognizable painting library for evals. Distinct artists/styles so
// the agent's matching has clear right answers to aim at.

import type { AgentArtwork } from "@/domain/agent/types";

export const EVAL_LIBRARY: AgentArtwork[] = [
  {
    id: "vangogh-starry",
    title: "The Starry Night",
    artist: "Vincent van Gogh",
    category: "landscape",
    tags: ["post-impressionist", "swirl", "expressive", "night", "bold"],
    mood: ["dramatic", "turbulent"],
  },
  {
    id: "monet-lilies",
    title: "Water Lilies",
    artist: "Claude Monet",
    category: "landscape",
    tags: ["impressionist", "water", "soft", "reflections", "pastel"],
    mood: ["serene", "calm"],
  },
  {
    id: "rembrandt-self",
    title: "Self-Portrait",
    artist: "Rembrandt",
    category: "portrait",
    tags: ["baroque", "portrait", "dark", "chiaroscuro", "face"],
    mood: ["dramatic", "somber"],
  },
  {
    id: "vermeer-pearl",
    title: "Girl with a Pearl Earring",
    artist: "Johannes Vermeer",
    category: "portrait",
    tags: ["baroque", "portrait", "soft", "intimate", "face"],
    mood: ["quiet", "tender"],
  },
  {
    id: "hokusai-wave",
    title: "The Great Wave off Kanagawa",
    artist: "Katsushika Hokusai",
    category: "landscape",
    tags: ["ukiyo-e", "woodblock", "wave", "bold", "graphic"],
    mood: ["dramatic", "dynamic"],
  },
];
