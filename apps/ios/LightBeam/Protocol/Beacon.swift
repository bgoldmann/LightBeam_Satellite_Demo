import Foundation

struct BeaconInfo: Codable, Equatable {
    let title: String?
    let profile: String?
    let blockCount: Int
    let blockSize: Int
    let originalLen: Int
    let payloadHash: String
    let shortCode: String?

    enum CodingKeys: String, CodingKey {
        case title
        case profile
        case blockCount = "block_count"
        case blockSize = "block_size"
        case originalLen = "original_len"
        case payloadHash = "payload_hash"
        case shortCode = "short_code"
    }

    static func decode(from data: Data) -> BeaconInfo? {
        try? JSONDecoder().decode(BeaconInfo.self, from: data)
    }
}
