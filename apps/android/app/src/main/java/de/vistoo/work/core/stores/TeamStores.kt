package de.vistoo.work.core.stores

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import de.vistoo.work.core.api.ApiError
import de.vistoo.work.core.generated.API
import de.vistoo.work.core.generated.ChangeRoleRequest
import de.vistoo.work.core.generated.ErrorCode
import de.vistoo.work.core.generated.InviteRequest
import de.vistoo.work.core.generated.Invitation
import de.vistoo.work.core.generated.Member
import de.vistoo.work.core.generated.MemberRole
import de.vistoo.work.core.generated.NotificationSettings
import de.vistoo.work.core.generated.UpdateNotificationSettingsRequest
import de.vistoo.work.core.generated.UpdateProfileRequest
import de.vistoo.work.core.generated.Viewer

/** Members and invitations. Admin rules (incl. "last admin") are enforced by the server. */
class TeamStore(private val backend: Backend, val viewer: Viewer) {
    var members by mutableStateOf<List<Member>>(emptyList())
        private set
    var invitations by mutableStateOf<List<Invitation>>(emptyList())
        private set
    var state by mutableStateOf<LoadState>(LoadState.Idle)
        private set

    val isAdmin: Boolean get() = viewer.role == MemberRole.Admin

    suspend fun reload() {
        if (state != LoadState.Loaded) state = LoadState.Loading
        try {
            val team = backend.send(API.getTeam())
            members = team.members
            invitations = team.invitations
            state = LoadState.Loaded
        } catch (e: ApiError) {
            if (members.isEmpty()) state = LoadState.Failed(e.message)
        }
    }

    suspend fun invite(email: String, role: MemberRole) {
        backend.send(API.inviteMember(body = InviteRequest(email = email, role = role)))
        reload()
    }

    suspend fun resend(invitation: Invitation) {
        backend.send(API.resendInvitation(id = invitation.id))
        reload()
    }

    suspend fun revoke(invitation: Invitation) {
        try {
            backend.send(API.revokeInvitation(id = invitation.id))
        } catch (e: ApiError) {
            if (e.code != ErrorCode.NotFound) throw e
        }
        reload()
    }

    suspend fun changeRole(member: Member, role: MemberRole) {
        backend.send(API.changeMemberRole(userId = member.userId, body = ChangeRoleRequest(role = role)))
        reload()
    }

    suspend fun remove(member: Member): Long {
        val result = backend.send(API.removeMember(userId = member.userId))
        reload()
        return result.unassignedTasks
    }

    suspend fun updateOwnName(name: String) {
        backend.send(API.updateProfile(body = UpdateProfileRequest(fullName = name)))
        reload()
    }
}

/** Server-side notification preferences of the signed-in member. */
class NotificationSettingsModel(private val backend: Backend) {
    var settings by mutableStateOf<NotificationSettings?>(null)
        private set
    var isSaving by mutableStateOf(false)
        private set

    suspend fun load() {
        runCatching { backend.send(API.getNotificationSettings()) }.getOrNull()?.let { settings = it }
    }

    /** Optimistic toggle; reverts if the server refuses. */
    suspend fun update(patch: UpdateNotificationSettingsRequest) {
        val previous = settings
        settings = previous?.let { s ->
            s.copy(
                directMessages = patch.directMessages ?: s.directMessages,
                channelMessages = patch.channelMessages ?: s.channelMessages,
                taskAssignments = patch.taskAssignments ?: s.taskAssignments,
            )
        }
        isSaving = true
        try {
            settings = backend.send(API.updateNotificationSettings(body = patch))
        } catch (e: Exception) {
            settings = previous
            throw e
        } finally {
            isSaving = false
        }
    }
}
