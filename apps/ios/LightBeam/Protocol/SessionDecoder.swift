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
    let trustState: TrustState
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
    private let ingestQueue = DispatchQueue(label: "com.goldmannllc.LightBeam.decode", qos: .userInitiated)

    func reset() {
        ingestQueue.sync {
            sessionId = nil
            beacon = nil
            manifest = nil
            ltDecoder = nil
            seenFrameKeys.removeAll()
        }
        publish(
            stage: .searching,
            progress: 0,
            symbols: 0,
            resolved: 0,
            blocks: 0,
            shortCode: nil,
            title: nil,
            error: nil
        )
    }

    /// Live camera — async so metadata callbacks stay responsive.
    func ingestQRString(_ string: String) {
        ingestQueue.async { [weak self] in
            guard let self else { return }
            let done = self.ingestStringOnQueue(string)
            let snap = self.snapshotOnQueue()
            DispatchQueue.main.async {
                self.publish(
                    stage: snap.stage,
                    progress: snap.progress,
                    symbols: snap.symbols,
                    resolved: snap.resolved,
                    blocks: snap.blocks,
                    shortCode: snap.shortCode,
                    title: snap.title,
                    error: snap.error
                )
                if done { _ = self.tryFinalize() }
            }
        }
    }

    /// Video decode / unit tests — synchronous.
    func ingestQRStringSync(_ string: String) {
        var done = false
        var snap: Snap!
        ingestQueue.sync {
            done = self.ingestStringOnQueue(string)
            snap = self.snapshotOnQueue()
        }
        publish(
            stage: snap.stage,
            progress: snap.progress,
            symbols: snap.symbols,
            resolved: snap.resolved,
            blocks: snap.blocks,
            shortCode: snap.shortCode,
            title: snap.title,
            error: snap.error
        )
        if done { _ = tryFinalize() }
    }

    /// Used by golden tests with already-parsed frames.
    func ingest(frame: LBOPFrame) {
        var done = false
        var snap: Snap!
        ingestQueue.sync {
            done = self.ingestFrameOnQueue(frame)
            snap = self.snapshotOnQueue()
        }
        publish(
            stage: snap.stage,
            progress: snap.progress,
            symbols: snap.symbols,
            resolved: snap.resolved,
            blocks: snap.blocks,
            shortCode: snap.shortCode,
            title: snap.title,
            error: snap.error
        )
        if done { _ = tryFinalize() }
    }

    private struct Snap {
        var stage: ScanStage
        var progress: Double
        var symbols: Int
        var resolved: Int
        var blocks: Int
        var shortCode: String?
        var title: String?
        var error: String?
    }

    private func ingestStringOnQueue(_ string: String) -> Bool {
        guard let frame = LBOPFrame.decodeFromQRString(string) else { return false }
        return ingestFrameOnQueue(frame)
    }

    private func ingestFrameOnQueue(_ frame: LBOPFrame) -> Bool {
        let key = "\(frame.frameType.rawValue)-\(frame.symbolId)-\(frame.payload.count)"
        guard !seenFrameKeys.contains(key) else { return false }
        seenFrameKeys.insert(key)

        if let sessionId {
            guard frame.sessionId == sessionId else { return false }
        } else {
            sessionId = frame.sessionId
        }

        switch frame.frameType {
        case .beacon:
            if let info = BeaconInfo.decode(from: frame.payload) {
                beacon = info
            }
        case .manifest:
            if let info = ManifestInfo.decode(from: frame.payload) {
                manifest = info
                if ltDecoder == nil {
                    ltDecoder = LtDecoder(
                        k: info.blockCount,
                        blockSize: info.blockSize,
                        originalLen: info.encodedByteLength
                    )
                }
            }
        case .data:
            guard let ltDecoder else { return false }
            guard let payload = try? DataPayload.decode(frame.payload) else { return false }
            _ = ltDecoder.ingest(
                LTSymbol(
                    id: frame.symbolId,
                    degree: payload.degree,
                    neighbors: payload.neighbors,
                    payload: payload.symbolBytes
                )
            )
        case .endLoop:
            break
        }
        return ltDecoder?.isComplete == true
    }

    private func snapshotOnQueue() -> Snap {
        var stage: ScanStage = .searching
        if sessionId != nil { stage = .sessionFound }
        if beacon != nil { stage = .readingManifest }
        if manifest != nil { stage = .collectingData }
        if let lt = ltDecoder {
            if lt.isComplete { stage = .reconstructing }
            else if lt.usefulCount > 0 { stage = .collectingData }
        }
        let k = ltDecoder?.k ?? manifest?.blockCount ?? beacon?.blockCount ?? 0
        let resolved = ltDecoder?.resolvedCount ?? 0
        let useful = ltDecoder?.usefulCount ?? 0
        return Snap(
            stage: stage,
            progress: k > 0 ? min(1, Double(resolved) / Double(k)) : 0,
            symbols: useful,
            resolved: resolved,
            blocks: k,
            shortCode: sessionId.map { LBOPFrame.sessionShortCode(sessionId: $0) } ?? beacon?.shortCode,
            title: manifest?.title ?? beacon?.title,
            error: lastError
        )
    }

    private func publish(
        stage: ScanStage,
        progress: Double,
        symbols: Int,
        resolved: Int,
        blocks: Int,
        shortCode: String?,
        title: String?,
        error: String?
    ) {
        let apply = {
            self.stage = stage
            self.progress = progress
            self.symbolsReceived = symbols
            self.blocksResolved = resolved
            self.blockCount = blocks
            self.shortCode = shortCode
            self.title = title
            self.lastError = error
        }
        if Thread.isMainThread { apply() } else { DispatchQueue.main.sync(execute: apply) }
    }

    func tryFinalize() -> SessionDecodeResult? {
        var localDecoder: LtDecoder?
        var localManifest: ManifestInfo?
        var localBeacon: BeaconInfo?
        var localShort: String?
        ingestQueue.sync {
            localDecoder = ltDecoder
            localManifest = manifest
            localBeacon = beacon
            localShort = sessionId.map { LBOPFrame.sessionShortCode(sessionId: $0) } ?? shortCode
        }
        guard let ltDecoder = localDecoder, ltDecoder.isComplete else { return nil }

        do {
            stage = .reconstructing
            let encoded = try ltDecoder.reconstruct()
            stage = .verifying
            let expectedHash = localManifest?.payloadHash ?? localBeacon?.payloadHash
            let actualHash = PayloadProcessor.sha256Hex(encoded)
            if let expectedHash, actualHash.lowercased() != expectedHash.lowercased() {
                lastError = NSLocalizedString("error.hashMismatch", comment: "")
                stage = .failed
                return nil
            }
            let compression = localManifest?.compression ?? "none"
            let payload = try PayloadProcessor.decompressIfNeeded(encoded, compression: compression)
            let originalExpected = localManifest?.originalByteLength ?? localBeacon?.originalLen ?? payload.count
            if payload.count < originalExpected {
                lastError = "Recovered file is truncated (\(payload.count)/\(originalExpected) bytes)"
                stage = .failed
                return nil
            }
            let finalData = payload.count > originalExpected ? Data(payload.prefix(originalExpected)) : payload
            let rawName = localManifest?.filename ?? "file.bin"
            let mime = MediaTypes.resolveMime(
                filename: rawName,
                mimeHint: localManifest?.mimeType
            )
            let filename = MediaTypes.ensureFilenameExtension(filename: rawName, mime: mime)
            let trust = PublisherTrust.evaluate(
                publisherKeyId: localManifest?.publisherKeyId,
                signatureBase64: localManifest?.signatureBase64,
                unsignedManifest: localManifest?.unsignedFields ?? [:]
            )
            if trust == .verificationFailed {
                lastError = NSLocalizedString("error.signatureFailed", comment: "")
                stage = .failed
                return nil
            }
            let result = SessionDecodeResult(
                filename: filename,
                title: localManifest?.title ?? localBeacon?.title ?? "Untitled",
                publisherName: localManifest?.publisherName ?? "",
                mimeType: mime,
                payloadHash: actualHash,
                fileData: finalData,
                shortCode: localShort,
                trustState: trust
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
