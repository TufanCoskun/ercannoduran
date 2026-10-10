import type { Ad } from "./types";

const ID = /^[A-Za-z0-9_-]{11}$/;

/** Extracts a YouTube video id from watch / youtu.be / shorts / embed / ytimg thumbnail URLs. */
export function youtubeId(url?: string | null): string | undefined {
  if (!url) return undefined;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | undefined;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v") ?? undefined;
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      id = m?.[1];
    }
  } else if (host === "i.ytimg.com" || host === "img.youtube.com") {
    const m = u.pathname.match(/^\/vi(?:_webp)?\/([^/]+)\//);
    id = m?.[1];
  }
  return id && ID.test(id) ? id : undefined;
}

export function isYouTubeUrl(url?: string | null): boolean {
  if (!url) return false;
  return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(safeHost(url));
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * The YouTube video to embed for an ad, if any: a video media item pointing at YouTube,
 * or a video-format ad whose thumbnail / library link is a YouTube URL.
 */
export function adYouTubeId(ad: Ad): string | undefined {
  for (const m of ad.media) {
    if (m.type === "video" && isYouTubeUrl(m.url)) return youtubeId(m.url);
  }
  if (ad.format !== "video") return undefined;
  if (isYouTubeUrl(ad.libraryUrl)) return youtubeId(ad.libraryUrl);
  for (const m of ad.media) {
    const id = youtubeId(m.url) ?? youtubeId(m.thumbnailUrl);
    if (id) return id;
  }
  return undefined;
}

export const ytPoster = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export function ytEmbedUrl(id: string, muted: boolean): string {
  const p = new URLSearchParams({
    autoplay: "1",
    mute: muted ? "1" : "0",
    playsinline: "1",
    loop: "1",
    playlist: id,
    rel: "0",
    modestbranding: "1",
    enablejsapi: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${p.toString()}`;
}
