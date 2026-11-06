import { projectColorHex } from "@vistoo/domain";
import { cn } from "@/lib/utils";

export function ProjectDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: projectColorHex(color) }}
    />
  );
}
