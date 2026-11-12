import { MemberAvatar } from "@/components/member-avatar";
import { SettingsButton } from "./nav";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName, ROLE_LABEL } from "@vistoo/domain";
import { getViewer } from "@/server/queries";

export async function UserMenu() {
  const { me } = await getViewer();
  return (
    <div className="flex items-center gap-2 px-1">
      <MemberAvatar member={me} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName(me)}</p>
        <p className="truncate text-xs text-muted-foreground">{ROLE_LABEL[me.role]}</p>
      </div>
      <div className="flex shrink-0 items-center">
        <ThemeToggle />
        <SettingsButton />
        <SignOutButton />
      </div>
    </div>
  );
}

export function UserMenuSkeleton() {
  return (
    <div className="flex items-center gap-2 px-1" aria-hidden>
      <Skeleton className="size-8 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-14" />
      </div>
    </div>
  );
}
