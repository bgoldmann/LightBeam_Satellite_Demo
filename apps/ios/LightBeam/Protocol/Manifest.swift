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
    let publisherKeyId: String?
    let signatureBase64: String?
    /// JSON-compatible map for canonical CBOR signing verify (signature stripped by caller).
    let unsignedFields: [String: Any]

    static func == (lhs: ManifestInfo, rhs: ManifestInfo) -> Bool {
        lhs.blockCount == rhs.blockCount &&
            lhs.blockSize == rhs.blockSize &&
            lhs.encodedByteLength == rhs.encodedByteLength &&
            lhs.originalByteLength == rhs.originalByteLength &&
            lhs.payloadHash == rhs.payloadHash &&
            lhs.filename == rhs.filename &&
            lhs.title == rhs.title &&
            lhs.publisherName == rhs.publisherName &&
            lhs.mimeType == rhs.mimeType &&
            lhs.compression == rhs.compression &&
            lhs.publisherKeyId == rhs.publisherKeyId &&
            lhs.signatureBase64 == rhs.signatureBase64
    }

    static func decode(from data: Data) -> ManifestInfo? {
        guard let map = try? CBOR.decodeMap(data) else { return nil }

        guard
            let blockCount = CBOR.int(map, "block_count"),
            let blockSize = CBOR.int(map, "block_size"),
            let encodedByteLength = CBOR.int(map, "encoded_byte_length"),
            let originalByteLength = CBOR.int(map, "original_byte_length"),
            let payloadHash = CBOR.string(map, "payload_hash")
        else { return nil }

        let mimeRaw = CBOR.string(map, "mime_type") ?? ""
        var fields = CBOR.jsonObject(map)
        fields["signature"] = NSNull()

        return ManifestInfo(
            blockCount: blockCount,
            blockSize: blockSize,
            encodedByteLength: encodedByteLength,
            originalByteLength: originalByteLength,
            payloadHash: payloadHash,
            filename: CBOR.string(map, "filename") ?? "file.bin",
            title: CBOR.string(map, "title") ?? "Untitled",
            publisherName: CBOR.string(map, "publisher_name") ?? "",
            mimeType: mimeRaw.isEmpty ? "application/octet-stream" : mimeRaw,
            compression: CBOR.string(map, "compression") ?? "none",
            publisherKeyId: CBOR.string(map, "publisher_key_id"),
            signatureBase64: CBOR.string(map, "signature"),
            unsignedFields: fields
        )
    }
}
