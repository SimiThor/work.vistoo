import "server-only";
import { ALLOWED_FILE_TYPES, CHAT_LIMITS } from "@/lib/chat-config";
import { createSupabaseAdminClient } from "./supabase";

export const CHAT_BUCKET = "chat-files";

/** Short validity: links already handed out stay valid until they expire. */
export const DOWNLOAD_URL_TTL_SECONDS = 60;

/**
 * Thin adapter around Supabase Storage (service role, server only), so the
 * upload logic can be tested without a storage server.
 */
export type ChatStorage = {
  createUploadUrl(path: string): Promise<{ signedUrl: string; token: string }>;
  /** Size and leading bytes of an uploaded object, or null if missing. */
  inspect(path: string): Promise<{ size: number; head: Uint8Array } | null>;
  remove(paths: string[]): Promise<void>;
  createDownloadUrl(path: string, fileName: string): Promise<string>;
};

const HEAD_BYTES = 4096;

let bucketReady: Promise<void> | null = null;

/**
 * The bucket is created by the migration; this keeps it present and private
 * with the same limits (e.g. if storage was enabled after migrating).
 */
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const storage = createSupabaseAdminClient().storage;
    const options = {
      public: false,
      fileSizeLimit: CHAT_LIMITS.maxFileBytes,
      allowedMimeTypes: ALLOWED_FILE_TYPES.map((t) => t.mime),
    };
    const { data } = await storage.getBucket(CHAT_BUCKET);
    if (!data) {
      const { error } = await storage.createBucket(CHAT_BUCKET, options);
      if (error && !/exists/i.test(error.message)) throw new Error(`createBucket failed: ${error.message}`);
    } else if (data.public) {
      await storage.updateBucket(CHAT_BUCKET, options);
    }
  })().catch((err) => {
    bucketReady = null;
    throw err;
  });
  return bucketReady;
}

export const supabaseChatStorage: ChatStorage = {
  async createUploadUrl(path) {
    await ensureBucket();
    const { data, error } = await createSupabaseAdminClient()
      .storage.from(CHAT_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw new Error(`createSignedUploadUrl failed: ${error?.message}`);
    return { signedUrl: data.signedUrl, token: data.token };
  },

  async inspect(path) {
    const bucket = createSupabaseAdminClient().storage.from(CHAT_BUCKET);
    const { data, error } = await bucket.createSignedUrl(path, 30);
    if (error || !data) return null;
    const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
    if (!res.ok) return null;
    const head = new Uint8Array(await res.arrayBuffer()).slice(0, HEAD_BYTES);
    const range = res.headers.get("content-range"); // "bytes 0-4095/123456"
    const total = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length") ?? head.length);
    return { size: Number.isFinite(total) ? total : head.length, head };
  },

  async remove(paths) {
    if (paths.length === 0) return;
    const { error } = await createSupabaseAdminClient().storage.from(CHAT_BUCKET).remove(paths);
    if (error) throw new Error(`storage remove failed: ${error.message}`);
  },

  async createDownloadUrl(path, fileName) {
    const { data, error } = await createSupabaseAdminClient()
      .storage.from(CHAT_BUCKET)
      .createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS, { download: fileName });
    if (error || !data) throw new Error(`createSignedUrl failed: ${error?.message}`);
    return data.signedUrl;
  },
};
