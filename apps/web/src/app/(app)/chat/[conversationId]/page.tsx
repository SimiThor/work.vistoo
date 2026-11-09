import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConversationSkeleton, ConversationView } from "@/components/chat/conversation-view";
import { uuid } from "@vistoo/domain/validation";

export default function ConversationPage({ params, searchParams }: PageProps<"/chat/[conversationId]">) {
  return (
    <Suspense fallback={<ConversationSkeleton />}>
      <Conversation params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Conversation({
  params,
  searchParams,
}: {
  params: PageProps<"/chat/[conversationId]">["params"];
  searchParams: PageProps<"/chat/[conversationId]">["searchParams"];
}) {
  const [{ conversationId }, query] = await Promise.all([params, searchParams]);
  if (!uuid.safeParse(conversationId).success) notFound();
  // ?message=<id>: opened from a notification → scroll to that message.
  const message = typeof query.message === "string" && uuid.safeParse(query.message).success ? query.message : null;
  // Data is loaded client-side (access-checked server actions) so the view
  // can merge realtime updates and optimistic sends into one store.
  return <ConversationView key={conversationId} conversationId={conversationId} focusMessageId={message} />;
}
