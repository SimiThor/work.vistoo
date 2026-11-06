"use client";

import { discardUploadAction, finalizeUploadAction, reserveUploadAction } from "@/app/actions/chat";
import { CHAT_LIMITS, fileTypeForName } from "@vistoo/domain/chat-config";

export type PendingUpload = {
  localId: string;
  file: File;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  status: "uploading" | "ready" | "error";
  progress: number; // 0..1
  attachmentId: string | null;
  error: string | null;
};

/** Client-side pre-check (the server validates again, including the bytes). */
export function precheckFile(file: File, alreadyQueued: number): string | null {
  if (alreadyQueued >= CHAT_LIMITS.maxFilesPerMessage) {
    return `Höchstens ${CHAT_LIMITS.maxFilesPerMessage} Dateien pro Nachricht.`;
  }
  if (!fileTypeForName(file.name)) {
    return `„${file.name}“: Dieser Dateityp ist nicht erlaubt (erlaubt: Bilder, PDF, Text, CSV, Word, Excel, PowerPoint).`;
  }
  if (file.size === 0) return `„${file.name}“ ist leer.`;
  if (file.size > CHAT_LIMITS.maxFileBytes) return `„${file.name}“ ist größer als 10 MB.`;
  return null;
}

function put(url: string, file: File, contentType: string, onProgress: (p: number) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/**
 * reserve (budget + access, server) → PUT directly to Supabase Storage →
 * finalize (server verifies size and file signature).
 */
export async function uploadFile(
  conversationId: string,
  file: File,
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<{ ok: true; attachmentId: string } | { ok: false; error: string; attachmentId: string | null }> {
  const ticket = await reserveUploadAction({ conversationId, fileName: file.name, sizeBytes: file.size }).catch(() => ({
    ok: false as const,
    error: { message: "Keine Verbindung. Bitte versuche es erneut." },
  }));
  if (!ticket.ok) return { ok: false, error: ticket.error.message, attachmentId: null };
  const { attachmentId, signedUrl, contentType } = ticket.data;
  try {
    await put(signedUrl, file, contentType, onProgress, signal);
  } catch (err) {
    void discardUploadAction({ id: attachmentId });
    if ((err as Error).name === "AbortError") return { ok: false, error: "Abgebrochen.", attachmentId: null };
    return { ok: false, error: "Der Upload ist fehlgeschlagen. Bitte versuche es erneut.", attachmentId: null };
  }
  const fin = await finalizeUploadAction({ id: attachmentId }).catch(() => ({
    ok: false as const,
    error: { message: "Keine Verbindung. Bitte versuche es erneut." },
  }));
  if (!fin.ok) return { ok: false, error: fin.error.message, attachmentId: null };
  return { ok: true, attachmentId };
}

export function discardUpload(attachmentId: string) {
  return discardUploadAction({ id: attachmentId });
}
