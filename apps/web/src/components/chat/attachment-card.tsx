"use client";

import { Download, FileImage, FileSpreadsheet, FileText, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { downloadUrlAction } from "@/app/actions/chat";
import { Button } from "@/components/ui/button";
import { fileTypeForName, formatBytes } from "@vistoo/domain/chat-config";
import type { AttachmentDTO } from "@vistoo/domain/chat-types";
import { cn } from "@/lib/utils";

function FileIcon({ name }: { name: string }) {
  const t = fileTypeForName(name);
  const Icon = t?.mime.startsWith("image/")
    ? FileImage
    : t?.label === "Excel" || t?.label === "CSV"
      ? FileSpreadsheet
      : FileText;
  return <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />;
}

/**
 * Downloads via a fresh, short-lived signed URL (re-checked on the server).
 * Fetched as a blob so the original file name is kept; nothing renders inline.
 */
async function download(att: AttachmentDTO) {
  const res = await downloadUrlAction({ id: att.id });
  if (!res.ok) {
    toast.error(res.error.message);
    return;
  }
  try {
    const blob = await (await fetch(res.data.url)).blob();
    const href = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = att.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch {
    toast.error("Die Datei konnte nicht geladen werden.");
  }
}

export function AttachmentCard({ attachment }: { attachment: AttachmentDTO }) {
  const [busy, setBusy] = useState(false);
  const type = fileTypeForName(attachment.fileName)?.label ?? "Datei";
  return (
    <div className="flex w-full max-w-sm min-w-0 items-center gap-3 rounded-lg border bg-background px-3 py-2">
      <FileIcon name={attachment.fileName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={attachment.fileName}>
          {attachment.fileName}
        </p>
        <p className="text-xs text-muted-foreground">
          {type} · {formatBytes(attachment.sizeBytes)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`„${attachment.fileName}“ herunterladen`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await download(attachment);
          setBusy(false);
        }}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
      </Button>
    </div>
  );
}

/** Composer chip for an upload in progress / ready / failed. */
export function UploadChip({
  name,
  sizeBytes,
  status,
  progress,
  error,
  onRemove,
}: {
  name: string;
  sizeBytes: number;
  status: "uploading" | "ready" | "error";
  progress: number;
  error: string | null;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-lg border bg-background px-2.5 py-1.5 sm:w-64",
        status === "error" && "border-destructive/40",
      )}
    >
      <FileIcon name={name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={name}>
          {name}
        </p>
        {status === "error" ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : status === "uploading" ? (
          <div
            className="mt-1 h-1 overflow-hidden rounded-full bg-surface-sunken"
            role="progressbar"
            aria-label={`Upload von ${name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div className="h-full bg-accent-blue transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{formatBytes(sizeBytes)}</p>
        )}
      </div>
      <Button variant="ghost" size="icon-xs" aria-label={`„${name}“ entfernen`} onClick={onRemove}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
