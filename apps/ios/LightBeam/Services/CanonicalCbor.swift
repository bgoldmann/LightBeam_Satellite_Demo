import Foundation

/// Deterministic CBOR encoder (sorted string keys) matching web `canonicalCbor.ts`.
enum CanonicalCbor {
    static func encode(_ value: Any?) -> Data {
        var out = Data()
        write(&out, value)
        return out
    }

    private static func write(_ out: inout Data, _ value: Any?) {
        guard let value else {
            out.append(0xF6)
            return
        }
        switch value {
        case let b as Bool:
            out.append(b ? 0xF5 : 0xF4)
        case let n as Int:
            writeInt(&out, n)
        case let n as Int64:
            writeInt(&out, Int(clamping: n))
        case let n as UInt64:
            writeTypeLen(&out, major: 0, len: Int(clamping: n))
        case let n as NSNumber:
            // Avoid treating Bool as NSNumber (Bool bridges to NSNumber).
            if CFGetTypeID(n) == CFBooleanGetTypeID() {
                out.append(n.boolValue ? 0xF5 : 0xF4)
            } else {
                writeInt(&out, n.intValue)
            }
        case let s as String:
            let bytes = Array(s.utf8)
            writeTypeLen(&out, major: 3, len: bytes.count)
            out.append(contentsOf: bytes)
        case let arr as [Any]:
            writeTypeLen(&out, major: 4, len: arr.count)
            for item in arr { write(&out, item) }
        case let dict as [String: Any]:
            let keys = dict.keys.sorted()
            writeTypeLen(&out, major: 5, len: keys.count)
            for k in keys {
                write(&out, k)
                write(&out, dict[k] ?? NSNull())
            }
        case is NSNull:
            out.append(0xF6)
        default:
            out.append(0xF6)
        }
    }

    private static func writeInt(_ out: inout Data, _ n: Int) {
        if n >= 0 {
            writeTypeLen(&out, major: 0, len: n)
        } else {
            writeTypeLen(&out, major: 1, len: -1 - n)
        }
    }

    private static func writeTypeLen(_ out: inout Data, major: Int, len: Int) {
        let mt = UInt8(major << 5)
        if len < 24 {
            out.append(mt | UInt8(len))
        } else if len < 0x100 {
            out.append(mt | 24)
            out.append(UInt8(len))
        } else if len < 0x10000 {
            out.append(mt | 25)
            out.append(UInt8((len >> 8) & 0xFF))
            out.append(UInt8(len & 0xFF))
        } else {
            let u = UInt32(len)
            out.append(mt | 26)
            out.append(UInt8((u >> 24) & 0xFF))
            out.append(UInt8((u >> 16) & 0xFF))
            out.append(UInt8((u >> 8) & 0xFF))
            out.append(UInt8(u & 0xFF))
        }
    }
}
