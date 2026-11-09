"use client";

import { Paperclip, SendHorizontal } from "lucide-react";
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ACCEPT_ATTRIBUTE, CHAT_LIMITS } from "@vistoo/domain/chat-config";
import type { AttachmentDTO } from "@vistoo/domain/chat-types";
import { editorToMarkup, markupToEditor } from "@vistoo/domain/mentions";
import { issueRefNumber } from "./issue-refs";
import { UploadChip } from "./attachment-card";
import { MentionTextarea, type MentionPerson, type MentionTextareaHandle, type MentionValue } from "./mention-textarea";
import { discardUpload, precheckFile, uploadFile, type PendingUpload } from "./uploads";

/** `setText` takes markup (mention tokens are restored as mentions). */
export type ComposerHandle = { focus: () => void; setText: (markup: string) => void };

const isCoarsePointer = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/**
 * Plain-text composer with @mentions and #issue references. Desktop: Enter sends, Shift+Enter =
 * newline (IME-safe). Touch: Enter inserts a newline; the send button sends.
 * Drafts and sent bodies are markup (mentions as `<@user-id>`).
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    conversationId: string;
    label: string;
    initialDraft: string;
    onDraftChange: (markup: string) => void;
    onSend: (markup: string, attachments: AttachmentDTO[]) => void;
    /** People who may be mentioned in this conversation. */
    mentionCandidates: readonly MentionPerson[];
    /** Display name for a user id (also for people no longer mentionable). */
    nameOf: (userId: string) => string | null;
  }
>(function Composer({ conversationId, label, initialDraft, onDraftChange, onSend, mentionCandidates, nameOf }, ref) {
  const [value, setValue] = useState<MentionValue>(() => markupToEditor(initialDraft, nameOf, issueRefNumber));
  const text = value.text;
  const markup = editorToMarkup(value.text, value.mentions);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const textareaRef = useRef<MentionTextareaHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const uploadsRef = useRef(uploads);
  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);
  const id = useId();

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setText: (m: string) => {
      const next = markupToEditor(m, nameOf, issueRefNumber);
      setValue(next);
      onDraftChange(m);
      textareaRef.current?.focus();
    },
  }));

  // Leaving the conversation: abort running uploads, release unsent files.
  useEffect(() => {
    const ctrls = controllers.current;
    return () => {
      for (const c of ctrls.values()) c.abort();
      for (const u of uploadsRef.current) if (u.attachmentId) void discardUpload(u.attachmentId);
    };
  }, []);

  const patch = (localId: string, p: Partial<PendingUpload>) =>
    setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, ...p } : u)));

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    let count = uploads.length;
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      const problem = precheckFile(file, count);
      if (problem) {
        problems.push(problem);
        continue;
      }
      count++;
      const localId = crypto.randomUUID();
      const ctrl = new AbortController();
      controllers.current.set(localId, ctrl);
      const pending: PendingUpload = {
        localId,
        file,
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type,
        status: "uploading",
        progress: 0,
        attachmentId: null,
        error: null,
      };
      setUploads((list) => [...list, pending]);
      void uploadFile(conversationId, file, (p) => patch(localId, { progress: p }), ctrl.signal).then((res) => {
        controllers.current.delete(localId);
        if (ctrl.signal.aborted) return;
        patch(
          localId,
          res.ok
            ? { status: "ready", attachmentId: res.attachmentId, progress: 1 }
            : { status: "error", error: res.error },
        );
      });
    }
    setNotice(problems.length ? problems.join(" ") : null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const remove = (u: PendingUpload) => {
    controllers.current.get(u.localId)?.abort();
    controllers.current.delete(u.localId);
    if (u.attachmentId) void discardUpload(u.attachmentId);
    setUploads((list) => list.filter((x) => x.localId !== u.localId));
  };

  const uploading = uploads.some((u) => u.status === "uploading");
  const failed = uploads.some((u) => u.status === "error");
  const tooLong = markup.length > CHAT_LIMITS.maxMessageLength;
  const ready = uploads.filter((u) => u.status === "ready");
  const canSend = !uploading && !failed && !tooLong && (text.trim().length > 0 || ready.length > 0);

  const send = () => {
    if (!canSend) {
      if (failed) setNotice("Entferne zuerst die fehlgeschlagenen Anhänge oder lade sie erneut hoch.");
      else if (uploading) setNotice("Bitte warte, bis alle Anhänge hochgeladen sind.");
      return;
    }
    onSend(
      markup,
      ready.map((u) => ({ id: u.attachmentId!, fileName: u.fileName, mimeType: u.mimeType, sizeBytes: u.sizeBytes })),
    );
    setValue({ text: "", mentions: [] });
    onDraftChange("");
    setUploads([]);
    setNotice(null);
    textareaRef.current?.focus();
  };

  return (
    <div className="shrink-0 border-t bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
      {uploads.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Anhänge der neuen Nachricht">
          {uploads.map((u) => (
            <li key={u.localId} className="w-full sm:w-auto">
              <UploadChip
                name={u.fileName}
                sizeBytes={u.sizeBytes}
                status={u.status}
                progress={u.progress}
                error={u.error}
                onRemove={() => remove(u)}
              />
            </li>
          ))}
        </ul>
      )}
      {(notice || tooLong) && (
        <p className="mb-1.5 text-xs text-destructive" role="alert">
          {tooLong
            ? `Die Nachricht ist zu lang (${markup.length.toLocaleString("de-DE")} von ${CHAT_LIMITS.maxMessageLength.toLocaleString("de-DE")} Zeichen).`
            : notice}
        </p>
      )}
      <div className="flex items-end gap-1.5 rounded-xl border border-input bg-background px-1.5 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/35">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => addFiles(e.target.files)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 text-muted-foreground"
          aria-label={`Datei anhängen (höchstens ${CHAT_LIMITS.maxFilesPerMessage}, je 10 MB)`}
          title="Datei anhängen"
          disabled={uploads.length >= CHAT_LIMITS.maxFilesPerMessage}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip aria-hidden />
        </Button>
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <MentionTextarea
          id={id}
          ref={textareaRef}
          rows={1}
          value={value}
          candidates={mentionCandidates}
          wrapperClassName="flex-1"
          placeholder={label}
          onValueChange={(v) => {
            setValue(v);
            onDraftChange(editorToMarkup(v.text, v.mentions));
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (isCoarsePointer()) return; // newline on touch keyboards
            e.preventDefault();
            send();
          }}
          aria-invalid={tooLong || undefined}
          aria-describedby={`${id}-hint`}
          className="field-sizing-content block max-h-48 min-h-9 w-full resize-none bg-transparent px-1.5 py-2 text-[14px] leading-5 outline-none placeholder:text-muted-foreground"
        />
        <Button
          type="button"
          size="icon"
          className="size-9 shrink-0"
          aria-label="Senden"
          title="Senden"
          disabled={!canSend}
          onClick={send}
        >
          <SendHorizontal aria-hidden />
        </Button>
      </div>
      <p id={`${id}-hint`} className="mt-1 hidden px-1 text-[11px] text-muted-foreground [@media(pointer:fine)]:block">
        Enter sendet · Umschalt+Enter für neue Zeile · @ erwähnt jemanden · # verlinkt eine Aufgabe
      </p>
    </div>
  );
});
