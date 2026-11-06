import Foundation

/// HTTP method of an API operation (generated descriptors use these cases).
public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

/// Authentication level declared by the contract.
public enum AuthLevel: Sendable {
    case anonymous, session, member, admin
}

/// How an operation may be retried after a network failure (from the contract).
public enum RetryPolicy: Sendable {
    /// Repeating has the same effect (reads, PUT-style setters, idempotent sends).
    case safe
    /// Safe to repeat because the request carries a client-generated id.
    case idempotentWithClientId
    /// May have been applied already: re-read state / inspect a CONFLICT before repeating.
    case checkConflict
    /// Deletes: NOT_FOUND on a repeat means the first attempt succeeded.
    case notFoundMeansDone

    /// Whether the client may transparently repeat the request after a transport error.
    var allowsAutomaticRetry: Bool {
        switch self {
        case .safe, .idempotentWithClientId: true
        case .checkConflict, .notFoundMeansDone: false
        }
    }
}

/// Marker for 204 responses.
public struct NoContent: Decodable, Sendable, Hashable {
    public init() {}
}

/// A typed request description created by the generated `API` factory.
public struct Endpoint<Response: Decodable & Sendable>: Sendable {
    public let method: HTTPMethod
    public let path: String
    public let query: [URLQueryItem]
    public let body: (any Encodable & Sendable)?
    public let auth: AuthLevel
    public let retry: RetryPolicy

    public init(
        method: HTTPMethod,
        path: String,
        query: [URLQueryItem],
        body: (any Encodable & Sendable)?,
        auth: AuthLevel,
        retry: RetryPolicy
    ) {
        self.method = method
        self.path = path
        self.query = query
        self.body = body
        self.auth = auth
        self.retry = retry
    }
}

extension String {
    /// Percent-encodes a path segment (ids are UUIDs, this is defensive).
    var pathEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? self
    }
}

extension URLQueryItem {
    static func optional(_ name: String, _ value: (some CustomStringConvertible)?) -> URLQueryItem? {
        value.map { URLQueryItem(name: name, value: $0.description) }
    }
}

/// Tri-state field of partial updates: leave unchanged, clear (JSON null) or set.
public enum Patchable<Value: Encodable & Sendable>: Sendable {
    case unset
    case null
    case value(Value)

    /// `nil` clears the field.
    public init(_ optional: Value?) {
        self = optional.map { .value($0) } ?? .null
    }

    public func encode<Key: CodingKey>(into container: inout KeyedEncodingContainer<Key>, forKey key: Key) throws {
        switch self {
        case .unset: break
        case .null: try container.encodeNil(forKey: key)
        case .value(let value): try container.encode(value, forKey: key)
        }
    }
}

extension Patchable: Equatable where Value: Equatable {}

/// Any JSON value (only used where the contract allows arbitrary content).
public enum JSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(from decoder: any Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }
}
