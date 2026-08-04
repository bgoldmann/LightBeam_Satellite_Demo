import AVKit
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

struct CompletionView: View {
    let result: SessionDecodeResult
    let onDone: () -> Void

    @State private var savedRecord: RecoveredFileRecord?
    @State private var saveError: String?
    @State private var showPreview = false
    @State private var showPlayer = false
    @State private var showExporter = false

    private var mime: String {
        MediaTypes.resolveMime(filename: result.filename, mimeHint: result.mimeType)
    }

    private var exportType: UTType {
        MediaTypes.utType(filename: result.filename, mime: mime)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 56))
                        .foregroundStyle(.green)
                        .frame(maxWidth: .infinity)

                    Text("completion.title")
                        .font(.title.bold())
                        .frame(maxWidth: .infinity)

                    Group {
                        detailRow("completion.filename", result.filename)
                        detailRow("completion.titleLabel", result.title)
                        if !result.publisherName.isEmpty {
                            detailRow("completion.publisher", result.publisherName)
                        }
                        detailRow(
                            "completion.size",
                            ByteCountFormatter.string(fromByteCount: Int64(result.fileData.count), countStyle: .file)
                        )
                        detailRow("completion.hash", String(result.payloadHash.prefix(16)) + "…")
                        detailRow("completion.type", mime)
                    }

                    if MediaTypes.isImage(mime: mime, filename: result.filename),
                       let uiImage = UIImage(data: result.fileData)
                    {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 220)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .frame(maxWidth: .infinity)
                    }

                    if let url = savedRecord?.fileURL {
                        if MediaTypes.isVideo(mime: mime, filename: result.filename)
                            || MediaTypes.isAudio(mime: mime, filename: result.filename)
                        {
                            Button {
                                showPlayer = true
                            } label: {
                                Label("completion.play", systemImage: "play.circle.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                        }

                        Button {
                            showPreview = true
                        } label: {
                            Label("completion.open", systemImage: "eye")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)

                        Button {
                            showExporter = true
                        } label: {
                            Label("completion.saveAs", systemImage: "square.and.arrow.down")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)

                        ShareLink(
                            item: url,
                            subject: Text(result.title),
                            message: Text(result.filename),
                            preview: SharePreview(result.filename, image: Image(systemName: "doc.fill"))
                        ) {
                            Label("completion.share", systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }

                    if let saveError {
                        Text(saveError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    Text("offline.notice")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding()
            }
            .navigationTitle("completion.navTitle")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("common.done") { onDone() }
                }
            }
            .onAppear(perform: saveFile)
            .sheet(isPresented: $showPreview) {
                if let url = savedRecord?.fileURL {
                    NavigationStack {
                        QuickLookPreview(url: url)
                            .navigationTitle(result.filename)
                            .navigationBarTitleDisplayMode(.inline)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button("common.done") { showPreview = false }
                                }
                            }
                    }
                }
            }
            .fullScreenCover(isPresented: $showPlayer) {
                if let url = savedRecord?.fileURL {
                    MediaPlayerSheet(url: url, title: result.filename) {
                        showPlayer = false
                    }
                }
            }
            .fileExporter(
                isPresented: $showExporter,
                document: RecoveredFileDocument(data: result.fileData),
                contentType: exportType,
                defaultFilename: result.filename
            ) { exportResult in
                if case .failure(let error) = exportResult {
                    saveError = error.localizedDescription
                }
            }
        }
    }

    private func detailRow(_ key: LocalizedStringKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(key)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.body)
                .textSelection(.enabled)
        }
    }

    private func saveFile() {
        do {
            savedRecord = try FileStore.saveRecord(from: result)
        } catch {
            saveError = error.localizedDescription
        }
    }
}

private struct MediaPlayerSheet: View {
    let url: URL
    let title: String
    let onClose: () -> Void

    @State private var player: AVPlayer?

    var body: some View {
        NavigationStack {
            Group {
                if let player {
                    VideoPlayer(player: player)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.done") {
                        player?.pause()
                        onClose()
                    }
                }
            }
            .onAppear {
                let p = AVPlayer(url: url)
                player = p
                p.play()
            }
            .onDisappear {
                player?.pause()
            }
        }
    }
}

private struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(url: url)
    }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: QLPreviewController, context: Context) {}

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}
