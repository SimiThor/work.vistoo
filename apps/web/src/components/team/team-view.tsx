"use client";

import { MoreHorizontal, UserPlus } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resendInvitationAction,
  revokeInvitationAction,
  updateOwnNameAction,
} from "@/app/actions/team";
import { FieldError, FormAlert } from "@/components/form-feedback";
import { MemberAvatar } from "@/components/member-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatInstantDate } from "@vistoo/domain/dates";
import {
  displayName,
  INVITATION_TTL_DAYS,
  ROLE_LABEL,
  type InvitationDTO,
  type MemberDTO,
  type MemberRole,
} from "@vistoo/domain";

type Me = { userId: string; email: string; fullName: string | null; role: MemberRole };

const fmtDate = (iso: string) => formatInstantDate(iso);

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "accent" | "warn" }) {
  const cls =
    tone === "accent"
      ? "bg-accent-blue-soft text-accent-blue-text"
      : tone === "warn"
        ? "bg-warning-bg text-warning-fg"
        : "bg-surface-subtle text-muted-foreground";
  return <span className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ${cls}`}>{children}</span>;
}

export function TeamView({ me, members, invitations }: { me: Me; members: MemberDTO[]; invitations: InvitationDTO[] }) {
  const isAdmin = me.role === "admin";
  const [inviting, setInviting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [removing, setRemoving] = useState<MemberDTO | null>(null);
  const [revoking, setRevoking] = useState<InvitationDTO | null>(null);
  const [, startTransition] = useTransition();
  const adminCount = members.filter((m) => m.role === "admin").length;

  const run = (p: Promise<{ ok: boolean; error?: { message: string } }>, success?: string) =>
    startTransition(async () => {
      const res = await p;
      if (!res.ok) toast.error(res.error?.message ?? "Fehler");
      else if (success) toast.success(success);
    });

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Team</h1>
        {isAdmin && (
          <Button className="h-8" onClick={() => setInviting(true)}>
            <UserPlus aria-hidden /> Mitglied einladen
          </Button>
        )}
      </div>
      {!isAdmin && (
        <p className="mt-2 text-sm text-muted-foreground">Nur Admins können Mitglieder einladen oder Rollen ändern.</p>
      )}

      <section aria-labelledby="members-heading" className="mt-6">
        <h2 id="members-heading" className="mb-2 text-[13px] font-semibold text-muted-foreground">
          Mitglieder · {members.length}
        </h2>
        <ul className="divide-y rounded-xl border">
          {members.map((m) => {
            const isMe = m.userId === me.userId;
            const lastAdmin = m.role === "admin" && adminCount <= 1;
            return (
              <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                <MemberAvatar member={m} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {displayName(m)}
                    {isMe && <span className="font-normal text-muted-foreground"> (du)</span>}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{m.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={m.role === "admin" ? "accent" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
                  <span className="hidden text-xs text-muted-foreground sm:inline">Aktiv</span>
                  {(isAdmin || isMe) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Aktionen für ${displayName(m)}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        {isMe && <DropdownMenuItem onSelect={() => setEditingName(true)}>Namen ändern</DropdownMenuItem>}
                        {isAdmin && (
                          <>
                            <DropdownMenuLabel className="text-xs text-muted-foreground">Rolle</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                              value={m.role}
                              onValueChange={(role) =>
                                run(changeMemberRoleAction({ userId: m.userId, role }), "Rolle geändert")
                              }
                            >
                              <DropdownMenuRadioItem value="admin">Admin</DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="member" disabled={lastAdmin}>
                                Mitglied
                              </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                            {lastAdmin && (
                              <p className="px-2 pb-1 text-xs text-muted-foreground">Der letzte Admin kann nicht herabgestuft werden.</p>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" disabled={lastAdmin} onSelect={() => setRemoving(m)}>
                              Aus dem Team entfernen …
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {(invitations.length > 0 || isAdmin) && (
        <section aria-labelledby="invites-heading" className="mt-8">
          <h2 id="invites-heading" className="mb-2 text-[13px] font-semibold text-muted-foreground">
            Offene Einladungen · {invitations.length}
          </h2>
          {invitations.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Keine offenen Einladungen.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-4 py-3">
                  <MemberAvatar member={{ email: inv.email, fullName: null }} size="md" className="opacity-60" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{inv.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {inv.expired ? `Abgelaufen am ${fmtDate(inv.expiresAt)}` : `Eingeladen · gültig bis ${fmtDate(inv.expiresAt)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge>{ROLE_LABEL[inv.role]}</Badge>
                    <Badge tone={inv.expired ? "warn" : "neutral"}>{inv.expired ? "Abgelaufen" : "Ausstehend"}</Badge>
                    {isAdmin && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Aktionen für Einladung an ${inv.email}`}>
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => run(resendInvitationAction({ id: inv.id }), "Einladung erneut gesendet")}
                          >
                            Erneut senden
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={() => setRevoking(inv)}>
                            Widerrufen …
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <InviteDialog open={inviting} onOpenChange={setInviting} />
      <NameDialog open={editingName} onOpenChange={setEditingName} current={me.fullName ?? ""} />

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{removing ? displayName(removing) : ""} entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              Der Zugriff endet sofort, auch in bereits geöffneten Sitzungen. Aufgaben bleiben erhalten; Aufgaben,
              für die die Person verantwortlich ist, werden auf „Nicht zugewiesen“ gesetzt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => removing && run(removeMemberAction({ userId: removing.userId }), "Mitglied entfernt")}
            >
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Einladung widerrufen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Einladung an {revoking?.email} wird ungültig. Ein bereits verschickter Link gewährt keinen Zugang mehr.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => revoking && run(revokeInvitationAction({ id: revoking.id }), "Einladung widerrufen")}
            >
              Widerrufen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const emailId = useId();
  const roleId = useId();

  const reset = () => {
    setEmail("");
    setRole("member");
    setFieldError(null);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setFieldError(null);
            setError(null);
            startTransition(async () => {
              const res = await inviteMemberAction({ email, role });
              if (!res.ok) {
                if (res.error.fieldErrors?.email) setFieldError(res.error.fieldErrors.email);
                else setError(res.error.message);
                return;
              }
              toast.success(`Einladung an ${res.data.email} gesendet`);
              reset();
              onOpenChange(false);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Mitglied einladen</DialogTitle>
            <DialogDescription>
              Die Person erhält eine E-Mail mit Anmeldelink. Die Einladung gilt {INVITATION_TTL_DAYS} Tage und nur für
              diese Adresse.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={emailId}>E-Mail-Adresse</Label>
            <Input
              id={emailId}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldError) || undefined}
              aria-describedby={fieldError ? `${emailId}-error` : undefined}
              autoFocus
            />
            <FieldError id={`${emailId}-error`} message={fieldError} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={roleId}>Rolle</Label>
            <Select value={role} onValueChange={(v) => setRole(v as MemberRole)}>
              <SelectTrigger id={roleId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Mitglied – bearbeitet Projekte und Aufgaben</SelectItem>
                <SelectItem value="admin">Admin – verwaltet zusätzlich das Team</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <FormAlert message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Wird gesendet …" : "Einladung senden"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NameDialog({ open, onOpenChange, current }: { open: boolean; onOpenChange: (o: boolean) => void; current: string }) {
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form
          noValidate
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await updateOwnNameAction({ fullName: name });
              if (!res.ok) return setError(res.error.fieldErrors?.fullName ?? res.error.message);
              setError(null);
              onOpenChange(false);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Namen ändern</DialogTitle>
            <DialogDescription className="sr-only">Dein angezeigter Name</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={id}>Name</Label>
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              autoFocus
            />
            <FieldError id={`${id}-error`} message={error} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
