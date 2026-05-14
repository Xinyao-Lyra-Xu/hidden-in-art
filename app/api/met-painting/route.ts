import { NextRequest } from "next/server";

// Proxy paintings from The Met Open Access collection.
// Accepts ?id={objectId} as primary lookup, ?q={search} as fallback.
// Running server-side avoids CORS — the browser receives same-origin bytes
// that canvas.getImageData() can read without being tainted.

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const q = request.nextUrl.searchParams.get("q");

  let objectId: number | null =
    id && /^\d+$/.test(id) ? parseInt(id, 10) : null;

  // If no direct ID, search The Met's public-domain paintings
  if (!objectId && q) {
    try {
      const res = await fetch(
        `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(q)}&isPublicDomain=true&medium=Paintings`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        objectId = data.objectIDs?.[0] ?? null;
      }
    } catch {
      return new Response("Met search failed", { status: 502 });
    }
  }

  if (!objectId) {
    return new Response("Painting not found", { status: 404 });
  }

  // Resolve the object to get its primary image URL
  let imageUrl: string | null = null;
  try {
    const objRes = await fetch(
      `https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`,
      { cache: "no-store" }
    );
    if (!objRes.ok) {
      // If the ID hint failed and we have a query, try searching instead
      if (id && q) {
        const retryRes = await fetch(
          `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(q)}&isPublicDomain=true&medium=Paintings`,
          { cache: "no-store" }
        );
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          const fallbackId = retryData.objectIDs?.[0];
          if (fallbackId) {
            const fallbackRes = await fetch(
              `https://collectionapi.metmuseum.org/public/collection/v1/objects/${fallbackId}`,
              { cache: "no-store" }
            );
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              imageUrl = fallbackData.primaryImageSmall || fallbackData.primaryImage || null;
            }
          }
        }
      }
    } else {
      const objData = await objRes.json();
      imageUrl = objData.primaryImageSmall || objData.primaryImage || null;
    }
  } catch {
    return new Response("Met API error", { status: 502 });
  }

  if (!imageUrl) {
    return new Response("No image available for this object", { status: 404 });
  }

  // Fetch and stream the image back to the client
  try {
    const imgRes = await fetch(imageUrl, { cache: "no-store" });
    if (!imgRes.ok) {
      return new Response("Image fetch failed", { status: 502 });
    }
    const buffer = await imgRes.arrayBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type": imgRes.headers.get("content-type") ?? "image/jpeg",
        // Browser caches for 24 h; CDN/proxy can cache for 7 days
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new Response("Image stream failed", { status: 502 });
  }
}
