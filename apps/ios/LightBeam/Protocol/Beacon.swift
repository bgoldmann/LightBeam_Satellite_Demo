import Foundation

struct BeaconInfo: Codable, Equatable {
    let title: String?
    let profile: String?
    let blockCount: Int
    let blockSize: Int
    let originalLen: Int
    /// Post-compression fountain payload length. Prefer this over originalLen for LT.
    let encodedLen: Int?
    let payloadHash: String
    let shortCode: String?

    enum CodingKeys: String, CodingKey {
        case title
        case profile
        case blockCount = "block_count"
        case blockSize = "block_size"
        case originalLen = "original_len"
        case encodedLen = "encoded_len"
        case payloadHash = "payload_hash"
        case shortCode = "short_code"
    }

    /// Length the LT decoder should truncate the fountain payload to.
    var fountainPayloadLen: Int {
        if let encodedLen, encodedLen > 0 { return encodedLen }
        // Legacy beacons lacked encoded_len — wait for manifest instead of guessing.
        return 0
    }

    static func decode(from data: Data) -> BeaconInfo? {
        try? JSONDecoder().decode(BeaconInfo.self, from: data)
    }
}
