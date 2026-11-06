import Foundation

// Generated models carry their identity in `id` (or `userId`); SwiftUI lists need Identifiable.
extension TaskItem: Identifiable {}
extension Project: Identifiable {}
extension ProjectGroup: Identifiable {}
extension Invitation: Identifiable {}
extension Message: Identifiable {}
extension Attachment: Identifiable {}
extension ConversationSummary: Identifiable {}
extension Member: Identifiable {
    public var id: String { userId }
}
extension ChatPerson: Identifiable {
    public var id: String { userId }
}
