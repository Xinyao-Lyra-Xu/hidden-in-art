export type RenderSettings = {
  patchCount: number;      // 40–200, default 100
  targetPainting: string;
};

export type MosaicPainting = {
  id: string;
  title: string;
  artist: string;
  metId: number;
  query: string;
};

export const MOSAIC_PAINTINGS: MosaicPainting[] = [
  { id: "grenouillere",  title: "La Grenouillère",                    artist: "Monet",             metId: 436529, query: "La Grenouillere Monet" },
  { id: "great-wave",    title: "The Great Wave off Kanagawa",        artist: "Hokusai",           metId: 45434,  query: "Great Wave Kanagawa Hokusai" },
  { id: "cypresses",     title: "Wheat Field with Cypresses",         artist: "Van Gogh",          metId: 437984, query: "Wheat Field Cypresses Van Gogh" },
  { id: "irises",        title: "Irises",                             artist: "Van Gogh",          metId: 436528, query: "Irises Van Gogh" },
  { id: "dancing-class", title: "The Dancing Class",                  artist: "Degas",             metId: 436928, query: "Dancing Class Degas" },
  { id: "by-seashore",   title: "By the Seashore",                    artist: "Renoir",            metId: 437654, query: "By Seashore Renoir" },
  { id: "aristotle",     title: "Aristotle with a Bust of Homer",     artist: "Rembrandt",         metId: 437394, query: "Aristotle Bust Homer Rembrandt" },
  { id: "toledo",        title: "View of Toledo",                     artist: "El Greco",          metId: 29150,  query: "View Toledo El Greco" },
  { id: "apples-pears",  title: "Still Life with Apples and Pears",   artist: "Cézanne",           metId: 435882, query: "Still Life Apples Pears Cezanne" },
  { id: "moulin-rouge",  title: "The Englishman at the Moulin Rouge",  artist: "Toulouse-Lautrec",  metId: 437539, query: "Englishman Moulin Rouge Toulouse-Lautrec" },
];
