import "server-only";
import { currentLimits, type EndpointInput, type EndpointOutput, type Endpoints, type OperationId } from "@vistoo/contracts";
import type { AuthContext, AuthUser } from "../auth";
import { DOWNLOAD_URL_TTL_SECONDS } from "../chat-storage";
import * as chat from "../services/chat";
import * as files from "../services/chat-files";
import { acceptInvitation } from "../services/invitations";
import { requestLoginCode, type OtpSender } from "../services/login";
import * as projects from "../services/projects";
import * as notifications from "../services/notifications";
import { getMe, getViewerProfile } from "../services/session";
import * as tasks from "../services/tasks";
import * as team from "../services/team";
import { createSupabaseAnonClient, getSupabaseConfig } from "../supabase";

/**
 * /api/v1 operation → shared service. No business rules live here: every
 * handler calls exactly the service function the web's Server Actions call.
 */

type CtxFor<K extends OperationId> = Endpoints[K]["auth"] extends "public"
  ? null
  : Endpoints[K]["auth"] extends "session"
    ? AuthUser
    : AuthContext;

type Handler<K extends OperationId> = (ctx: CtxFor<K>, input: EndpointInput<K>) => Promise<EndpointOutput<K>>;
export type Handlers = { [K in OperationId]: Handler<K> };

export function minimumIosBuild(): number {
  const n = Number(process.env.MIN_IOS_BUILD ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export const handlers: Handlers = {
  // ---- Meta / session
  getMeta: async () => {
    const { url, publishableKey } = getSupabaseConfig();
    return {
      apiVersion: "1",
      environment: process.env.VISTOO_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      supabaseUrl: url,
      supabasePublishableKey: publishableKey,
      minimumIosBuild: minimumIosBuild(),
    };
  },
  requestLoginCode: (_, { body }) =>
    requestLoginCode(createSupabaseAnonClient() as unknown as OtpSender, body.email, "ios"),
  getMe: (user) => getMe(user),
  acceptInvitation: async (user, { body }) => {
    await acceptInvitation(user, body);
    return getMe(user);
  },
  getBootstrap: async (ctx) => {
    const [viewer, projectList, members, formerMembers] = await Promise.all([
      getViewerProfile(ctx),
      projects.listProjects(ctx),
      team.listMembers(ctx),
      team.listFormerMembers(ctx),
    ]);
    return { viewer, projects: projectList, members, formerMembers, limits: currentLimits() };
  },
  updateProfile: async (ctx, { body }) => {
    await team.updateOwnName(ctx, body);
  },

  // ---- Push notifications
  registerDevice: async (ctx, { params, body }) => {
    await notifications.registerDevice(ctx, { token: params.token, ...body });
  },
  unregisterDevice: async (user, { params }) => {
    await notifications.unregisterDevice(user, params.token);
  },
  getNotificationSettings: (ctx) => notifications.getNotificationSettings(ctx),
  updateNotificationSettings: (ctx, { body }) => notifications.updateNotificationSettings(ctx, body),

  // ---- Tasks
  listTasks: async (ctx, { query }) => {
    if (query.projectId) await projects.getProject(ctx, query.projectId); // NOT_FOUND for foreign ids
    return { tasks: await tasks.listTasks(ctx, query.projectId ? { projectId: query.projectId } : {}) };
  },
  createTask: (ctx, { body }) => tasks.createTask(ctx, body),
  getTask: (ctx, { params }) => tasks.getTask(ctx, params.id),
  updateTask: (ctx, { params, body }) => tasks.updateTask(ctx, { id: params.id, ...body }),
  deleteTask: async (ctx, { params }) => {
    await tasks.deleteTask(ctx, params.id);
  },
  moveTask: (ctx, { params, body }) => tasks.moveTask(ctx, { id: params.id, ...body }),
  setTaskStatus: (ctx, { params, body }) => tasks.setTaskStatus(ctx, { id: params.id, ...body }),
  setTaskAssignee: (ctx, { params, body }) => tasks.setTaskAssignee(ctx, { id: params.id, ...body }),

  // ---- Projects & groups
  listProjects: async (ctx) => {
    const [list, stats] = await Promise.all([projects.listProjects(ctx), projects.projectStats(ctx)]);
    return { projects: list, stats };
  },
  createProject: (ctx, { body }) => projects.createProject(ctx, body),
  getProject: (ctx, { params }) => projects.getProject(ctx, params.id),
  updateProject: (ctx, { params, body }) => projects.updateProject(ctx, { id: params.id, ...body }),
  setProjectArchived: (ctx, { params, body }) => projects.setProjectArchived(ctx, { id: params.id, ...body }),
  createGroup: (ctx, { params, body }) => projects.createGroup(ctx, { projectId: params.id, ...body }),
  renameGroup: (ctx, { params, body }) => projects.renameGroup(ctx, { id: params.id, ...body }),
  deleteGroup: (ctx, { params }) => projects.deleteGroup(ctx, params.id),

  // ---- Team
  getTeam: (ctx) => team.listTeam(ctx),
  inviteMember: (ctx, { body }) => team.inviteMember(ctx, body),
  resendInvitation: async (ctx, { params }) => {
    await team.resendInvitation(ctx, params.id);
  },
  revokeInvitation: async (ctx, { params }) => {
    await team.revokeInvitation(ctx, params.id);
  },
  changeMemberRole: async (ctx, { params, body }) => {
    await team.changeMemberRole(ctx, { userId: params.userId, role: body.role });
  },
  removeMember: (ctx, { params }) => team.removeMember(ctx, params.userId),

  // ---- Chat
  listConversations: async (ctx) => ({ conversations: await chat.listConversations(ctx) }),
  createChannel: (ctx, { body }) => chat.createChannel(ctx, body),
  openDirectMessage: (ctx, { body }) => chat.openDm(ctx, body.userId),
  getConversation: (ctx, { params }) => chat.getConversationDetail(ctx, params.id),
  updateChannel: async (ctx, { params, body }) => {
    await chat.updateChannel(ctx, { id: params.id, ...body });
  },
  setChannelArchived: async (ctx, { params, body }) => {
    await chat.setChannelArchived(ctx, { id: params.id, ...body });
  },
  addChannelMembers: async (ctx, { params, body }) => {
    await chat.addChannelMembers(ctx, { id: params.id, ...body });
  },
  removeChannelMember: (ctx, { params, body }) => chat.removeChannelMember(ctx, { id: params.id, ...body }),
  listMessages: (ctx, { params, query }) =>
    chat.listMessages(ctx, {
      conversationId: params.id,
      beforeSeq: query.beforeSeq ?? null,
      afterSeq: query.afterSeq ?? null,
    }),
  sendMessage: (ctx, { params, body }) =>
    chat.sendMessage(ctx, { id: params.messageId, conversationId: params.id, ...body }),
  getMessage: (ctx, { params }) => chat.getMessage(ctx, params.id),
  editMessage: (ctx, { params, body }) => chat.editMessage(ctx, { id: params.id, ...body }),
  deleteMessage: (ctx, { params }) => chat.deleteMessage(ctx, params.id),
  markRead: (ctx, { params, body }) => chat.markRead(ctx, { conversationId: params.id, ...body }),

  // ---- Files
  reserveUpload: (ctx, { params, body }) => files.reserveUpload(ctx, { conversationId: params.id, ...body }),
  finalizeUpload: (ctx, { params }) => files.finalizeUpload(ctx, params.id),
  discardUpload: async (ctx, { params }) => {
    await files.discardUpload(ctx, params.id);
  },
  getDownloadUrl: async (ctx, { params }) => ({
    ...(await files.getDownloadUrl(ctx, params.id)),
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  }),
  getChatStorageUsage: (ctx) => files.getChatStorageUsage(ctx),
};
