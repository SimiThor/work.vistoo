import Foundation
import Observation

/// Members and invitations. Admin rules (incl. "last admin") are enforced by the server.
@MainActor
@Observable
public final class TeamStore {
    public private(set) var members: [Member] = []
    public private(set) var invitations: [Invitation] = []
    public private(set) var state: LoadState = .idle

    private let backend: Backend
    public let viewer: Viewer

    public init(backend: Backend, viewer: Viewer) {
        self.backend = backend
        self.viewer = viewer
    }

    public var isAdmin: Bool { viewer.role == .admin }

    public func reload() async {
        if state != .loaded { state = .loading }
        do {
            let team = try await backend.send(API.getTeam())
            members = team.members
            invitations = team.invitations
            state = .loaded
        } catch {
            if members.isEmpty { state = .failed(error.message) }
        }
    }

    public func invite(email: String, role: MemberRole) async throws(APIError) {
        _ = try await backend.send(API.inviteMember(body: InviteRequest(email: email, role: role)))
        await reload()
    }

    public func resend(_ invitation: Invitation) async throws(APIError) {
        _ = try await backend.send(API.resendInvitation(id: invitation.id))
        await reload()
    }

    public func revoke(_ invitation: Invitation) async throws(APIError) {
        do {
            _ = try await backend.send(API.revokeInvitation(id: invitation.id))
        } catch where error.code == .notFound {}
        await reload()
    }

    public func changeRole(_ member: Member, to role: MemberRole) async throws(APIError) {
        _ = try await backend.send(API.changeMemberRole(userId: member.userId, body: ChangeRoleRequest(role: role)))
        await reload()
    }

    @discardableResult
    public func remove(_ member: Member) async throws(APIError) -> Int {
        let result = try await backend.send(API.removeMember(userId: member.userId))
        await reload()
        return result.unassignedTasks
    }

    public func updateOwnName(_ name: String) async throws(APIError) {
        _ = try await backend.send(API.updateProfile(body: UpdateProfileRequest(fullName: name)))
        await reload()
    }
}
