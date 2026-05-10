export type RenderMode =
  | "thread-memory"
  | "museum-dust"
  | "point-memory"
  | "lost-portrait";

export type ArtPoint = {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
};

export type RenderSettings = {
  mode: RenderMode;
  pointDensity: number;
  abstraction: number;
  paletteSize: number;
  showThreads: boolean;
};