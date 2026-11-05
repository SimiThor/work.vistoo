/** Chat DTOs shared by server and client. */

export type ConversationKind = "open_channel" | "private_channel" | "dm";

export type ChatPerson = { userId: string; fullName: string | null; email: string; active: boolean };

export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  /** Channel name; for DMs the partner's display name (computed per viewer). */
  title: string;
  description: string;
  archived: boolean;
  isDefault: boolean;
  ownerId: string | null;
  lastMessageAt: string | null;
  lastMessageSeq: number;
  lastReadSeq: number;
  unread: boolean;
  dmPartner: ChatPerson | null;
};

export type ConversationDetail = ConversationSummary & {
  createdBy: string | null;
  createdAt: string;
  /** Explicit participants (private channels, DMs). Empty for open channels. */
  members: ChatPerson[];
  canPost: boolean;
  readOnlyReason: "archived" | "inactive_partner" | null;
  canManage: boolean;
};

export type AttachmentDTO = { id: string; fileName: string; mimeType: string; sizeBytes: number };

export type MessageDTO = {
  id: string;
  seq: number;
  conversationId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  attachments: AttachmentDTO[];
};

export type ChatStorageUsage = { usedBytes: number; budgetBytes: number; ratio: number };

export type UploadTicket = {
  attachmentId: string;
  signedUrl: string;
  contentType: string;
};
