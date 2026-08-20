import XCTest
@testable import LightBeam

final class ProtocolTests: XCTestCase {
    func testCRC32Golden() {
        let data = Data("123456789".utf8)
        XCTAssertEqual(CRC32.compute(data), 0xCBF4_3926)
    }

    func testGoldenVectorBeaconAndManifest() throws {
        let framesB64 = try loadGoldenFrames()
        let decoder = SessionDecoder()

        for b64 in framesB64.prefix(20) {
            guard let frame = LBOPFrame.decodeFromQRString(b64) else {
                XCTFail("Failed to decode frame")
                return
            }
            decoder.ingest(frame: frame)
        }

        XCTAssertNotEqual(decoder.stage, .searching)
        XCTAssertGreaterThan(decoder.blockCount, 0)
    }

    func testGoldenVectorFullDecode() throws {
        let framesB64 = try loadGoldenFrames()
        let decoder = SessionDecoder()

        for b64 in framesB64 {
            if let frame = LBOPFrame.decodeFromQRString(b64) {
                decoder.ingest(frame: frame)
            }
        }

        let result = decoder.tryFinalize()
        XCTAssertNotNil(result)
        XCTAssertEqual(decoder.stage, .complete)
        XCTAssertEqual(result?.filename, "golden.txt")
        let text = String(data: result!.fileData, encoding: .utf8) ?? ""
        XCTAssertTrue(text.contains("LightBeam LBOP/1 golden vector"))
    }

    func testDataPayloadRoundtrip() throws {
        let neighbors = [0, 1]
        let symbol = Data(repeating: 0xAB, count: 32)
        var payload = Data()
        payload.append(contentsOf: [0, 2, 0, 2])
        payload.append(contentsOf: [0, 0, 0, 1])
        payload.append(symbol)

        let decoded = try DataPayload.decode(payload)
        XCTAssertEqual(decoded.degree, 2)
        XCTAssertEqual(decoded.neighbors, neighbors)
        XCTAssertEqual(decoded.symbolBytes, symbol)
    }

    func testZlibDeflateDecompression() throws {
        // pako.deflate("LightBeam deflate test") — matches web-encoder compression
        let compressed = Data(base64Encoded: "eJzzyUzPKHFKTcxVSElNy0ksSVUoSS0uAQBdeAhD")!
        let decompressed = try PayloadProcessor.decompressIfNeeded(compressed, compression: "deflate")
        XCTAssertEqual(String(data: decompressed, encoding: .utf8), "LightBeam deflate test")
    }

    func testMediaTypesPreserveVideoExtension() {
        XCTAssertEqual(MediaTypes.resolveMime(filename: "clip.mp4", mimeHint: ""), "video/mp4")
        XCTAssertEqual(MediaTypes.resolveMime(filename: "clip.mp4", mimeHint: "application/octet-stream"), "video/mp4")
        XCTAssertEqual(MediaTypes.ensureFilenameExtension(filename: "clip", mime: "video/mp4"), "clip.mp4")
        XCTAssertEqual(MediaTypes.ensureFilenameExtension(filename: "movie.MP4", mime: "application/octet-stream"), "movie.MP4")
        XCTAssertTrue(MediaTypes.isVideo(mime: "video/mp4", filename: "x.bin"))
    }

    func testZstdDecompressionRoundtrip() throws {
        // Standard zstd frame from `zstd` crate (matches web ACE / Android zstd-jni).
        let compressed = Data(base64Encoded: "KLUv/SAgAQEATGlnaHRCZWFtIHpzdGQgQUNFIHRlc3QgcGF5bG9hZCA=")!
        let decompressed = try PayloadProcessor.decompressIfNeeded(compressed, compression: "zstd")
        XCTAssertEqual(String(data: decompressed, encoding: .utf8), "LightBeam zstd ACE test payload ")
    }

    func testPublisherTrustDemoAllowlist() {
        let unsigned: [String: Any] = [
            "protocol_version": 1,
            "title": "t",
            "signature": NSNull(),
        ]
        XCTAssertEqual(
            PublisherTrust.evaluate(publisherKeyId: nil, signatureBase64: nil, unsignedManifest: unsigned),
            .unknownPublisher
        )
        XCTAssertEqual(
            PublisherTrust.evaluate(
                publisherKeyId: "cf64d74ed0175771",
                signatureBase64: "AAAA",
                unsignedManifest: unsigned
            ),
            .verificationFailed
        )
        XCTAssertEqual(
            PublisherTrust.evaluate(
                publisherKeyId: "deadbeefdeadbeef",
                signatureBase64: "AAAA",
                unsignedManifest: unsigned
            ),
            .unknownPublisher
        )
    }

    func testCanonicalCborNullAndSortedKeys() {
        let a = CanonicalCbor.encode(["b": 1, "a": NSNull()] as [String: Any])
        let b = CanonicalCbor.encode(["a": NSNull(), "b": 1] as [String: Any])
        XCTAssertEqual(a, b)
        // map(2) + "a" + null + "b" + 1
        XCTAssertEqual(a.first, 0xA2)
    }

    private func loadGoldenFrames() throws -> [String] {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let vectorURL = repoRoot.appendingPathComponent("spec/test-vectors/v0.1-golden.json")
        let data = try Data(contentsOf: vectorURL)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let frames = json?["frames_b64"] as? [String] else {
            throw NSError(domain: "Test", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing frames_b64"])
        }
        return frames
    }
}
