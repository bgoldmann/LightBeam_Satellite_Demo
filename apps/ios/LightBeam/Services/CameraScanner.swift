import AVFoundation
import Foundation
import UIKit
import ZXingCpp

/// Live QR scanner for dense LightBeam (LBOP) codes on TV/screens.
/// Primary path: zxing-cpp on camera frames (raw binary QR, multi-symbol).
final class CameraScanner: NSObject, ObservableObject {
    let session = AVCaptureSession()

    var onQRDetected: ((Data) -> Void)?

    /// Optional stats callback: (decodeMs, qrCountThisFrame).
    var onFrameStats: ((Double, Int) -> Void)?

    @Published private(set) var isRunning = false
    @Published private(set) var cameraError: String?
    @Published private(set) var qrHitCount = 0
    @Published private(set) var lastPayloadLength = 0
    @Published private(set) var authorizationDenied = false
    @Published private(set) var lastDecodeMs: Double = 0
    @Published private(set) var lastQrPerFrame: Int = 0

    private let sessionQueue = DispatchQueue(label: "com.goldmannllc.LightBeam.camera")
    private let decodeQueue = DispatchQueue(label: "com.goldmannllc.LightBeam.decode.camera", qos: .userInitiated)
    private let decodeLock = DispatchSemaphore(value: 1)
    private var isConfigured = false
    private var interruptionObserver: NSObjectProtocol?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var recentEmits: [Data: CFAbsoluteTime] = [:]
    private var device: AVCaptureDevice?
    private var noHitSince = CFAbsoluteTimeGetCurrent()
    private var tryHarderEnabled = false

    private lazy var zxingReader: ZXIBarcodeReader = {
        let opts = ZXIReaderOptions()
        // tryHarder on 1080p/60fps causes jetsam (code 9). Start light; escalate if cold.
        opts.tryHarder = false
        opts.tryRotate = false
        opts.tryInvert = false
        opts.tryDownscale = true
        opts.maxNumberOfSymbols = 8
        opts.formats = [NSNumber(value: ZXIFormat.QR_CODE.rawValue)]
        return ZXIBarcodeReader(options: opts)
    }()

    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.startSession()
                    } else {
                        self?.authorizationDenied = true
                        self?.cameraError = NSLocalizedString("scanner.cameraDenied", comment: "")
                    }
                }
            }
        default:
            DispatchQueue.main.async {
                self.authorizationDenied = true
                self.cameraError = NSLocalizedString("scanner.cameraDenied", comment: "")
            }
        }
    }

    func stop() {
        sessionQueue.async {
            if self.session.isRunning {
                self.session.stopRunning()
            }
            DispatchQueue.main.async { self.isRunning = false }
        }
    }

    private func startSession() {
        sessionQueue.async {
            self.configureIfNeeded()
            self.observeInterruptionsIfNeeded()
            guard self.isConfigured else { return }
            if !self.session.isRunning {
                self.session.startRunning()
            }
            DispatchQueue.main.async {
                self.isRunning = self.session.isRunning
                self.cameraError = self.session.isRunning ? nil : "Camera failed to start"
            }
        }
    }

    private func observeInterruptionsIfNeeded() {
        guard interruptionObserver == nil else { return }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: .AVCaptureSessionWasInterrupted,
            object: session,
            queue: .main
        ) { [weak self] _ in
            self?.start()
        }
        NotificationCenter.default.addObserver(
            forName: .AVCaptureSessionInterruptionEnded,
            object: session,
            queue: .main
        ) { [weak self] _ in
            self?.start()
        }
    }

    private func configureIfNeeded() {
        guard !isConfigured else { return }
        session.beginConfiguration()
        // Lab data QRs are version 20 (97 modules) ×4 tiles; 720p leaves <3 px/module.
        if session.canSetSessionPreset(.hd1920x1080) {
            session.sessionPreset = .hd1920x1080
        } else if session.canSetSessionPreset(.hd1280x720) {
            session.sessionPreset = .hd1280x720
        } else {
            session.sessionPreset = .high
        }

        guard
            let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(input)
        else {
            session.commitConfiguration()
            DispatchQueue.main.async {
                self.cameraError = "No rear camera available"
            }
            return
        }
        self.device = device
        session.addInput(input)

        configureDeviceForScreenCapture(device)

        let video = AVCaptureVideoDataOutput()
        video.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        ]
        video.alwaysDiscardsLateVideoFrames = true
        video.setSampleBufferDelegate(self, queue: decodeQueue)
        if session.canAddOutput(video) {
            session.addOutput(video)
            videoOutput = video
        }

        session.commitConfiguration()
        isConfigured = true
    }

    /// Prefer sharp screen capture without underexposing denser manifest/data QRs.
    private func configureDeviceForScreenCapture(_ device: AVCaptureDevice) {
        try? device.lockForConfiguration()
        defer { device.unlockForConfiguration() }

        // Prefer 1080p @ 60 fps so each 66 ms encoder tick lands in ~4 frames and at
        // least one is untorn. Late frames are dropped, so 60 fps adds no decode backlog.
        var best: AVCaptureDevice.Format?
        var bestScore: Double = -1
        for format in device.formats {
            let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            guard dims.width >= 1280, dims.height >= 720 else { continue }
            guard dims.width <= 1920, dims.height <= 1080 else { continue }
            for range in format.videoSupportedFrameRateRanges {
                let fps = min(60.0, range.maxFrameRate)
                guard fps >= 30 else { continue }
                let resoBonus = Double(dims.width * dims.height) / Double(1920 * 1080)
                let score = fps + resoBonus * 40
                if score > bestScore {
                    best = format
                    bestScore = score
                }
            }
        }
        if let best {
            device.activeFormat = best
            let maxFps = best.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 30
            let fps = Int32(min(60.0, maxFps))
            let duration = CMTime(value: 1, timescale: fps)
            device.activeVideoMinFrameDuration = duration
            device.activeVideoMaxFrameDuration = duration
        }

        if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
        }
        if device.isAutoFocusRangeRestrictionSupported {
            device.autoFocusRangeRestriction = .near
        }
        // Auto exposure, but capped so one frame can't integrate across two QR ticks.
        // A fixed 1/250 s underexposed screens; a cap lets AE stay bright when it can.
        if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
            let cap = CMTime(value: 1, timescale: 120)
            let minDur = device.activeFormat.minExposureDuration
            let maxDur = device.activeFormat.maxExposureDuration
            if CMTimeCompare(cap, minDur) >= 0, CMTimeCompare(cap, maxDur) <= 0 {
                device.activeMaxExposureDuration = cap
            }
            device.setExposureTargetBias(-0.3, completionHandler: nil)
        }
        if device.isLowLightBoostSupported {
            device.automaticallyEnablesLowLightBoostWhenAvailable = false
        }
    }

    private func emitQRPayload(_ raw: Data) {
        guard !raw.isEmpty else { return }

        let now = CFAbsoluteTimeGetCurrent()
        // Per-payload dedupe so a 4-tile frame can emit four different codes.
        if let last = recentEmits[raw], (now - last) < 0.04 {
            return
        }
        if recentEmits.count > 64 {
            recentEmits = recentEmits.filter { now - $0.value < 0.5 }
        }
        recentEmits[raw] = now

        let length = raw.count
        DispatchQueue.main.async { [weak self] in
            self?.qrHitCount += 1
            self?.lastPayloadLength = length
        }
        onQRDetected?(raw)
    }
}

extension CameraScanner: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        let now = CFAbsoluteTimeGetCurrent()
        // Decode as fast as zxing allows; drop if previous call still running (no pileup).
        guard decodeLock.wait(timeout: .now()) == .success else { return }
        defer { decodeLock.signal() }

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        // Escalate tryHarder only after a cold stretch; drop it once we have hits.
        if now - noHitSince > 1.2, !tryHarderEnabled {
            tryHarderEnabled = true
            zxingReader.options.tryHarder = true
        }

        let t0 = CFAbsoluteTimeGetCurrent()
        // Prefer luminance-plane path (not CIImage gray allocate).
        let results = (try? zxingReader.read(pixelBuffer)) ?? []
        let decodeMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000

        var count = 0
        for result in results {
            if result.bytes.count > 0 {
                emitQRPayload(result.bytes)
                count += 1
            } else if !result.text.isEmpty {
                emitQRPayload(Data(result.text.utf8))
                count += 1
            }
        }

        if count > 0 {
            noHitSince = now
            if tryHarderEnabled {
                tryHarderEnabled = false
                zxingReader.options.tryHarder = false
            }
        }

        DispatchQueue.main.async { [weak self] in
            self?.lastDecodeMs = decodeMs
            self?.lastQrPerFrame = count
        }
        onFrameStats?(decodeMs, count)
    }
}
