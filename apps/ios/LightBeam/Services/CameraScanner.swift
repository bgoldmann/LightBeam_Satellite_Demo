import AVFoundation
import Foundation
import UIKit
import ZXingCpp

/// Live QR scanner for dense LightBeam (LBOP) codes on TV/screens.
/// Primary path: zxing-cpp on camera frames (raw binary QR).
/// Extra: AVCaptureMetadataOutput for legacy Base64 codes.
final class CameraScanner: NSObject, ObservableObject {
    let session = AVCaptureSession()

    var onQRDetected: ((Data) -> Void)?

    @Published private(set) var isRunning = false
    @Published private(set) var cameraError: String?
    @Published private(set) var qrHitCount = 0
    @Published private(set) var lastPayloadLength = 0
    @Published private(set) var authorizationDenied = false

    private let sessionQueue = DispatchQueue(label: "com.goldmannllc.LightBeam.camera")
    private let visionQueue = DispatchQueue(label: "com.goldmannllc.LightBeam.vision")
    private var isConfigured = false
    private var interruptionObserver: NSObjectProtocol?
    private var metadataOutput: AVCaptureMetadataOutput?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var lastVisionTime = CFAbsoluteTimeGetCurrent()
    private var lastEmitted = Data()
    private var lastEmitTime: CFAbsoluteTime = 0
    private var visionBusy = false
    private lazy var zxingReader: ZXIBarcodeReader = {
        let opts = ZXIReaderOptions()
        opts.tryHarder = true
        opts.tryRotate = false
        opts.tryInvert = true
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
        session.addInput(input)

        try? device.lockForConfiguration()
        if device.isFocusModeSupported(.continuousAutoFocus) {
            device.focusMode = .continuousAutoFocus
        }
        if device.isAutoFocusRangeRestrictionSupported {
            device.autoFocusRangeRestriction = .near
        }
        if device.isExposureModeSupported(.continuousAutoExposure) {
            device.exposureMode = .continuousAutoExposure
        }
        if device.isLowLightBoostSupported {
            device.automaticallyEnablesLowLightBoostWhenAvailable = true
        }
        // Slight zoom helps resolve dense QR on a distant TV
        let maxZoom = min(device.activeFormat.videoMaxZoomFactor, 2.0)
        if maxZoom > 1.05 {
            device.videoZoomFactor = min(1.35, maxZoom)
        }
        device.unlockForConfiguration()

        // Primary: system metadata QR detector (best for live capture)
        let meta = AVCaptureMetadataOutput()
        if session.canAddOutput(meta) {
            session.addOutput(meta)
            meta.setMetadataObjectsDelegate(self, queue: sessionQueue)
            if meta.availableMetadataObjectTypes.contains(.qr) {
                meta.metadataObjectTypes = [.qr]
            }
            metadataOutput = meta
        }

        // Fallback: Vision on video frames (helps when metadata misses dense codes)
        let video = AVCaptureVideoDataOutput()
        video.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
        ]
        video.alwaysDiscardsLateVideoFrames = true
        video.setSampleBufferDelegate(self, queue: visionQueue)
        if session.canAddOutput(video) {
            session.addOutput(video)
            if let conn = video.connection(with: .video) {
                if conn.isVideoOrientationSupported {
                    conn.videoOrientation = .portrait
                }
                if conn.isVideoMirroringSupported {
                    conn.isVideoMirrored = false
                }
            }
            videoOutput = video
        }

        session.commitConfiguration()
        isConfigured = true
    }

    private func emitQR(_ raw: String) {
        emitQRPayload(Data(raw.utf8))
    }

    private func emitQRPayload(_ raw: Data) {
        sessionQueue.async { [weak self] in
            self?.emitQRLocked(raw)
        }
    }

    private func emitQRLocked(_ raw: Data) {
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

extension CameraScanner: AVCaptureMetadataOutputObjectsDelegate {
    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        for object in metadataObjects {
            guard let qr = object as? AVMetadataMachineReadableCodeObject,
                  qr.type == .qr,
                  let value = qr.stringValue
            else { continue }
            emitQR(value)
        }
    }
}

extension CameraScanner: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        // Throttle Vision — metadata path is primary
        let now = CFAbsoluteTimeGetCurrent()
        guard now - lastVisionTime >= 0.03, !visionBusy else { return }
        lastVisionTime = now
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        visionBusy = true
        visionQueue.async { [weak self] in
            defer { self?.visionBusy = false }
            guard let self else { return }
            var error: NSError?
            let results = self.zxingReader.readCVPixelBuffer(pixelBuffer, error: &error) as? [ZXIResult] ?? []
            for result in results {
                if result.bytes.count > 0 {
                    self.emitQRPayload(result.bytes)
                } else if !result.text.isEmpty {
                    self.emitQR(result.text)
                }
            }
        }
    }
}
