import AVFoundation
import Foundation
import UIKit
import Vision

/// Live QR scanner optimized for dense LightBeam (LBOP) codes on TV/screens.
/// Primary path: AVCaptureMetadataOutput (system QR detector).
/// Fallback: Vision barcode detection on throttled frames.
final class CameraScanner: NSObject, ObservableObject {
    let session = AVCaptureSession()

    var onQRDetected: ((String) -> Void)?

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
    private var lastEmitted = ""
    private var lastEmitTime: CFAbsoluteTime = 0
    private var visionBusy = false

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
        session.sessionPreset = .high

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
            meta.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
            if meta.availableMetadataObjectTypes.contains(.qr) {
                meta.metadataObjectTypes = [.qr]
            }
            metadataOutput = meta
        }

        // Fallback: Vision on video frames (helps when metadata misses dense codes)
        let video = AVCaptureVideoDataOutput()
        video.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
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
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Deduplicate identical payloads within 80ms (metadata fires very often)
        let now = CFAbsoluteTimeGetCurrent()
        if text == lastEmitted && (now - lastEmitTime) < 0.08 {
            return
        }
        lastEmitted = text
        lastEmitTime = now

        qrHitCount += 1
        lastPayloadLength = text.count
        onQRDetected?(text)
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
            return
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
        guard now - lastVisionTime >= 0.12, !visionBusy else { return }
        lastVisionTime = now
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        visionBusy = true
        let orientation = Self.visionOrientation(for: connection)

        visionQueue.async { [weak self] in
            defer { self?.visionBusy = false }
            let request = VNDetectBarcodesRequest { [weak self] request, _ in
                guard let results = request.results as? [VNBarcodeObservation] else { return }
                // Prefer largest QR by bounding box
                let best = results
                    .filter { $0.symbology == .qr }
                    .max(by: {
                        ($0.boundingBox.width * $0.boundingBox.height)
                            < ($1.boundingBox.width * $1.boundingBox.height)
                    })
                guard let payload = best?.payloadStringValue else { return }
                DispatchQueue.main.async {
                    self?.emitQR(payload)
                }
            }
            request.symbologies = [.qr]

            let handler = VNImageRequestHandler(
                cvPixelBuffer: pixelBuffer,
                orientation: orientation,
                options: [:]
            )
            try? handler.perform([request])
        }
    }

    private static func visionOrientation(for connection: AVCaptureConnection) -> CGImagePropertyOrientation {
        switch connection.videoOrientation {
        case .portrait: return .right
        case .portraitUpsideDown: return .left
        case .landscapeRight: return .up
        case .landscapeLeft: return .down
        @unknown default: return .right
        }
    }
}
