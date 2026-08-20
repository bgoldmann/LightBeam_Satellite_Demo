import CryptoKit
import Foundation

enum TrustState: String, Codable, Equatable {
    case verified
    case unknownPublisher
    case verificationFailed
    case hashOnly
}

/// Phase 1 demo publisher allowlist (matches web encoder DEMO seed).
enum PublisherTrust {
    /// key_id (16 hex) → raw 32-byte Ed25519 public key
    static let allowlist: [String: Data] = [
        "cf64d74ed0175771": Data(hexString: "2cad00fc5952f978eee1a9f55ba7e43c1d7ec11baa8f918feac025c0c728568f")!,
    ]

    static func evaluate(
        publisherKeyId: String?,
        signatureBase64: String?,
        unsignedManifest: [String: Any]
    ) -> TrustState {
        guard let publisherKeyId, !publisherKeyId.isEmpty else { return .unknownPublisher }
        guard let sigB64 = signatureBase64, !sigB64.isEmpty,
              let sig = Data(base64Encoded: sigB64)
        else { return .verificationFailed }

        guard let pub = allowlist[publisherKeyId.lowercased()] else {
            return .unknownPublisher
        }

        var unsigned = unsignedManifest
        unsigned["signature"] = NSNull()
        let canonical = CanonicalCbor.encode(unsigned)
        do {
            let key = try Curve25519.Signing.PublicKey(rawRepresentation: pub)
            if key.isValidSignature(sig, for: canonical) {
                return .verified
            }
            return .verificationFailed
        } catch {
            return .verificationFailed
        }
    }
}

private extension Data {
    init?(hexString: String) {
        let hex = hexString.lowercased()
        guard hex.count.isMultiple(of: 2) else { return nil }
        var data = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        self = data
    }
}
