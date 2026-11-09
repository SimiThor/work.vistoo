"use client";

import { AlertCircle, Loader2, MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CHAT_LIMITS } from "@vistoo/domain/chat-config";
import type { ChatPerson, MessageDTO } from "@vistoo/domain/chat-types";
import { displayName } from "@vistoo/domain";
import { editorToMarkup, markupToEditor, mentionsAll } from "@vistoo/domain/mentions";
import type { IssueRefDTO } from "@vistoo/domain";
import { issueRefNumber } from "./issue-refs";
import { cn } from "@/lib/utils";
import { AttachmentCard } from "./attachment-card";
import { MentionTextarea, type MentionPerson, type MentionTextareaHandle, type MentionValue } from "./mention-textarea";
import { MessageText } from "./message-text";

export type MessageVM = MessageDTO & {
  status: "sent" | "sending" | "failed";
  error?: string;
};

const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const fullFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeStyle: "short" });

export function MessageItem({
  message,
  author,
  own,
  compact,
  canAct,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
  me,
  nameOf,
  mentionCandidates,
  highlighted = false,
}: {
  message: MessageVM;
  author: ChatPerson | undefined;
  own: boolean;
  /** Same author as the previous message within a few minutes. */
  compact: boolean;
  /** Writable conversation (edit/delete allowed). */
  canAct: boolean;
  onEdit: (body: string) => Promise<boolean>;
  onDelete: () => void;
  onRetry: () => void;
  onDiscard: () => void;
  me: string | null;
  nameOf: (userId: string) => string | null;
  mentionCandidates: readonly MentionPerson[];
  /** Briefly emphasised (opened from a notification). */
  highlighted?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const created = new Date(message.createdAt);
  const name = author ? displayName(author) : "Ehemaliges Mitglied";
  const showActions = own && canAct && message.status === "sent" && !message.deleted;
  const mentionsMe =
    me !== null && !own && !message.deleted && (message.mentionIds.includes(me) || mentionsAll(message.markup));

  return (
    <li
      id={`message-${message.id}`}
      className={cn(
        "group/msg relative grid scroll-mt-16 grid-cols-[2rem_1fr] gap-x-3 px-4 transition-colors duration-700 hover:bg-surface-subtle/60 sm:px-5",
        compact ? "py-0.5" : "pt-2 pb-0.5",
        message.status === "failed" && "bg-destructive/5",
        mentionsMe && "bg-accent-blue-soft/35 shadow-[inset_2px_0_0_var(--accent-blue)]",
        highlighted && "bg-accent-blue-soft/80",
      )}
    >
      <div className="pt-0.5">
        {compact ? (
          <time
            dateTime={message.createdAt}
            title={fullFmt.format(created)}
            className="block pt-1 text-right text-[10px] leading-tight text-muted-foreground opacity-0 tabular-nums group-hover/msg:opacity-100"
          >
            {timeFmt.format(created)}
          </time>
        ) : (
          <MemberAvatar member={author ?? null} size="md" />
        )}
      </div>
      <div className="min-w-0">
        {!compact && (
          <p className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold">{name}</span>
            <time dateTime={message.createdAt} title={fullFmt.format(created)} className="text-xs text-muted-foreground tabular-nums">
              {timeFmt.format(created)}
            </time>
          </p>
        )}
        {compact && <span className="sr-only">{name}, {timeFmt.format(created)}: </span>}

        {message.deleted ? (
          <p className="text-sm text-muted-foreground italic">Nachricht gelöscht</p>
        ) : editing ? (
          <EditForm
            initial={message.markup}
            issueRefs={message.issueRefs}
            nameOf={nameOf}
            mentionCandidates={mentionCandidates}
            allowEmpty={message.attachments.length > 0}
            onCancel={() => setEditing(false)}
            onSave={async (body) => {
              if (await onEdit(body)) setEditing(false);
            }}
          />
        ) : (
          <>
            {message.markup && <MessageText text={message.markup} nameOf={nameOf} me={me} issueRefs={message.issueRefs} />}
            {message.editedAt && <span className="text-xs text-muted-foreground"> (bearbeitet)</span>}
            {message.attachments.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1.5" aria-label="Anhänge">
                {message.attachments.map((a) => (
                  <li key={a.id}>
                    <AttachmentCard attachment={a} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {message.status === "sending" && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Wird gesendet …
          </p>
        )}
        {message.status === "failed" && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" role="alert">
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="size-3.5" aria-hidden />
              {message.error ?? "Nicht gesendet."}
            </span>
            <Button variant="ghost" size="xs" onClick={onRetry}>
              Erneut senden
            </Button>
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={onDiscard}>
              In Eingabe übernehmen
            </Button>
          </div>
        )}
      </div>

      {showActions && !editing && (
        <div className="absolute top-1 right-3 [@media(hover:hover)]:opacity-0 group-focus-within/msg:opacity-100 group-hover/msg:opacity-100">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon-xs"
                className="bg-background data-[state=open]:opacity-100"
                aria-label="Aktionen für deine Nachricht"
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(true)}>Bearbeiten</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                Löschen …
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </li>
  );
}

function EditForm({
  initial,
  issueRefs,
  allowEmpty,
  onCancel,
  onSave,
  nameOf,
  mentionCandidates,
}: {
  /** Markup of the message. */
  initial: string;
  /** Server-resolved `#` references of the message (labels in the editor). */
  issueRefs: readonly IssueRefDTO[];
  allowEmpty: boolean;
  onCancel: () => void;
  onSave: (markup: string) => Promise<void>;
  nameOf: (userId: string) => string | null;
  mentionCandidates: readonly MentionPerson[];
}) {
  const [value, setValue] = useState<MentionValue>(() =>
    markupToEditor(initial, nameOf, (id) => issueRefs.find((r) => r.id === id)?.number ?? issueRefNumber(id)),
  );
  const [busy, setBusy] = useState(false);
  const ref = useRef<MentionTextareaHandle>(null);
  const id = useId();
  const initialLength = useRef(value.text.length);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.setCaret(initialLength.current);
  }, []);
  const markup = editorToMarkup(value.text, value.mentions);
  const tooLong = markup.length > CHAT_LIMITS.maxMessageLength;
  const empty = !value.text.trim() && !allowEmpty;
  const save = async () => {
    if (busy || tooLong || empty) return;
    setBusy(true);
    await onSave(markup);
    setBusy(false);
  };
  return (
    <div className="mt-1 space-y-1.5">
      <label htmlFor={id} className="sr-only">
        Nachricht bearbeiten
      </label>
      <MentionTextarea
        id={id}
        ref={ref}
        value={value}
        onValueChange={setValue}
        candidates={mentionCandidates}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            void save();
          }
        }}
        aria-invalid={tooLong || undefined}
        className="field-sizing-content block max-h-60 min-h-16 w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35"
      />
      {tooLong && (
        <p className="text-xs text-destructive" role="alert">
          Höchstens {CHAT_LIMITS.maxMessageLength.toLocaleString("de-DE")} Zeichen.
        </p>
      )}
      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => void save()} disabled={busy || tooLong || empty}>
          Speichern
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
        <span className="self-center text-xs text-muted-foreground">Esc zum Abbrechen</span>
      </div>
    </div>
  );
}
