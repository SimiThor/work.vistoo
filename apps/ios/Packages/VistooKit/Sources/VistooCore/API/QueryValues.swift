import Foundation

// Open enums used as query parameters are sent as their raw value.

extension DecisionType: CustomStringConvertible {
    public var description: String { rawValue }
}

extension DecisionStatus: CustomStringConvertible {
    public var description: String { rawValue }
}

extension DecisionSort: CustomStringConvertible {
    public var description: String { rawValue }
}
