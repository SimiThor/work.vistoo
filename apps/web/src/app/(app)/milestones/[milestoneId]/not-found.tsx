import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function MilestoneNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">Meilenstein nicht gefunden</h1>
        <p className="mt-1 text-sm text-muted-foreground">Der Meilenstein existiert nicht oder du hast keinen Zugriff.</p>
        <Button asChild variant="outline" className="mt-5">
          <Link href="/milestones">Zu den Meilensteinen</Link>
        </Button>
      </div>
    </div>
  );
}
