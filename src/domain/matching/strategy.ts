export type MatchMethod = "hand-crafted" | "histogram" | "kmeans" | "spatial";

export const MATCH_METHODS: { id: MatchMethod; label: string; description: string }[] = [
  {
    id: "hand-crafted",
    label: "Hand-crafted",
    description: "Weighted blend of brightness, saturation, warmth, texture and edge density",
  },
  {
    id: "histogram",
    label: "Histogram",
    description: "Global RGB histogram comparison via Bhattacharyya distance",
  },
  {
    id: "kmeans",
    label: "K-Means",
    description: "K-Means++ dominant color extraction, weighted palette matching",
  },
  {
    id: "spatial",
    label: "Spatial Map",
    description: "4×4 spatial color histogram — captures where colors appear (CNN-layer analog)",
  },
];
