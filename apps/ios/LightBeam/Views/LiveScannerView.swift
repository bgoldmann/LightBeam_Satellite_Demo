import SwiftUI
import UIKit

struct LiveScannerView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var scanner = CameraScanner()
    @StateObject private var decoder = SessionDecoder()

    @State private var completedResult: SessionDecodeResult?
    @State private var showCompletion = false
    @State private var lbopHits = 0

    var body: some View {
        ZStack {
            CameraPreview(session: scanner.session)
                .ignoresSafeArea()

            VStack {
                HStack {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, .black.opacity(0.5))
                    }
                    Spacer()
                }
                .padding()

                Spacer()

                scannerOverlay
                    .padding()
            }
        }
        .navigationBarHidden(true)
        .onAppear {
            KeepAwake.setEnabled(true)
            decoder.reset()
            scanner.onQRDetected = { qr in
                decoder.ingestQRPayload(qr)
            }
            // Poll completion — ingest is async off-main
            scanner.start()
        }
        .onChange(of: decoder.symbolsReceived) { symbols in
            if symbols > lbopHits { lbopHits = symbols }
        }
        .onChange(of: decoder.stage) { stage in
            guard stage == .complete || stage == .reconstructing || stage == .verifying else { return }
            if showCompletion { return }
            if let result = decoder.tryFinalize() {
                completedResult = result
                showCompletion = true
                scanner.stop()
                KeepAwake.setEnabled(false)
            }
        }
        .onChange(of: decoder.blocksResolved) { _ in
            guard decoder.blockCount > 0,
                  decoder.blocksResolved >= decoder.blockCount,
                  !showCompletion
            else { return }
            if let result = decoder.tryFinalize() {
                completedResult = result
                showCompletion = true
                scanner.stop()
                KeepAwake.setEnabled(false)
            }
        }
        .onDisappear {
            scanner.stop()
            KeepAwake.setEnabled(false)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            KeepAwake.setEnabled(true)
            scanner.start()
        }
        .fullScreenCover(isPresented: $showCompletion) {
            if let result = completedResult {
                CompletionView(result: result) {
                    dismiss()
                }
            }
        }
    }

    private var scannerOverlay: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("stage.title")
                .font(.headline)
                .foregroundStyle(.white)

            Text(decoder.stage.localizedTitle)
                .font(.title2.bold())
                .foregroundStyle(.white)

            if let title = decoder.title {
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.9))
            }

            if let shortCode = decoder.shortCode {
                Text(String(format: NSLocalizedString("scanner.sessionCode", comment: ""), shortCode))
                    .font(.caption.monospaced())
                    .foregroundStyle(.white.opacity(0.8))
            }

            ProgressView(value: decoder.progress)
                .tint(.cyan)

            HStack {
                Label("\(decoder.blocksResolved)/\(max(decoder.blockCount, 1))", systemImage: "square.stack.3d.up")
                Spacer()
                Label("\(decoder.symbolsReceived)", systemImage: "qrcode")
            }
            .font(.caption)
            .foregroundStyle(.white.opacity(0.85))

            Text(
                String(
                    format: NSLocalizedString("scanner.hits", comment: ""),
                    scanner.qrHitCount,
                    lbopHits,
                    scanner.lastPayloadLength
                )
            )
            .font(.caption2.monospaced())
            .foregroundStyle(scanner.qrHitCount > 0 ? Color.green : Color.white.opacity(0.7))

            if decoder.blockCount > 0 && decoder.blocksResolved > 0 && decoder.blocksResolved < decoder.blockCount {
                Text("scanner.keepScanning")
                    .font(.caption2)
                    .foregroundStyle(.yellow)
            }

            if scanner.authorizationDenied || scanner.cameraError != nil {
                Text(scanner.cameraError ?? NSLocalizedString("scanner.cameraDenied", comment: ""))
                    .font(.caption)
                    .foregroundStyle(.orange)
            }

            Text("offline.notice")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.7))
                .padding(.top, 4)

            if let error = decoder.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red.opacity(0.9))
            }
        }
        .padding()
        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 16))
    }
}
