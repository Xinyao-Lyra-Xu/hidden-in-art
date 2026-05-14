# Painting References

## Local reference images (Painting Fragment mode)

These four files are used by the local painting-source color mapper:

- `van-gogh.jpg`: Vincent van Gogh, *Irises*, The Metropolitan Museum of Art (public domain).
- `monet.jpg`: Claude Monet, *Water Lilies (Agapanthus)*, Cleveland Museum of Art (CC0).
- `vermeer.jpg`: Johannes Vermeer, *Young Woman with a Lute*, The Metropolitan Museum of Art (public domain).
- `klimt.jpg`: Gustav Klimt, *Hermine Gallia*, Cleveland Museum of Art (CC0).

The app loads these from `/paintings/{source}.jpg`.

## Met Open Access paintings (Auto Match target catalog)

Ten additional paintings are fetched at runtime from The Metropolitan Museum of Art's
Open Access collection via `/api/met-painting?id={objectId}&q={fallback-query}`.
All works are in the public domain. No API key required.

| Painting | Artist | Met Object ID |
|---|---|---|
| Wheat Field with Cypresses | Van Gogh | 437984 |
| The Great Wave off Kanagawa | Hokusai | 45434 |
| Aristotle with a Bust of Homer | Rembrandt | 437394 |
| View of Toledo | El Greco | 29150 |
| By the Seashore | Renoir | 437654 |
| The Dancing Class | Degas | 436928 |
| The Englishman at the Moulin Rouge | Toulouse-Lautrec | 437539 |
| Madame X | Sargent | 12127 |
| Still Life with Apples and Pears | Cézanne | 435882 |
| La Grenouillère | Monet | 436529 |

If an object ID is wrong, the route automatically falls back to a text search of the
Met's public-domain painting index and uses the first match.
