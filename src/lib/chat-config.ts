/**
 * Central chat limits (shared by client validation and server enforcement).
 * The server additionally caps the effective storage budget at runtime
 * (see src/server/services/chat-files.ts → effectiveBudgetBytes).
 */
export const CHAT_LIMITS = {
  maxMessageLength: 10_000,
  pageSize: 50,
  maxFileBytes: 10 * 1024 * 1024,
  maxFilesPerMessage: 3,
  /** Shared chat file budget per workspace (Supabase Free: 1 GB storage per project). */
  workspaceBudgetBytes: 500 * 1024 * 1024,
  warnRatio: 0.8,
  channelNameMax: 80,
  channelDescriptionMax: 500,
} as const;

export type AllowedFileType = {
  label: string;
  extensions: readonly string[];
  mime: string;
  /** How the server verifies the uploaded bytes. */
  signature: "jpeg" | "png" | "webp" | "pdf" | "zip" | "text";
};

/** Small allowlist. No SVG/HTML, executables, archives, audio or video. */
export const ALLOWED_FILE_TYPES: readonly AllowedFileType[] = [
  { label: "JPEG", extensions: ["jpg", "jpeg"], mime: "image/jpeg", signature: "jpeg" },
  { label: "PNG", extensions: ["png"], mime: "image/png", signature: "png" },
  { label: "WebP", extensions: ["webp"], mime: "image/webp", signature: "webp" },
  { label: "PDF", extensions: ["pdf"], mime: "application/pdf", signature: "pdf" },
  { label: "Text", extensions: ["txt"], mime: "text/plain", signature: "text" },
  { label: "CSV", extensions: ["csv"], mime: "text/csv", signature: "text" },
  {
    label: "Word",
    extensions: ["docx"],
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    signature: "zip",
  },
  {
    label: "Excel",
    extensions: ["xlsx"],
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    signature: "zip",
  },
  {
    label: "PowerPoint",
    extensions: ["pptx"],
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    signature: "zip",
  },
];

export const ACCEPT_ATTRIBUTE = ALLOWED_FILE_TYPES.flatMap((t) => t.extensions.map((e) => `.${e}`)).join(",");

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Type is decided by the extension; the browser-reported MIME type is not trusted. */
export function fileTypeForName(name: string): AllowedFileType | null {
  const ext = fileExtension(name);
  return ALLOWED_FILE_TYPES.find((t) => t.extensions.includes(ext)) ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace(".", ",")} MB`;
}

/** Verifies the leading bytes of an upload against the expected format. */
export function matchesSignature(kind: AllowedFileType["signature"], head: Uint8Array): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const ascii = (offset: number, text: string) =>
    [...text].every((ch, i) => head[offset + i] === ch.charCodeAt(0));
  switch (kind) {
    case "jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "pdf":
      return ascii(0, "%PDF-");
    case "zip":
      // OOXML documents are ZIP containers.
      return starts(0x50, 0x4b, 0x03, 0x04);
    case "text": {
      if (head.length === 0) return false;
      // Plain text: no NUL bytes, and not one of the binary formats above.
      if (head.includes(0)) return false;
      return !(starts(0x50, 0x4b) || ascii(0, "%PDF") || starts(0xff, 0xd8) || starts(0x89, 0x50, 0x4e, 0x47));
    }
  }
}
