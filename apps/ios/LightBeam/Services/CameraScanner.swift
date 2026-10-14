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
    private var isConfigured = false
    private var interruptionObserver: NSObjectProtocol?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var lastDecodeTime = CFAbsoluteTimeGetCurrent()
    private var lastEmitted = Data()
    private var lastEmitTime: CFAbsoluteTime = 0
    private var decodeBusy = false
    private var device: AVCaptureDevice?

    private lazy var zxingReader: ZXIBarcodeReader = {
        let opts = ZXIReaderOptions()
        opts.tryHarder = true
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

    /// Prefer 60 fps and short exposure so consecutive QR ticks do not blend.
    private func configureDeviceForScreenCapture(_ device: AVCaptureDevice) {
        try? device.lockForConfiguration()
        defer { device.unlockForConfiguration() }

        // Prefer a format that supports ≥60 fps at ~1080p.
        var best: AVCaptureDevice.Format?
        var bestFps: Double = 0
        for format in device.formats {
            let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            guard dims.width >= 1280, dims.height >= 720 else { continue }
            for range in format.videoSupportedFrameRateRanges {
                if range.maxFrameRate >= 59.0, range.maxFrameRate > bestFps {
                    best = format
                    bestFps = range.maxFrameRate
                }
            }
        }
        if let best {
            device.activeFormat = best
            let fps = min(60.0, bestFps)
            let duration = CMTime(value: 1, timescale: CMTimeScale(fps))
            device.activeVideoMinFrameDuration = duration
            device.activeVideoMaxFrameDuration = duration
        }

        if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
        }
        if device.isAutoFocusRangeRestrictionSupported {
            device.autoFocusRangeRestriction = .near
        }
        if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
        }
        // Cap exposure duration so one camera frame doesn't smear two QR ticks.
        if device.isExposureModeSupported(.custom) {
            let maxDuration = CMTime(value: 1, timescale: 250)
            let minDuration = device.activeFormat.minExposureDuration
            let duration = CMTimeCompare(maxDuration, minDuration) > 0 ? maxDuration : minDuration
            let iso = min(max(device.iso, device.activeFormat.minISO), device.activeFormat.maxISO)
            try? device.setExposureModeCustom(duration: duration, iso: iso, completionHandler: nil)
        } else if device.isExposureModeSupported(.continuousAutoExposure) {
            // Bias toward shorter exposure when custom mode is unavailable.
            device.setExposureTargetBias(-1.0, completionHandler: nil)
        }
        if device.isLowLightBoostSupported {
            device.automaticallyEnablesLowLightBoostWhenAvailable = false
        }
        // No default zoom — Lab shows four QRs that must all fit in frame.
    }

    private func emitQR(_ raw: String) {
        emitQRPayload(Data(raw.utf8))
    }

    private func emitQRPayload(_ raw: Data) {
        guard !raw.isEmpty else { return }

        let now = CFAbsoluteTimeGetCurrent()
        if raw == lastEmitted && (now - lastEmitTime) < 0.025 {
            return
        }
        lastEmitted = raw
        lastEmitTime = now

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
        // ~33 fps decode budget; drop frames if the previous decode is still busy.
        guard now - lastDecodeTime >= 0.03, !decodeBusy else { return }
        lastDecodeTime = now
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        decodeBusy = true
        defer { decodeBusy = false }

        let t0 = CFAbsoluteTimeGetCurrent()
        let results = (try? zxingReader.read(pixelBuffer)) ?? []
        let decodeMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000

        var count = 0
        for result in results {
            if result.bytes.count > 0 {
                emitQRPayload(result.bytes)
                count += 1
            } else if !result.text.isEmpty {
                emitQR(result.text)
                count += 1
            }
        }

        DispatchQueue.main.async { [weak self] in
            self?.lastDecodeMs = decodeMs
            self?.lastQrPerFrame = count
        }
        onFrameStats?(decodeMs, count)
    }
}
