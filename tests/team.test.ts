import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { resolveMembership } from "@/server/auth";
import { getDb } from "@/server/db";
import { workspaceInvitations } from "@/server/db/schema";
import { acceptInvitation, getInvitationState } from "@/server/services/invitations";
import { createTask, listTasks } from "@/server/services/tasks";
import {
  changeMemberRole,
  inviteMember,
  listTeam,
  removeMember,
  resendInvitation,
  revokeInvitation,
} from "@/server/services/team";
import { addMember, ctxFor, makeMemberCtx, makeProject, makeUser, makeWorkspace } from "./support/fixtures";

const noSend = { send: vi.fn(async () => {}) };

describe("admin-only actions", () => {
  it("members cannot invite, change roles or remove", async () => {
    const ws = await makeWorkspace();
    const { ctx: member } = await makeMemberCtx(ws.id, "member");
    const { user: other } = await makeMemberCtx(ws.id, "member");
    await expect(inviteMember(member, { email: "neu@example.com", role: "member" }, noSend)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(changeMemberRole(member, { userId: other.id, role: "admin" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(removeMember(member, other.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revokeInvitation(member, crypto.randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("last admin protection", () => {
  it("the last active admin can neither be demoted nor removed", async () => {
    const ws = await makeWorkspace();
    const { ctx: admin, user } = await makeMemberCtx(ws.id, "admin");
    await expect(changeMemberRole(admin, { userId: user.id, role: "member" })).rejects.toMatchObject({
      code: "LAST_ADMIN",
    });
    await expect(removeMember(admin, user.id)).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });

  it("with two admins one may be demoted, then the other is protected", async () => {
    const ws = await makeWorkspace();
    const { ctx: a1, user: u1 } = await makeMemberCtx(ws.id, "admin");
    const { ctx: a2, user: u2 } = await makeMemberCtx(ws.id, "admin");
    await changeMemberRole(a1, { userId: u2.id, role: "member" });
    await expect(changeMemberRole(a1, { userId: u1.id, role: "member" })).rejects.toMatchObject({ code: "LAST_ADMIN" });
    // a2's role changed: a fresh context must reflect that (no stale cache)
    expect((await ctxFor(u2)).role).toBe("member");
    void a2;
  });

  it("concurrent mutual demotion leaves at least one admin", async () => {
    const ws = await makeWorkspace();
    const { ctx: a1, user: u1 } = await makeMemberCtx(ws.id, "admin");
    const { ctx: a2, user: u2 } = await makeMemberCtx(ws.id, "admin");
    await Promise.allSettled([
      changeMemberRole(a1, { userId: u2.id, role: "member" }),
      changeMemberRole(a2, { userId: u1.id, role: "member" }),
    ]);
    const team = await listTeam(a1);
    expect(team.members.filter((m) => m.role === "admin").length).toBeGreaterThanOrEqual(1);
  });
});

describe("removing members", () => {
  it("revokes access, keeps tasks, unassigns and keeps creator history", async () => {
    const ws = await makeWorkspace();
    const { ctx: admin } = await makeMemberCtx(ws.id, "admin");
    const { ctx: member, user } = await makeMemberCtx(ws.id, "member");
    const project = await makeProject(ws.id);
    const t = await createTask(member, {
      projectId: project.id,
      title: "Von Mitglied erstellt",
      description: "",
      status: "open",
      groupId: null,
      assigneeId: user.id,
      startDate: null,
      endDate: null,
    });

    const result = await removeMember(admin, user.id);
    expect(result.unassignedTasks).toBe(1);
    expect(await resolveMembership(user)).toBeNull();

    const after = (await listTasks(admin)).find((x) => x.id === t.id)!;
    expect(after.assigneeId).toBeNull();
    expect(after.createdBy).toBe(user.id);
    expect(after.version).toBe(t.version + 1);
  });
});

describe("invitations", () => {
  async function setup() {
    const ws = await makeWorkspace();
    const { ctx: admin } = await makeMemberCtx(ws.id, "admin");
    return { ws, admin };
  }

  it("are bound to the invited e-mail address", async () => {
    const { admin } = await setup();
    const inv = await inviteMember(admin, { email: "lena@example.com", role: "member" }, noSend);
    const intruder = await makeUser({ email: "mallory@example.com" });
    expect((await getInvitationState(intruder)).kind).toBe("none");
    await expect(acceptInvitation(intruder, { invitationId: inv.id, fullName: "M" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await resolveMembership(intruder)).toBeNull();
  });

  it("can be accepted by the invited user, exactly once", async () => {
    const { ws, admin } = await setup();
    const inv = await inviteMember(admin, { email: "Lena@Example.com", role: "admin" }, noSend);
    expect(inv.email).toBe("lena@example.com");
    const lena = { id: crypto.randomUUID(), email: "lena@example.com" };
    const state = await getInvitationState(lena);
    expect(state.kind).toBe("invited");
    await acceptInvitation(lena, { invitationId: inv.id, fullName: "Lena Weber" });
    const ctx = await resolveMembership(lena);
    expect(ctx).toMatchObject({ workspaceId: ws.id, role: "admin" });
    await expect(acceptInvitation(lena, { invitationId: inv.id, fullName: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("expired or revoked invitations grant no access", async () => {
    const { admin } = await setup();
    const expired = await inviteMember(admin, { email: "alt@example.com", role: "member" }, noSend);
    await getDb()
      .update(workspaceInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(workspaceInvitations.id, expired.id));
    const alt = { id: crypto.randomUUID(), email: "alt@example.com" };
    expect((await getInvitationState(alt)).kind).toBe("expired");
    await expect(acceptInvitation(alt, { invitationId: expired.id, fullName: "A" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // Resend renews the expiry.
    await resendInvitation(admin, expired.id, noSend);
    expect((await getInvitationState(alt)).kind).toBe("invited");

    const revoked = await inviteMember(admin, { email: "weg@example.com", role: "member" }, noSend);
    await revokeInvitation(admin, revoked.id);
    const weg = { id: crypto.randomUUID(), email: "weg@example.com" };
    expect((await getInvitationState(weg)).kind).toBe("none");
    await expect(acceptInvitation(weg, { invitationId: revoked.id, fullName: "W" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rolls back when the e-mail cannot be sent", async () => {
    const { admin } = await setup();
    const failing = { send: vi.fn(async () => Promise.reject(new Error("smtp down"))) };
    await expect(inviteMember(admin, { email: "x@example.com", role: "member" }, failing)).rejects.toMatchObject({
      code: "INTERNAL",
    });
    expect((await listTeam(admin)).invitations).toHaveLength(0);
  });

  it("rejects duplicates and existing members", async () => {
    const { ws, admin } = await setup();
    await inviteMember(admin, { email: "dup@example.com", role: "member" }, noSend);
    await expect(inviteMember(admin, { email: "dup@example.com", role: "member" }, noSend)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const existing = await makeUser({ email: "da@example.com" });
    await addMember(ws.id, existing);
    await expect(inviteMember(admin, { email: "da@example.com", role: "member" }, noSend)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("a removed member can be re-invited and regains access", async () => {
    const { ws, admin } = await setup();
    const { user } = await makeMemberCtx(ws.id, "member");
    await removeMember(admin, user.id);
    const inv = await inviteMember(admin, { email: user.email, role: "member" }, noSend);
    await acceptInvitation(user, { invitationId: inv.id, fullName: "Wieder da" });
    expect(await resolveMembership(user)).not.toBeNull();
  });
});
