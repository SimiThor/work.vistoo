import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConversationSkeleton, ConversationView } from "@/components/chat/conversation-view";
import { uuid } from "@/lib/validation";

export default function ConversationPage({ params }: PageProps<"/chat/[conversationId]">) {
  return (
    <Suspense fallback={<ConversationSkeleton />}>
      <Conversation params={params} />
    </Suspense>
  );
}

async function Conversation({ params }: { params: PageProps<"/chat/[conversationId]">["params"] }) {
  const { conversationId } = await params;
  if (!uuid.safeParse(conversationId).success) notFound();
  // Data is loaded client-side (access-checked server actions) so the view
  // can merge realtime updates and optimistic sends into one store.
  return <ConversationView key={conversationId} conversationId={conversationId} />;
}
