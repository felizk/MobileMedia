import { browseMedia } from "./media-api";
import {
  getDownloadedVideos,
  type DownloadedVideo
} from "./offline-video-status";

export interface BrokenDownload {
  videoId: string;
  url: string;
  /** Bytes actually stored in offline storage. */
  bytesStored: number;
  /** The real encoded file size, read from the server. */
  bytesExpected: number;
}

function directoryOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

/**
 * Confirms each downloaded video's stored byte count still matches the real
 * encoded file size the server reports.
 *
 * A Range request straight to the stream endpoint would be the obvious way
 * to ask the server, but it doesn't send `Access-Control-Expose-Headers`,
 * so a cross-origin `fetch` can't read the `Content-Range` response header
 * back — it comes back as `null`. `browse`'s `sizeBytes` (the encoded
 * `.mp4` size, for `Encoded` files) is a plain JSON body field, so it's
 * visible regardless of CORS header exposure, and serves the same purpose.
 *
 * Comparing only the two numbers already stored in IndexedDB isn't enough:
 * a past bug could mark a truncated download as complete by rewriting the
 * stored total to match the truncated byte count, so both numbers already
 * agree with each other while still being short of the real file.
 */
export async function findBrokenDownloads(): Promise<BrokenDownload[]> {
  const downloaded = await getDownloadedVideos();

  const byDirectory = new Map<string, DownloadedVideo[]>();
  for (const video of downloaded) {
    const dir = directoryOf(video.videoId);
    const list = byDirectory.get(dir) ?? [];
    list.push(video);
    byDirectory.set(dir, list);
  }

  const broken: BrokenDownload[] = [];

  await Promise.all(
    [...byDirectory.entries()].map(async ([dir, videos]) => {
      const listing = await browseMedia(dir, { encodedOnly: true }).catch(
        () => null
      );
      if (!listing) return;

      for (const video of videos) {
        const entry = listing.files.find(file => file.path === video.videoId);
        if (entry && entry.sizeBytes !== video.bytesDownloaded) {
          broken.push({
            videoId: video.videoId,
            url: video.url,
            bytesStored: video.bytesDownloaded,
            bytesExpected: entry.sizeBytes
          });
        }
      }
    })
  );

  return broken;
}
