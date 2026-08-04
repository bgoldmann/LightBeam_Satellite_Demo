import AVFoundation
import CoreImage
import Foundation
import Vision

enum VideoDecodeOutcome: String {
    case verified
    case noOpticalSignal = "no_optical_signal"
    case unsupportedFormat = "unsupported_format"
    case incomplete
    case hashFailed = "hash_failed"
}

struct VideoDecodeReport {
    var outcome: VideoDecodeOutcome
    var message: String
    var framesScanned: Int
    var qrHits: Int
    var lbopUseful: Int
    var width: Int
    var height: Int
    var codecHint: String?
}

enum VideoFrameSampler {
    enum SampleError: LocalizedError {
        case unreadable
        case noVideoTrack
        case unsupportedFormat(String)

        var errorDescription: String? {
            switch self {
            case .unreadable:
                return NSLocalizedString("decode.unsupported", comment: "")
            case .noVideoTrack:
                return NSLocalizedString("decode.unsupported", comment: "")
            case .unsupportedFormat:
                return NSLocalizedString("decode.unsupported", comment: "")
            }
        }
    }

    /// Adaptive QR sampling: ~10 fps until first LBOP hit, then consecutive frames.
    /// Upscales when short side < 720. Completes with a structured report.
    static func sampleQRStrings(
        from url: URL,
        onFrame: @escaping (_ qr: String) -> Bool,
        onProgress: @escaping (_ framesScanned: Int, _ qrHits: Int) -> Void,
        completion: @escaping (Result<VideoDecodeReport, Error>) -> Void
    ) {
        let asset = AVURLAsset(url: url)
        Task {
            do {
                let readable = try await asset.load(.isReadable)
                guard readable else {
                    throw SampleError.unsupportedFormat(url.pathExtension)
                }
                let tracks = try await asset.loadTracks(withMediaType: .video)
                guard let track = tracks.first else {
                    throw SampleError.noVideoTrack
                }

                let duration = try await asset.load(.duration)
                let naturalSize = try await track.load(.naturalSize)
                let preferredTransform = try await track.load(.preferredTransform)
                let displaySize = naturalSize.applying(preferredTransform)
                let width = Int(abs(displaySize.width))
                let height = Int(abs(displaySize.height))
                let formatHints = try await track.load(.formatDescriptions)
                let codecHint = codecName(from: formatHints)

                let reader: AVAssetReader
                do {
                    reader = try AVAssetReader(asset: asset)
                } catch {
                    throw SampleError.unsupportedFormat(codecHint ?? url.pathExtension)
                }

                let outputSettings: [String: Any] = [
                    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                ]
                let output = AVAssetReaderTrackOutput(track: track, outputSettings: outputSettings)
                output.alwaysCopiesSampleData = false
                reader.add(output)
                guard reader.startReading() else {
                    throw reader.error ?? SampleError.unsupportedFormat(codecHint ?? "unreadable")
                }

                var framesScanned = 0
                var qrHits = 0
                var lbopUseful = 0
                var sawQr = false
                var sawLbop = false
                var nextSampleTime = CMTime.zero
                var sampleInterval = CMTime(seconds: 0.1, preferredTimescale: 600) // 10 Hz
                let durationSec = CMTimeGetSeconds(duration)

                while reader.status == .reading {
                    guard let sample = output.copyNextSampleBuffer() else { break }
                    let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                    if pts < nextSampleTime { continue }

                    framesScanned += 1
                    if let qr = await extractQR(from: sample, width: width, height: height) {
                        qrHits += 1
                        sawQr = true
                        sampleInterval = CMTime(seconds: 1.0 / 30.0, preferredTimescale: 600)
                        if looksLikeLbop(qr) {
                            sawLbop = true
                            let useful = await MainActor.run { onFrame(qr) }
                            if useful { lbopUseful += 1 }
                        }
                    }
                    await MainActor.run { onProgress(framesScanned, qrHits) }
                    nextSampleTime = CMTimeAdd(pts, sampleInterval)

                    // Early stop: 8s of content with no QR
                    if !sawQr, durationSec > 0, CMTimeGetSeconds(pts) > 8 {
                        break
                    }
                }

                let outcome: VideoDecodeOutcome
                let messageKey: String
                if !sawQr || !sawLbop {
                    outcome = .noOpticalSignal
                    messageKey = "decode.noSignal"
                } else {
                    outcome = .incomplete
                    messageKey = "decode.incomplete"
                }
                let report = VideoDecodeReport(
                    outcome: outcome,
                    message: NSLocalizedString(messageKey, comment: ""),
                    framesScanned: framesScanned,
                    qrHits: qrHits,
                    lbopUseful: lbopUseful,
                    width: width,
                    height: height,
                    codecHint: codecHint
                )
                await MainActor.run { completion(.success(report)) }
            } catch {
                await MainActor.run { completion(.failure(error)) }
            }
        }
    }

    /// Backward-compatible wrapper used by older call sites.
    static func sampleQRStrings(
        from url: URL,
        onFrame: @escaping (String) -> Void,
        completion: @escaping (Result<Int, Error>) -> Void
    ) {
        sampleQRStrings(
            from: url,
            onFrame: { qr in
                onFrame(qr)
                return true
            },
            onProgress: { _, _ in },
            completion: { result in
                switch result {
                case .success(let report):
                    completion(.success(report.framesScanned))
                case .failure(let error):
                    completion(.failure(error))
                }
            }
        )
    }

    private static func looksLikeLbop(_ text: String) -> Bool {
        guard let data = Data(base64Encoded: text.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return false
        }
        guard data.count >= 4 else { return false }
        return data[0] == 0x4C && data[1] == 0x42 && data[2] == 0x4F && data[3] == 0x50 // LBOP
    }

    private static func codecName(from descriptions: [CMFormatDescription]) -> String? {
        guard let desc = descriptions.first else { return nil }
        let type = CMFormatDescriptionGetMediaSubType(desc)
        let chars: [UInt8] = [
            UInt8((type >> 24) & 0xFF),
            UInt8((type >> 16) & 0xFF),
            UInt8((type >> 8) & 0xFF),
            UInt8(type & 0xFF),
        ]
        return String(bytes: chars, encoding: .ascii)
    }

    private static func extractQR(from sample: CMSampleBuffer, width: Int, height: Int) async -> String? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sample) else { return nil }

        let shortSide = min(width, height)
        let handler: VNImageRequestHandler
        if shortSide > 0, shortSide < 720 {
            let ci = CIImage(cvPixelBuffer: pixelBuffer)
            let scale = 720.0 / CGFloat(shortSide)
            let scaled = ci.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            handler = VNImageRequestHandler(ciImage: scaled, options: [:])
        } else {
            handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        }

        return await withCheckedContinuation { continuation in
            let request = VNDetectBarcodesRequest { request, _ in
                let results = (request.results as? [VNBarcodeObservation]) ?? []
                // Prefer largest QR by bounding box area
                let best = results.max(by: { a, b in
                    let aa = a.boundingBox.width * a.boundingBox.height
                    let bb = b.boundingBox.width * b.boundingBox.height
                    return aa < bb
                })
                continuation.resume(returning: best?.payloadStringValue)
            }
            request.symbologies = [.qr]
            try? handler.perform([request])
        }
    }
}
