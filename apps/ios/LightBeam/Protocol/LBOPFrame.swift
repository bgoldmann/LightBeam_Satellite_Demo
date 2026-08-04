import Foundation

/// LBOP/1 frame envelope — mirrors web-encoder and crates/lightbeam-protocol.
enum LBOPFrameType: UInt8 {
    case beacon = 0x01
    case manifest = 0x02
    case data = 0x03
    case endLoop = 0x04
}

struct LBOPFrame {
    static let magic = Data("LBOP".utf8)
    static let protocolVersion: UInt8 = 1
    static let headerLength = 38

    let version: UInt8
    let frameType: LBOPFrameType
    let flags: UInt16
    let sessionId: Data
    let symbolId: UInt64
    let payload: Data

    static func decode(_ data: Data) throws -> LBOPFrame {
        guard data.count >= headerLength + 4 else {
            throw LBOPError.truncated
        }
        guard data.prefix(4) == magic else {
            throw LBOPError.invalidMagic
        }

        let version = data[4]
        guard version == protocolVersion else {
            throw LBOPError.unsupportedVersion
        }

        guard let frameType = LBOPFrameType(rawValue: data[5]) else {
            throw LBOPError.invalidFrameType
        }

        let flags = u16be(data, 6)
        let sessionId = data.subdata(in: 8..<24)
        let symbolId = u64be(data, 24)
        let plen = Int(u16be(data, 32))

        let expectedHeaderCRC = u32be(data, 34)
        let actualHeaderCRC = CRC32.compute(data.prefix(34))
        guard actualHeaderCRC == expectedHeaderCRC else {
            throw LBOPError.headerCRCMismatch
        }

        guard data.count >= 38 + plen + 4 else {
            throw LBOPError.truncated
        }

        let payload = data.subdata(in: 38..<(38 + plen))
        let body = data.prefix(38 + plen)
        let expectedFrameCRC = u32be(data, 38 + plen)
        let actualFrameCRC = CRC32.compute(body)
        guard actualFrameCRC == expectedFrameCRC else {
            throw LBOPError.frameCRCMismatch
        }

        return LBOPFrame(
            version: version,
            frameType: frameType,
            flags: flags,
            sessionId: sessionId,
            symbolId: symbolId,
            payload: payload
        )
    }

    static func decodeFromQRString(_ string: String) -> LBOPFrame? {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = Data(base64Encoded: trimmed) else { return nil }
        return try? decode(data)
    }

    static func sessionShortCode(sessionId: Data) -> String {
        let alpha = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        var n: UInt64 = 0
        for i in 0..<8 {
            n = (n << 8) | UInt64(sessionId[i])
        }
        var out = ""
        var value = n
        for _ in 0..<8 {
            out.append(alpha[Int(value % 32)])
            value /= 32
        }
        return String(out)
    }

    private static func u16be(_ data: Data, _ offset: Int) -> UInt16 {
        (UInt16(data[offset]) << 8) | UInt16(data[offset + 1])
    }

    private static func u32be(_ data: Data, _ offset: Int) -> UInt32 {
        (UInt32(data[offset]) << 24)
            | (UInt32(data[offset + 1]) << 16)
            | (UInt32(data[offset + 2]) << 8)
            | UInt32(data[offset + 3])
    }

    private static func u64be(_ data: Data, _ offset: Int) -> UInt64 {
        var value: UInt64 = 0
        for i in 0..<8 {
            value = value * 256 + UInt64(data[offset + i])
        }
        return value
    }
}

enum LBOPError: LocalizedError {
    case truncated
    case invalidMagic
    case unsupportedVersion
    case invalidFrameType
    case headerCRCMismatch
    case frameCRCMismatch

    var errorDescription: String? {
        switch self {
        case .truncated: return "Truncated LBOP frame"
        case .invalidMagic: return "Invalid LBOP magic"
        case .unsupportedVersion: return "Unsupported LBOP version"
        case .invalidFrameType: return "Invalid frame type"
        case .headerCRCMismatch: return "Header CRC mismatch"
        case .frameCRCMismatch: return "Frame CRC mismatch"
        }
    }
}
