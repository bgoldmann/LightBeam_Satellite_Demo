import SwiftUI

struct LiveScannerView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var scanner = CameraScanner()
    @StateObject private var decoder = SessionDecoder()

    @State private var completedResult: SessionDecodeResult?
    @State private var showCompletion = false

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
            scanner.onQRDetected = { qr in
                decoder.ingestQRString(qr)
                if let result = decoder.tryFinalize() {
                    completedResult = result
                    showCompletion = true
                    scanner.stop()
                }
            }
            scanner.start()
        }
        .onDisappear {
            scanner.stop()
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
