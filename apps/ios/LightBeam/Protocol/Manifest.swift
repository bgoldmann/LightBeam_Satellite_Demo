import Foundation

struct ManifestInfo: Equatable {
    let blockCount: Int
    let blockSize: Int
    let encodedByteLength: Int
    let originalByteLength: Int
    let payloadHash: String
    let filename: String
    let title: String
    let publisherName: String
    let mimeType: String
    let compression: String

    static func decode(from data: Data) -> ManifestInfo? {
        guard let map = try? CBOR.decodeMap(data) else { return nil }

        guard
            let blockCount = CBOR.int(map, "block_count"),
            let blockSize = CBOR.int(map, "block_size"),
            let encodedByteLength = CBOR.int(map, "encoded_byte_length"),
            let originalByteLength = CBOR.int(map, "original_byte_length"),
            let payloadHash = CBOR.string(map, "payload_hash")
        else { return nil }

        return ManifestInfo(
            blockCount: blockCount,
            blockSize: blockSize,
            encodedByteLength: encodedByteLength,
            originalByteLength: originalByteLength,
            payloadHash: payloadHash,
            filename: CBOR.string(map, "filename") ?? "file.bin",
            title: CBOR.string(map, "title") ?? "Untitled",
            publisherName: CBOR.string(map, "publisher_name") ?? "",
            mimeType: {
                let raw = CBOR.string(map, "mime_type") ?? ""
                return raw.isEmpty ? "application/octet-stream" : raw
            }(),
            compression: CBOR.string(map, "compression") ?? "none"
        )
    }
}
