export type RenderMode =
  | "thread-memory"
  | "museum-dust"
  | "point-memory"
  | "lost-portrait"
  | "painting-fragment";

export type PaintingSource =
  | "none"
  | "van-gogh"
  | "monet"
  | "vermeer"
  | "klimt";

export type ArtPoint = {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
  sourceColor?: string;
  paintingColor?: string;
  importance: number;
  angle: number;
};

export type RenderSettings = {
  mode: RenderMode;
  pointDensity: number;
  abstraction: number;
  paletteSize: number;
  showThreads: boolean;
  memoryDecay: number;
  paintingSource: PaintingSource;
  colorBlend: number;
  usePaintingFragment: boolean;
};
