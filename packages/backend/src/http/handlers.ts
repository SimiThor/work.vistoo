import "server-only";
import { currentLimits, type EndpointInput, type EndpointOutput, type Endpoints, type OperationId } from "@vistoo/contracts";
import type { AuthContext, AuthUser } from "../auth";
import { DOWNLOAD_URL_TTL_SECONDS } from "../chat-storage";
import * as chat from "../services/chat";
import * as crm from "../services/crm";
import * as decisions from "../services/decisions";
import * as ideas from "../services/ideas";
import * as todos from "../services/todos";
import * as files from "../services/chat-files";
import * as inbox from "../services/inbox";
import * as issueRefs from "../services/issue-refs";
import { acceptInvitation } from "../services/invitations";
import { requestLoginCode, type OtpSender } from "../services/login";
import * as milestones from "../services/milestones";
import * as projects from "../services/projects";
import * as notifications from "../services/notifications";
import { getMe, getViewerProfile } from "../services/session";
import * as taskLinks from "../services/task-links";
import * as tasks from "../services/tasks";
import * as team from "../services/team";
import { updateMeetingUrl } from "../services/workspace";
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
  listNotifications: (ctx) => inbox.listNotifications(ctx),
  markNotificationsRead: (ctx, { body }) => inbox.markNotificationsRead(ctx, body),

  // ---- Tasks
  listTasks: async (ctx, { query }) => {
    // NOT_FOUND for foreign ids
    if (query.projectId) await projects.getProject(ctx, query.projectId);
    if (query.milestoneId) await milestones.getMilestone(ctx, query.milestoneId);
    return {
      tasks: await tasks.listTasks(ctx, {
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.milestoneId ? { milestoneId: query.milestoneId } : {}),
      }),
    };
  },
  createTask: (ctx, { body }) => tasks.createTask(ctx, body),
  searchIssues: async (ctx, { query }) => ({ issues: await issueRefs.searchIssues(ctx, { q: query.q ?? "" }) }),
  getTask: (ctx, { params }) => tasks.getTask(ctx, params.id),
  updateTask: (ctx, { params, body }) => tasks.updateTask(ctx, { id: params.id, ...body }),
  deleteTask: async (ctx, { params }) => {
    await tasks.deleteTask(ctx, params.id);
  },
  moveTask: (ctx, { params, body }) => tasks.moveTask(ctx, { id: params.id, ...body }),
  setTaskStatus: (ctx, { params, body }) => tasks.setTaskStatus(ctx, { id: params.id, ...body }),
  setTaskAssignee: (ctx, { params, body }) => tasks.setTaskAssignee(ctx, { id: params.id, ...body }),
  setTaskChecklistItem: (ctx, { params, body }) => tasks.setTaskChecklistItem(ctx, { id: params.id, ...body }),

  listTaskLinks: async (ctx, { params }) => ({ links: await taskLinks.listTaskLinks(ctx, params.id) }),
  createTaskLink: (ctx, { params, body }) => taskLinks.createTaskLink(ctx, { taskId: params.id, ...body }),
  updateTaskLink: (ctx, { params, body }) => taskLinks.updateTaskLink(ctx, { id: params.id, ...body }),
  deleteTaskLink: async (ctx, { params }) => {
    await taskLinks.deleteTaskLink(ctx, params.id);
  },

  // ---- Projects
  listProjects: async (ctx) => {
    const [list, stats] = await Promise.all([projects.listProjects(ctx), projects.projectStats(ctx)]);
    return { projects: list, stats };
  },
  createProject: (ctx, { body }) => projects.createProject(ctx, body),
  getProject: (ctx, { params }) => projects.getProject(ctx, params.id),
  updateProject: (ctx, { params, body }) => projects.updateProject(ctx, { id: params.id, ...body }),
  setProjectArchived: (ctx, { params, body }) => projects.setProjectArchived(ctx, { id: params.id, ...body }),

  // ---- Milestones
  listMilestones: async (ctx) => ({ milestones: await milestones.listMilestones(ctx) }),
  createMilestone: (ctx, { body }) => milestones.createMilestone(ctx, body),
  getMilestone: (ctx, { params }) => milestones.getMilestone(ctx, params.id),
  updateMilestone: (ctx, { params, body }) => milestones.updateMilestone(ctx, { id: params.id, ...body }),
  setMilestoneCompleted: (ctx, { params, body }) => milestones.setMilestoneCompleted(ctx, { id: params.id, ...body }),
  deleteMilestone: (ctx, { params }) => milestones.deleteMilestone(ctx, params.id),

  // ---- Personal to-dos
  listTodos: async (ctx) => ({ todos: await todos.listTodos(ctx) }),
  createTodo: (ctx, { body }) => todos.createTodo(ctx, body),
  updateTodo: (ctx, { params, body }) => todos.updateTodo(ctx, { id: params.id, patch: body }),
  deleteTodo: async (ctx, { params }) => {
    await todos.deleteTodo(ctx, params.id);
  },
  reorderTodos: async (ctx, { body }) => ({ todos: await todos.reorderTodos(ctx, body) }),

  // ---- Ideas
  listIdeas: async (ctx) => ({ ideas: await ideas.listIdeas(ctx) }),
  createIdea: (ctx, { body }) => ideas.createIdea(ctx, body),
  updateIdea: (ctx, { params, body }) => ideas.updateIdea(ctx, { id: params.id, patch: body }),
  deleteIdea: async (ctx, { params }) => {
    await ideas.deleteIdea(ctx, params.id);
  },
  createIssueFromIdea: (ctx, { params, body }) => ideas.createIssueFromIdea(ctx, { ideaId: params.id, ...body }),

  // ---- CRM
  listAttractions: async (ctx) => ({ attractions: await crm.listAttractions(ctx) }),
  createAttraction: (ctx, { body }) => crm.createAttraction(ctx, body),
  updateAttraction: (ctx, { params, body }) => crm.updateAttraction(ctx, { id: params.id, patch: body }),
  deleteAttraction: async (ctx, { params }) => {
    await crm.deleteAttraction(ctx, params.id);
  },
  listActivities: async (ctx, { params }) => ({ activities: await crm.listActivities(ctx, params.id) }),
  addActivity: (ctx, { params, body }) => crm.addActivity(ctx, { attractionId: params.id, ...body }),
  updateActivity: (ctx, { params, body }) => crm.updateActivity(ctx, { id: params.id, patch: body }),
  deleteActivity: (ctx, { params }) => crm.deleteActivity(ctx, params.id),

  // ---- Decisions
  listDecisions: async (ctx, { query }) => ({
    decisions: await decisions.listDecisions(ctx, {
      query: query.query ?? "",
      type: query.type ?? null,
      status: query.status ?? null,
      assigneeId: query.assigneeId ?? null,
      sort: query.sort ?? "updated",
    }),
  }),
  createDecision: (ctx, { body }) => decisions.createDecision(ctx, body),
  getDecision: (ctx, { params }) => decisions.getDecision(ctx, params.id),
  updateDecision: (ctx, { params, body }) => decisions.updateDecision(ctx, { id: params.id, patch: body }),
  deleteDecision: (ctx, { params }) => decisions.deleteDecision(ctx, params.id),
  listSupersedeCandidates: async (ctx, { params }) => ({
    decisions: await decisions.listSupersedeCandidates(ctx, params.id),
  }),
  supersedeDecision: (ctx, { params, body }) => decisions.supersedeDecision(ctx, { id: params.id, ...body }),
  createDecisionLink: (ctx, { params, body }) => decisions.createDecisionLink(ctx, { decisionId: params.id, ...body }),
  updateDecisionLink: (ctx, { params, body }) => decisions.updateDecisionLink(ctx, { id: params.id, ...body }),
  deleteDecisionLink: async (ctx, { params }) => {
    await decisions.deleteDecisionLink(ctx, params.id);
  },
  listRelationCandidates: async (ctx, { params, query }) => ({
    candidates: await decisions.listRelationCandidates(ctx, { decisionId: params.id, query: query.query ?? "" }),
  }),
  addDecisionRelation: async (ctx, { params, body }) => ({
    relations: await decisions.addDecisionRelation(ctx, { decisionId: params.id, ...body }),
  }),
  removeDecisionRelation: async (ctx, { params }) => {
    await decisions.removeDecisionRelation(ctx, params.id);
  },

  // ---- Team
  getTeam: (ctx) => team.listTeam(ctx),
  updateMeetingUrl: (ctx, { body }) => updateMeetingUrl(ctx, body),
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
