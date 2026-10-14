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
    @Published private(set) var completedResult: SessionDecodeResult?
    @Published private(set) var uniqueSymbolsPerSec: Double = 0
    @Published private(set) var duplicateRate: Double = 0

    private var sessionId: Data?
    private var beacon: BeaconInfo?
    private var manifest: ManifestInfo?
    private var ltDecoder: LtDecoder?
    private var seenFrameKeys = Set<String>()
    private var preManifestBuffer: [LBOPFrame] = []
    private let maxPreManifestBuffer = 256
    private let ingestQueue = DispatchQueue(label: "com.goldmannllc.LightBeam.decode", qos: .userInitiated)
    private var lastPublishTime: CFAbsoluteTime = 0
    private var pendingPublish = false
    private var finalizeStarted = false

    // Rate stats
    private var usefulInWindow = 0
    private var duplicatesInWindow = 0
    private var windowStart = CFAbsoluteTimeGetCurrent()

    func reset() {
        ingestQueue.sync {
            sessionId = nil
            beacon = nil
            manifest = nil
            ltDecoder = nil
            seenFrameKeys.removeAll()
            preManifestBuffer.removeAll()
            finalizeStarted = false
            usefulInWindow = 0
            duplicatesInWindow = 0
            windowStart = CFAbsoluteTimeGetCurrent()
        }
        completedResult = nil
        uniqueSymbolsPerSec = 0
        duplicateRate = 0
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

    /// Live camera — async so capture callbacks stay responsive.
    func ingestQRString(_ string: String) {
        ingestQRPayload(Data(string.utf8))
    }

    func ingestQRPayload(_ data: Data) {
        ingestQueue.async { [weak self] in
            guard let self else { return }
            let done = self.ingestPayloadOnQueue(data)
            self.schedulePublish()
            if done { self.startFinalizeOnQueue() }
        }
    }

    /// Video decode / unit tests — synchronous.
    func ingestQRStringSync(_ string: String) {
        ingestQRPayloadSync(Data(string.utf8))
    }

    func ingestQRPayloadSync(_ data: Data) {
        var done = false
        var snap: Snap!
        ingestQueue.sync {
            done = self.ingestPayloadOnQueue(data)
            snap = self.snapshotOnQueue()
            if done { self.startFinalizeOnQueue() }
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
    }

    /// Used by golden tests with already-parsed frames.
    func ingest(frame: LBOPFrame) {
        var done = false
        var snap: Snap!
        ingestQueue.sync {
            done = self.ingestFrameOnQueue(frame)
            snap = self.snapshotOnQueue()
            if done { self.startFinalizeOnQueue() }
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

    private func ingestPayloadOnQueue(_ data: Data) -> Bool {
        guard let frame = LBOPFrame.decodeFromQRPayload(data) else { return false }
        return ingestFrameOnQueue(frame)
    }

    private func frameKey(_ frame: LBOPFrame) -> String {
        "\(frame.frameType.rawValue)-\(frame.symbolId)-\(frame.payload.count)"
    }

    private func ingestFrameOnQueue(_ frame: LBOPFrame) -> Bool {
        let key = frameKey(frame)
        if seenFrameKeys.contains(key) {
            noteDuplicate()
            return false
        }

        if let sessionId {
            guard frame.sessionId == sessionId else { return false }
        } else {
            sessionId = frame.sessionId
        }

        switch frame.frameType {
        case .beacon:
            if let info = BeaconInfo.decode(from: frame.payload) {
                beacon = info
                seenFrameKeys.insert(key)
                // Eager LT only when beacon carries encoded_len (post-compression).
                // Using original_len here breaks hash verify on compressed transfers.
                let fountainLen = info.fountainPayloadLen
                if ltDecoder == nil, info.blockCount > 0, info.blockSize > 0, fountainLen > 0 {
                    ltDecoder = LtDecoder(
                        k: info.blockCount,
                        blockSize: info.blockSize,
                        originalLen: fountainLen
                    )
                    flushPreManifestBuffer()
                }
            }
        case .manifest:
            if let info = ManifestInfo.decode(from: frame.payload) {
                manifest = info
                seenFrameKeys.insert(key)
                if ltDecoder == nil {
                    ltDecoder = LtDecoder(
                        k: info.blockCount,
                        blockSize: info.blockSize,
                        originalLen: info.encodedByteLength
                    )
                } else {
                    // Correct truncation if we started from beacon.
                    ltDecoder?.setFountainPayloadLength(info.encodedByteLength)
                }
                flushPreManifestBuffer()
            }
        case .data:
            guard let ltDecoder else {
                // Buffer until beacon/manifest arrives — do NOT mark seen yet.
                if preManifestBuffer.count < maxPreManifestBuffer {
                    preManifestBuffer.append(frame)
                }
                return false
            }
            guard let payload = try? DataPayload.decode(frame.payload) else { return false }
            let accepted = ltDecoder.ingest(
                LTSymbol(
                    id: frame.symbolId,
                    degree: payload.degree,
                    neighbors: payload.neighbors,
                    payload: payload.symbolBytes
                )
            )
            seenFrameKeys.insert(key)
            if accepted {
                noteUseful()
            } else {
                noteDuplicate()
            }
        case .endLoop:
            seenFrameKeys.insert(key)
        }
        return ltDecoder?.isComplete == true
    }

    private func flushPreManifestBuffer() {
        guard let ltDecoder else { return }
        let buffered = preManifestBuffer
        preManifestBuffer.removeAll()
        for frame in buffered {
            let key = frameKey(frame)
            if seenFrameKeys.contains(key) { continue }
            guard let payload = try? DataPayload.decode(frame.payload) else { continue }
            let accepted = ltDecoder.ingest(
                LTSymbol(
                    id: frame.symbolId,
                    degree: payload.degree,
                    neighbors: payload.neighbors,
                    payload: payload.symbolBytes
                )
            )
            seenFrameKeys.insert(key)
            if accepted { noteUseful() } else { noteDuplicate() }
        }
    }

    private func noteUseful() {
        usefulInWindow += 1
        updateRatesIfNeeded()
    }

    private func noteDuplicate() {
        duplicatesInWindow += 1
        updateRatesIfNeeded()
    }

    private func updateRatesIfNeeded() {
        let now = CFAbsoluteTimeGetCurrent()
        let elapsed = now - windowStart
        guard elapsed >= 1.0 else { return }
        let total = usefulInWindow + duplicatesInWindow
        let ups = Double(usefulInWindow) / elapsed
        let dup = total > 0 ? Double(duplicatesInWindow) / Double(total) : 0
        usefulInWindow = 0
        duplicatesInWindow = 0
        windowStart = now
        DispatchQueue.main.async { [weak self] in
            self?.uniqueSymbolsPerSec = ups
            self?.duplicateRate = dup
        }
    }

    private func schedulePublish() {
        let now = CFAbsoluteTimeGetCurrent()
        // Throttle UI updates to ~10 Hz.
        if now - lastPublishTime >= 0.1 {
            lastPublishTime = now
            pendingPublish = false
            let snap = snapshotOnQueue()
            DispatchQueue.main.async { [weak self] in
                self?.publish(
                    stage: snap.stage,
                    progress: snap.progress,
                    symbols: snap.symbols,
                    resolved: snap.resolved,
                    blocks: snap.blocks,
                    shortCode: snap.shortCode,
                    title: snap.title,
                    error: snap.error
                )
            }
        } else if !pendingPublish {
            pendingPublish = true
            let delay = 0.1 - (now - lastPublishTime)
            ingestQueue.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, self.pendingPublish else { return }
                self.pendingPublish = false
                self.lastPublishTime = CFAbsoluteTimeGetCurrent()
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
                }
            }
        }
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

    /// Must be called on `ingestQueue`. Sets `completedResult` synchronously so sync callers can read it.
    private func startFinalizeOnQueue() {
        guard !finalizeStarted else { return }
        guard let ltDecoder, ltDecoder.isComplete else { return }
        finalizeStarted = true

        let localDecoder = ltDecoder
        let localManifest = manifest
        let localBeacon = beacon
        let localShort = sessionId.map { LBOPFrame.sessionShortCode(sessionId: $0) } ?? shortCode

        do {
            DispatchQueue.main.async { [weak self] in self?.stage = .reconstructing }
            let encoded = try localDecoder.reconstruct()
            DispatchQueue.main.async { [weak self] in self?.stage = .verifying }
            let expectedHash = localManifest?.payloadHash ?? localBeacon?.payloadHash
            let actualHash = PayloadProcessor.sha256Hex(encoded)
            if let expectedHash, actualHash.lowercased() != expectedHash.lowercased() {
                DispatchQueue.main.async { [weak self] in
                    self?.lastError = NSLocalizedString("error.hashMismatch", comment: "")
                    self?.stage = .failed
                }
                return
            }
            let compression = localManifest?.compression ?? "none"
            let payload = try PayloadProcessor.decompressIfNeeded(encoded, compression: compression)
            let originalExpected = localManifest?.originalByteLength ?? localBeacon?.originalLen ?? payload.count
            if payload.count < originalExpected {
                DispatchQueue.main.async { [weak self] in
                    self?.lastError = "Recovered file is truncated (\(payload.count)/\(originalExpected) bytes)"
                    self?.stage = .failed
                }
                return
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
                DispatchQueue.main.async { [weak self] in
                    self?.lastError = NSLocalizedString("error.signatureFailed", comment: "")
                    self?.stage = .failed
                }
                return
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
            let applyComplete = {
                self.stage = .complete
                self.progress = 1
                self.completedResult = result
            }
            if Thread.isMainThread {
                applyComplete()
            } else {
                DispatchQueue.main.sync(execute: applyComplete)
            }
        } catch {
            let msg = error.localizedDescription
            let applyFail = {
                self.lastError = msg
                self.stage = .failed
            }
            if Thread.isMainThread {
                applyFail()
            } else {
                DispatchQueue.main.async(execute: applyFail)
            }
        }
    }

    /// Sync finalize for video decode / unit tests. Live camera uses published `completedResult`.
    func tryFinalize() -> SessionDecodeResult? {
        if let completedResult { return completedResult }
        ingestQueue.sync {
            guard let lt = ltDecoder, lt.isComplete else { return }
            startFinalizeOnQueue()
        }
        return completedResult
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
