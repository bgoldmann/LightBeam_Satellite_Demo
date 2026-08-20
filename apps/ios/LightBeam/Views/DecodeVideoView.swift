import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct DecodeVideoView: View {
    @StateObject private var decoder = SessionDecoder()
    @State private var pickerItem: PhotosPickerItem?
    @State private var isProcessing = false
    @State private var framesSampled = 0
    @State private var qrHits = 0
    @State private var completedResult: SessionDecodeResult?
    @State private var showCompletion = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var showDocumentPicker = false
    @State private var report: VideoDecodeReport?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("decode.tip")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Text("decode.subtitle")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                PhotosPicker(selection: $pickerItem, matching: .videos) {
                    Label("decode.pickPhotos", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isProcessing)

                Button {
                    showDocumentPicker = true
                } label: {
                    Label("decode.pickDocument", systemImage: "doc")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isProcessing)

                if isProcessing {
                    ProgressView("decode.processing")
                    Text(decoder.stage.localizedTitle)
                    ProgressView(value: decoder.progress)
                    Text(
                        String(
                            format: NSLocalizedString("decode.progress", comment: ""),
                            framesSampled,
                            qrHits
                        )
                    )
                    .font(.caption)
                }

                if let statusMessage {
                    Text(statusMessage)
                        .font(.subheadline)
                        .foregroundStyle(statusColor)
                }

                stageList

                Text("offline.notice")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text("decode.phoneSafeHint")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding()
        }
        .navigationTitle("home.decodeVideo")
        .onChange(of: pickerItem) { newItem in
            guard let newItem else { return }
            Task { await loadVideo(from: newItem) }
        }
        .fileImporter(
            isPresented: $showDocumentPicker,
            allowedContentTypes: [.movie, .mpeg4Movie, .quickTimeMovie, .video],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                processVideo(at: url)
            case .failure(let error):
                errorMessage = error.localizedDescription
            }
        }
        .alert("common.error", isPresented: .constant(errorMessage != nil)) {
            Button("common.ok") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .fullScreenCover(isPresented: $showCompletion) {
            if let result = completedResult {
                CompletionView(result: result) {
                    showCompletion = false
                }
            }
        }
    }

    private var statusColor: Color {
        guard let report else { return .secondary }
        switch report.outcome {
        case .verified: return .green
        case .noOpticalSignal, .unsupportedFormat: return .orange
        case .incomplete, .hashFailed: return .red
        }
    }

    private var stageList: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(ScanStage.allCases.filter { $0 != .failed }) { stage in
                HStack {
                    Image(systemName: stageIcon(stage))
                        .foregroundStyle(stageColor(stage))
                    Text(stage.localizedTitle)
                    Spacer()
                }
                .font(.subheadline)
            }
        }
    }

    private func stageIcon(_ stage: ScanStage) -> String {
        if decoder.stage == stage { return "largecircle.fill.circle" }
        if stageOrder(stage) < stageOrder(decoder.stage) { return "checkmark.circle.fill" }
        return "circle"
    }

    private func stageColor(_ stage: ScanStage) -> Color {
        if stageOrder(stage) < stageOrder(decoder.stage) { return .green }
        if decoder.stage == stage { return .cyan }
        return .secondary
    }

    private func stageOrder(_ stage: ScanStage) -> Int {
        ScanStage.allCases.firstIndex(of: stage) ?? 0
    }

    private func loadVideo(from item: PhotosPickerItem) async {
        guard let movie = try? await item.loadTransferable(type: VideoFile.self) else {
            errorMessage = NSLocalizedString("decode.loadFailed", comment: "")
            return
        }
        processVideo(at: movie.url)
    }

    private func processVideo(at url: URL) {
        decoder.reset()
        isProcessing = true
        framesSampled = 0
        qrHits = 0
        report = nil
        statusMessage = nil
        completedResult = nil
        KeepAwake.setEnabled(true)

        let needsStop = url.startAccessingSecurityScopedResource()
        VideoFrameSampler.sampleQRStrings(
            from: url,
            onFrame: { qr in
                let before = decoder.symbolsReceived
                decoder.ingestQRPayloadSync(qr)
                if let result = decoder.tryFinalize() {
                    completedResult = result
                    showCompletion = true
                }
                return decoder.symbolsReceived > before || decoder.stage == .complete
            },
            onProgress: { frames, qr in
                framesSampled = frames
                qrHits = qr
            },
            completion: { result in
                if needsStop { url.stopAccessingSecurityScopedResource() }
                isProcessing = false
                KeepAwake.setEnabled(false)
                switch result {
                case .success(var r):
                    framesSampled = r.framesScanned
                    qrHits = r.qrHits
                    if completedResult == nil, let final = decoder.tryFinalize() {
                        completedResult = final
                        showCompletion = true
                        r.outcome = .verified
                        r.message = NSLocalizedString("decode.verified", comment: "")
                    } else if completedResult != nil {
                        r.outcome = .verified
                        r.message = NSLocalizedString("decode.verified", comment: "")
                    } else if decoder.stage != .complete, r.outcome == .incomplete, r.lbopUseful > 0 {
                        r.message = NSLocalizedString("decode.incomplete", comment: "")
                    }
                    report = r
                    statusMessage = r.message
                case .failure(let error):
                    report = VideoDecodeReport(
                        outcome: .unsupportedFormat,
                        message: error.localizedDescription,
                        framesScanned: framesSampled,
                        qrHits: qrHits,
                        lbopUseful: 0,
                        width: 0,
                        height: 0,
                        codecHint: url.pathExtension
                    )
                    statusMessage = error.localizedDescription
                    errorMessage = error.localizedDescription
                }
            }
        )
    }
}

private struct VideoFile: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { video in
            SentTransferredFile(video.url)
        } importing: { received in
            let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
            let dest = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(ext)
            try FileManager.default.copyItem(at: received.file, to: dest)
            return Self(url: dest)
        }
    }
}
