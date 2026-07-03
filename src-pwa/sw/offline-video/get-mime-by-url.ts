const EXTENSION_MIME_TYPES = new Map<string, string>([
  ["mp4", "video/mp4"],
  ["webm", "video/webm"],
  ["ogv", "video/ogg"],
  ["mpeg", "video/mpeg"],
  ["mov", "video/quicktime"],
  ["avi", "video/x-msvideo"],
  ["ts", "video/mp2t"],
  ["3gp", "video/3gpp"],
  ["3g2", "video/3gpp2"],
  ["wmv", "video/x-ms-wmv"],
  ["flv", "video/x-flv"],
  ["m4s", "video/iso.segment"],
  ["m4a", "audio/mp4"],
  ["mpd", "application/dash+xml"]
]);

/** Heuristic method to get the MIME type of a file from its URL extension. */
export default function getMimeByUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const extensionMatch = pathname.match(/\.([a-z0-9]{3,4})$/);
  const extension = extensionMatch?.[1];

  if (extension && EXTENSION_MIME_TYPES.has(extension)) {
    return EXTENSION_MIME_TYPES.get(extension) as string;
  }
  return "application/octet-stream";
}
