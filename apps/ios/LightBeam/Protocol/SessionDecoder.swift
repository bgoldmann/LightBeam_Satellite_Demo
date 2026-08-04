import Foundation

enum ScanStage: String, CaseIterable, Identifiable {
    case searching
    case sessionFound
    case readingManifest
    case collectingData
    case reconstructing
    case verifying
    case complete
    case failed

    var id: String { rawValue }

    var localizedTitle: String {
        NSLocalizedString("stage.\(rawValue)", comment: "")
    }
}

struct RecoveredFileRecord: Identifiable, Codable, Equatable {
    let id: UUID
    let filename: String
    let title: String
    let publisherName: String
    let mimeType: String
    let payloadHash: String
    let byteCount: Int
    let recoveredAt: Date
    let relativePath: String

    var fileURL: URL {
        FileStore.documentsDirectory.appendingPathComponent(relativePath)
    }
}

struct SessionDecodeResult: Equatable {
    let filename: String
    let title: String
    let publisherName: String
    let mimeType: String
    let payloadHash: String
    let fileData: Data
    let shortCode: String?
}

/// Orchestrates LBOP frame ingestion → LT decode → hash verify → decompress.
final class SessionDecoder: ObservableObject {
    @Published private(set) var stage: ScanStage = .searching
    @Published private(set) var progress: Double = 0
    @Published private(set) var symbolsReceived = 0
    @Published private(set) var blocksResolved = 0
    @Published private(set) var blockCount = 0
    @Published private(set) var shortCode: String?
    @Published private(set) var title: String?
    @Published private(set) var lastError: String?

    private var sessionId: Data?
    private var beacon: BeaconInfo?
    private var manifest: ManifestInfo?
    private var ltDecoder: LtDecoder?
    private var seenFrameKeys = Set<String>()

    func reset() {
        sessionId = nil
        beacon = nil
        manifest = nil
        ltDecoder = nil
        seenFrameKeys.removeAll()
        stage = .searching
        progress = 0
        symbolsReceived = 0
        blocksResolved = 0
        blockCount = 0
        shortCode = nil
        title = nil
        lastError = nil
    }

    func ingestQRString(_ string: String) {
        guard let frame = LBOPFrame.decodeFromQRString(string) else { return }
        ingest(frame: frame)
    }

    func ingest(frame: LBOPFrame) {
        let key = "\(frame.frameType.rawValue)-\(frame.symbolId)-\(frame.payload.count)"
        guard !seenFrameKeys.contains(key) else { return }
        seenFrameKeys.insert(key)

        if let sessionId {
            guard frame.sessionId == sessionId else { return }
        } else {
            sessionId = frame.sessionId
            shortCode = LBOPFrame.sessionShortCode(sessionId: frame.sessionId)
            stage = .sessionFound
        }

        switch frame.frameType {
        case .beacon:
            if let info = BeaconInfo.decode(from: frame.payload) {
                beacon = info
                blockCount = info.blockCount
                title = info.title
                shortCode = info.shortCode ?? shortCode
                if stage == .sessionFound || stage == .searching {
                    stage = .readingManifest
                }
            }
        case .manifest:
            if let info = ManifestInfo.decode(from: frame.payload) {
                manifest = info
                blockCount = info.blockCount
                title = info.title
                ensureDecoder(
                    blockCount: info.blockCount,
                    blockSize: info.blockSize,
                    originalLen: info.encodedByteLength
                )
                stage = .collectingData
            }
        case .data:
            ingestDataFrame(frame)
        case .endLoop:
            break
        }

        updateProgress()
    }

    func tryFinalize() -> SessionDecodeResult? {
        guard let ltDecoder, ltDecoder.isComplete else { return nil }
        stage = .reconstructing

        do {
            let encoded = try ltDecoder.reconstruct()
            stage = .verifying

            let expectedHash = manifest?.payloadHash ?? beacon?.payloadHash
            let actualHash = PayloadProcessor.sha256Hex(encoded)
            if let expectedHash, actualHash.lowercased() != expectedHash.lowercased() {
                lastError = NSLocalizedString("error.hashMismatch", comment: "")
                stage = .failed
                return nil
            }

            let compression = manifest?.compression ?? "none"
            let payload = try PayloadProcessor.decompressIfNeeded(encoded, compression: compression)

            let originalExpected = manifest?.originalByteLength ?? beacon?.originalLen ?? payload.count
            let finalData: Data
            if payload.count >= originalExpected {
                finalData = payload.prefix(originalExpected)
            } else {
                finalData = payload
            }

            let result = SessionDecodeResult(
                filename: manifest?.filename ?? "file.bin",
                title: manifest?.title ?? beacon?.title ?? "Untitled",
                publisherName: manifest?.publisherName ?? "",
                mimeType: manifest?.mimeType ?? "application/octet-stream",
                payloadHash: actualHash,
                fileData: finalData,
                shortCode: shortCode
            )
            stage = .complete
            progress = 1
            return result
        } catch {
            lastError = error.localizedDescription
            stage = .failed
            return nil
        }
    }

    private func ingestDataFrame(_ frame: LBOPFrame) {
        guard let ltDecoder else { return }
        guard let payload = try? DataPayload.decode(frame.payload) else { return }

        let symbol = LTSymbol(
            id: frame.symbolId,
            degree: payload.degree,
            neighbors: payload.neighbors,
            payload: payload.symbolBytes
        )
        if ltDecoder.ingest(symbol) {
            symbolsReceived = ltDecoder.usefulCount
            blocksResolved = ltDecoder.resolvedCount
            stage = .collectingData
        }

        if ltDecoder.isComplete {
            _ = tryFinalize()
        }
        updateProgress()
    }

    private func ensureDecoder(blockCount: Int, blockSize: Int, originalLen: Int) {
        if ltDecoder == nil {
            ltDecoder = LtDecoder(k: blockCount, blockSize: blockSize, originalLen: originalLen)
            self.blockCount = blockCount
        }
    }

    private func updateProgress() {
        guard blockCount > 0, let ltDecoder else {
            progress = stage == .complete ? 1 : 0
            return
        }
        progress = min(1, Double(ltDecoder.resolvedCount) / Double(blockCount))
    }
}

enum SessionDecoderError: LocalizedError {
    case unsupportedCompression(String)
    case inflateFailed

    var errorDescription: String? {
        switch self {
        case .unsupportedCompression(let c):
            return "Unsupported compression: \(c)"
        case .inflateFailed:
            return "Failed to decompress payload"
        }
    }
}
