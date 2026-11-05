"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addChannelMembersAction,
  conversationDetailAction,
  removeChannelMemberAction,
  setChannelArchivedAction,
  updateChannelAction,
} from "@/app/actions/chat";
import { FieldError, FormAlert } from "@/components/form-feedback";
import { MemberAvatar } from "@/components/member-avatar";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { CHAT_LIMITS } from "@/lib/chat-config";
import type { ChatPerson, ConversationDetail } from "@/lib/chat-types";
import { formatInstantDate } from "@/lib/dates";
import { displayName } from "@/lib/domain";
import { useChat } from "./chat-context";
import { MemberPicker } from "./member-picker";

export function ConversationDetails({
  conversationId,
  open,
  onOpenChange,
  onChanged,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {open && <Body conversationId={conversationId} onChanged={onChanged} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function Body({ conversationId, onChanged, onClose }: { conversationId: string; onChanged: () => void; onClose: () => void }) {
  const router = useRouter();
  const { me, members: workspaceMembers, reload } = useChat();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState<string[] | null>(null);
  const [removing, setRemoving] = useState<ChatPerson | null>(null);

  const load = useCallback(async () => {
    const res = await conversationDetailAction({ id: conversationId });
    if (res.ok) setDetail(res.data);
    else setError(res.error.message);
  }, [conversationId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const after = async (msg?: string) => {
    if (msg) toast.success(msg);
    await Promise.all([load(), reload()]);
    onChanged();
  };

  if (error) return <div className="p-6"><FormAlert message={error} /></div>;
  if (!detail) {
    return (
      <div className="space-y-3 p-6" aria-busy="true" aria-label="Details werden geladen">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  const isChannel = detail.kind !== "dm";
  const isPrivate = detail.kind === "private_channel";
  const owner = detail.members.find((m) => m.userId === detail.ownerId) ?? workspaceMembers.find((m) => m.userId === detail.ownerId);
  const nonMembers = workspaceMembers.filter((m) => !detail.members.some((x) => x.userId === m.userId));
  const amMember = detail.members.some((m) => m.userId === me?.userId);

  return (
    <div className="flex flex-col">
      <SheetHeader className="border-b px-6 py-4">
        <SheetTitle className="text-lg">{isChannel ? detail.title : "Direktnachricht"}</SheetTitle>
        <SheetDescription>
          {detail.kind === "dm"
            ? "Nur ihr beide könnt diese Unterhaltung und ihre Anhänge sehen."
            : isPrivate
              ? "Geschlossener Kanal: nur für hinzugefügte Mitglieder."
              : "Offener Kanal: für alle Mitglieder des Workspaces."}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-6 py-5">
        {detail.kind === "dm" && detail.dmPartner && (
          <div className="flex items-center gap-3">
            <MemberAvatar member={detail.dmPartner} size="md" />
            <div className="min-w-0">
              <p className="truncate font-medium">{displayName(detail.dmPartner)}</p>
              <p className="truncate text-sm text-muted-foreground">{detail.dmPartner.email}</p>
              {!detail.dmPartner.active && <p className="text-sm text-muted-foreground">Kein aktives Mitglied mehr</p>}
            </div>
          </div>
        )}

        {isChannel && (
          <>
            {detail.canManage && !detail.archived ? (
              <ChannelForm detail={detail} onSaved={() => after("Kanal gespeichert")} />
            ) : (
              detail.description && <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{detail.description}</p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Verantwortlich</dt>
              <dd className="truncate">{owner ? displayName(owner) : "Admins des Workspaces"}</dd>
              <dt className="text-muted-foreground">Erstellt</dt>
              <dd>{formatInstantDate(detail.createdAt, "long")}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>{detail.archived ? "Archiviert (nur lesbar)" : "Aktiv"}</dd>
            </dl>
          </>
        )}

        {isPrivate && (
          <section aria-labelledby="members-h" className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 id="members-h" className="text-sm font-semibold">
                Mitglieder · {detail.members.length}
              </h3>
              {detail.canManage && !detail.archived && nonMembers.length > 0 && adding === null && (
                <Button size="sm" variant="outline" onClick={() => setAdding([])}>
                  Hinzufügen
                </Button>
              )}
            </div>
            {adding !== null && (
              <div className="space-y-2 rounded-lg border p-3">
                <MemberPicker
                  label="Mitglieder hinzufügen"
                  members={nonMembers}
                  selected={adding}
                  multiple
                  onToggle={(id) => setAdding((s) => (s!.includes(id) ? s!.filter((x) => x !== id) : [...s!, id]))}
                />
                <p className="text-xs text-muted-foreground">
                  Neue Mitglieder sehen auch den bisherigen Verlauf und alle Anhänge dieses Kanals.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={adding.length === 0 || pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await addChannelMembersAction({ id: detail.id, userIds: adding });
                        if (!res.ok) return void toast.error(res.error.message);
                        setAdding(null);
                        await after("Mitglieder hinzugefügt");
                      })
                    }
                  >
                    Hinzufügen
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                    Abbrechen
                  </Button>
                </div>
              </div>
            )}
            <ul className="divide-y rounded-lg border">
              {detail.members.map((m) => {
                const self = m.userId === me?.userId;
                const canRemove = !detail.archived && (self || detail.canManage);
                return (
                  <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
                    <MemberAvatar member={m} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {displayName(m)}
                      {self && <span className="text-muted-foreground"> (du)</span>}
                      {m.userId === detail.ownerId && <span className="text-muted-foreground"> · verantwortlich</span>}
                      {!m.active && <span className="text-muted-foreground"> · inaktiv</span>}
                    </span>
                    {canRemove && (
                      <Button size="xs" variant="ghost" onClick={() => setRemoving(m)}>
                        {self ? "Verlassen" : "Entfernen"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {isChannel && detail.canManage && !detail.isDefault && (
          <div className="border-t pt-5">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await setChannelArchivedAction({ id: detail.id, archived: !detail.archived });
                  if (!res.ok) return void toast.error(res.error.message);
                  await after(detail.archived ? "Kanal wiederhergestellt" : "Kanal archiviert");
                })
              }
            >
              {detail.archived ? "Kanal wiederherstellen" : "Kanal archivieren"}
            </Button>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {detail.archived
                ? "Danach können wieder Nachrichten geschrieben werden."
                : "Archivierte Kanäle bleiben lesbar, nehmen aber keine neuen Nachrichten an."}
            </p>
          </div>
        )}
        {!amMember && isPrivate && <p className="text-sm text-muted-foreground">Du bist kein Mitglied dieses Kanals.</p>}
      </div>

      <RemoveMemberDialog
        detail={detail}
        member={removing}
        onClose={() => setRemoving(null)}
        onDone={async (archived, self) => {
          setRemoving(null);
          if (self) {
            await reload();
            onClose();
            router.push("/chat");
            toast.success(archived ? "Kanal verlassen und archiviert" : "Kanal verlassen");
          } else {
            await after(archived ? "Entfernt und Kanal archiviert" : "Mitglied entfernt");
          }
        }}
      />
    </div>
  );
}

function ChannelForm({ detail, onSaved }: { detail: ConversationDetail; onSaved: () => void }) {
  const [name, setName] = useState(detail.title);
  const [description, setDescription] = useState(detail.description);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const nameId = useId();
  const descId = useId();
  const dirty = name !== detail.title || description !== detail.description;
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setErrors({ name: "Bitte gib einen Namen ein." });
        startTransition(async () => {
          const res = await updateChannelAction({ id: detail.id, name, description });
          if (!res.ok) return setErrors(res.error.fieldErrors ?? { _: res.error.message });
          setErrors({});
          onSaved();
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          value={name}
          maxLength={CHAT_LIMITS.channelNameMax}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={Boolean(errors.name) || undefined}
          aria-describedby={errors.name ? `${nameId}-e` : undefined}
        />
        <FieldError id={`${nameId}-e`} message={errors.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={descId}>Beschreibung</Label>
        <Textarea
          id={descId}
          rows={2}
          value={description}
          maxLength={CHAT_LIMITS.channelDescriptionMax}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <FormAlert message={errors._} />
      {dirty && (
        <Button type="submit" size="sm" disabled={pending}>
          Speichern
        </Button>
      )}
    </form>
  );
}

/** Removing / leaving; the responsible member must hand over or archive. */
function RemoveMemberDialog({
  detail,
  member,
  onClose,
  onDone,
}: {
  detail: ConversationDetail;
  member: ChatPerson | null;
  onClose: () => void;
  onDone: (archived: boolean, self: boolean) => void;
}) {
  const { me } = useChat();
  const [newOwner, setNewOwner] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const self = member?.userId === me?.userId;
  const isOwner = member?.userId === detail.ownerId;
  const candidates = detail.members.filter((m) => m.userId !== member?.userId && m.active);
  const selectId = useId();

  const submit = (archive: boolean) =>
    startTransition(async () => {
      if (!member) return;
      const res = await removeChannelMemberAction({
        id: detail.id,
        userId: member.userId,
        newOwnerId: isOwner && !archive && newOwner ? newOwner : null,
        archive,
      });
      if (!res.ok) return setError(res.error.fieldErrors?.newOwnerId ?? res.error.message);
      onDone(res.data.archived, self);
    });

  return (
    <AlertDialog
      open={member !== null}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          setNewOwner("");
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{self ? "Kanal verlassen?" : `${member ? displayName(member) : ""} entfernen?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {self
              ? "Du verlierst den Zugriff auf diesen Kanal und seinen Verlauf."
              : "Die Person verliert sofort den Zugriff auf diesen Kanal und seinen Verlauf."}
            {isOwner && candidates.length > 0 && " Übergib vorher die Verantwortung oder archiviere den Kanal."}
            {isOwner && candidates.length === 0 && " Es bleibt niemand zurück: der Kanal wird archiviert."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {isOwner && candidates.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor={selectId}>Neue verantwortliche Person</Label>
            <Select value={newOwner} onValueChange={setNewOwner}>
              <SelectTrigger id={selectId} className="w-full">
                <SelectValue placeholder="Person wählen" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.userId} value={c.userId}>
                    {displayName(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <FormAlert message={error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          {isOwner && candidates.length > 0 && (
            <Button variant="outline" disabled={pending} onClick={() => submit(true)}>
              {self ? "Verlassen und archivieren" : "Entfernen und archivieren"}
            </Button>
          )}
          <Button
            variant="destructive"
            disabled={pending || (isOwner && candidates.length > 0 && !newOwner)}
            onClick={() => submit(isOwner && candidates.length === 0)}
          >
            {self ? "Verlassen" : "Entfernen"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
