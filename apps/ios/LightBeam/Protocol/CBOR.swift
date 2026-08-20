import Foundation

/// Minimal CBOR map decoder for LightBeam manifest fields (string keys only).
enum CBOR {
    struct ParseError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func decodeMap(_ data: Data) throws -> [String: CBORValue] {
        var reader = Reader(data: data)
        let value = try reader.readValue()
        guard case .map(let dict) = value else {
            throw ParseError(message: "Expected CBOR map")
        }
        return dict
    }

    enum CBORValue {
        case text(String)
        case bytes(Data)
        case int(Int)
        case null
        case map([String: CBORValue])
        case array([CBORValue])
        case bool(Bool)
        case unknown
    }

    private struct Reader {
        let data: Data
        var offset = 0

        mutating func readByte() throws -> UInt8 {
            guard offset < data.count else { throw ParseError(message: "Unexpected end of CBOR") }
            defer { offset += 1 }
            return data[offset]
        }

        mutating func readValue() throws -> CBORValue {
            let initial = try readByte()
            let major = initial >> 5
            let info = initial & 0x1F

            switch major {
            case 0:
                return .int(try readUInt(info))
            case 1:
                let n = try readUInt(info)
                return .int(-1 - n)
            case 2:
                let len = try readUInt(info)
                return .bytes(try readBytes(len))
            case 3:
                let len = try readUInt(info)
                let bytes = try readBytes(len)
                return .text(String(data: bytes, encoding: .utf8) ?? "")
            case 4:
                let count = try readUInt(info)
                var items: [CBORValue] = []
                items.reserveCapacity(count)
                for _ in 0..<count {
                    items.append(try readValue())
                }
                return .array(items)
            case 5:
                let count = try readUInt(info)
                var dict: [String: CBORValue] = [:]
                for _ in 0..<count {
                    let keyValue = try readValue()
                    let val = try readValue()
                    if case .text(let key) = keyValue {
                        dict[key] = val
                    }
                }
                return .map(dict)
            case 6:
                _ = try readValue()
                return try readValue()
            case 7:
                switch info {
                case 20: return .bool(false)
                case 21: return .bool(true)
                case 22: return .null
                default: return .unknown
                }
            default:
                return .unknown
            }
        }

        mutating func readUInt(_ info: UInt8) throws -> Int {
            if info < 24 { return Int(info) }
            switch info {
            case 24: return Int(try readByte())
            case 25:
                let b0 = Int(try readByte())
                let b1 = Int(try readByte())
                return (b0 << 8) | b1
            case 26:
                var value = 0
                for _ in 0..<4 {
                    value = (value << 8) | Int(try readByte())
                }
                return value
            case 27:
                var value = 0
                for _ in 0..<8 {
                    value = (value << 8) | Int(try readByte())
                }
                return value
            default:
                throw ParseError(message: "Unsupported CBOR integer encoding")
            }
        }

        mutating func readBytes(_ length: Int) throws -> Data {
            guard offset + length <= data.count else {
                throw ParseError(message: "CBOR byte string truncated")
            }
            let slice = data.subdata(in: offset..<(offset + length))
            offset += length
            return slice
        }
    }

    static func string(_ map: [String: CBORValue], _ key: String) -> String? {
        guard case .text(let value)? = map[key] else { return nil }
        return value
    }

    static func int(_ map: [String: CBORValue], _ key: String) -> Int? {
        guard case .int(let value)? = map[key] else { return nil }
        return value
    }

    /// Convert decoded CBOR map to JSON-compatible objects for canonical re-encode.
    static func jsonObject(_ map: [String: CBORValue]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (k, v) in map {
            out[k] = jsonValue(v)
        }
        return out
    }

    private static func jsonValue(_ value: CBORValue) -> Any {
        switch value {
        case .text(let s): return s
        case .int(let i): return i
        case .bool(let b): return b
        case .null: return NSNull()
        case .bytes(let d): return d.base64EncodedString()
        case .array(let items): return items.map { jsonValue($0) }
        case .map(let m): return jsonObject(m)
        case .unknown: return NSNull()
        }
    }
}
