export type RenderMode =
  | "thread-memory"
  | "museum-dust"
  | "point-memory"
  | "lost-portrait"
  | "painting-fragment"
  | "extracted-painting-transfer";

export type PaintingSource =
  | "none"
  | "van-gogh"
  | "monet"
  | "vermeer"
  | "klimt";

export const PAINTING_SOURCES = [
  "van-gogh",
  "monet",
  "vermeer",
  "klimt",
] as const satisfies readonly Exclude<PaintingSource, "none">[];

export type ArtPoint = {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
  sourceColor?: string;
  paintingColor?: string;
  patchSize?: number;
  importance: number;
  angle: number;
};

export type TransferTargetPoint = {
  x: number;
  y: number;
  r: number;
  sourceIndex: number;
  importance: number;
  angle: number;
  targetColor: string;
  targetBrightness: number;
  targetSaturation: number;
  targetWarmth: number;
};

export type ArtworkMetadata = {
  id: string;
  title: string;
  artist: string;
  image: string;
  tags: string[];
  mood: string[];
  palette: string[];
  complexity: number;
  brightness: number;
  saturation: number;
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
  markerSize: number;
  topReconstructionScale: number;
  preserveSourceImage: boolean;
  reconstructionOpacity: number;
};
