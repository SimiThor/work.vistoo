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
extension Todo: Identifiable {}
extension Idea: Identifiable {}
extension Attraction: Identifiable {}
extension Activity: Identifiable {}
extension Milestone: Identifiable {}
extension DecisionSummary: Identifiable {}
extension DecisionRef: Identifiable {}
extension DecisionLink: Identifiable {}
extension DecisionRelation: Identifiable {}
extension DecisionHistory: Identifiable {}
