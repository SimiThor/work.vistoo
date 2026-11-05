import { MessageSquare } from "lucide-react";

/** Desktop placeholder; on phones the conversation list fills the screen instead. */
export default function ChatIndexPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-xs text-center">
        <MessageSquare className="mx-auto size-6 text-muted-foreground" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">Chat</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wähle links einen Kanal oder eine Direktnachricht, oder beginne eine neue Unterhaltung.
        </p>
      </div>
    </div>
  );
}
