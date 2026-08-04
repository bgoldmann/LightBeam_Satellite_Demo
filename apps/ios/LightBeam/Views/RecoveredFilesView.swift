import AVKit
import QuickLook
import SwiftUI

struct RecoveredFilesView: View {
    @State private var records: [RecoveredFileRecord] = []
    @State private var errorMessage: String?
    @State private var previewURL: URL?
    @State private var playURL: URL?
    @State private var playTitle = ""

    var body: some View {
        List {
            if records.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "tray")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("files.empty.title")
                        .font(.headline)
                    Text("files.empty.subtitle")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
            } else {
                ForEach(records) { record in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(record.title).font(.headline)
                        Text(record.filename).font(.subheadline).foregroundStyle(.secondary)
                        Text("\(ByteCountFormatter.string(fromByteCount: Int64(record.byteCount), countStyle: .file)) · \(record.mimeType)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(record.recoveredAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 12) {
                            if MediaTypes.isVideo(mime: record.mimeType, filename: record.filename)
                                || MediaTypes.isAudio(mime: record.mimeType, filename: record.filename)
                            {
                                Button {
                                    playTitle = record.filename
                                    playURL = record.fileURL
                                } label: {
                                    Label("completion.play", systemImage: "play.circle.fill")
                                }
                            }

                            Button {
                                previewURL = record.fileURL
                            } label: {
                                Label("completion.open", systemImage: "eye")
                            }

                            ShareLink(
                                item: record.fileURL,
                                preview: SharePreview(record.filename, image: Image(systemName: "doc.fill"))
                            ) {
                                Label("completion.share", systemImage: "square.and.arrow.up")
                            }
                        }
                        .font(.caption)
                    }
                    .swipeActions {
                        Button(role: .destructive) {
                            delete(record)
                        } label: {
                            Label("common.delete", systemImage: "trash")
                        }
                    }
                }
            }
        }
        .navigationTitle("home.recoveredFiles")
        .onAppear { reload() }
        .refreshable { reload() }
        .alert("common.error", isPresented: .constant(errorMessage != nil)) {
            Button("common.ok") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .sheet(item: Binding(
            get: { previewURL.map { IdentifiedURL(url: $0) } },
            set: { previewURL = $0?.url }
        )) { item in
            NavigationStack {
                RecoveredQuickLook(url: item.url)
                    .navigationTitle(item.url.lastPathComponent)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("common.done") { previewURL = nil }
                        }
                    }
            }
        }
        .fullScreenCover(item: Binding(
            get: { playURL.map { IdentifiedURL(url: $0) } },
            set: { playURL = $0?.url }
        )) { item in
            NavigationStack {
                VideoPlayer(player: AVPlayer(url: item.url))
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle(playTitle)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("common.done") { playURL = nil }
                        }
                    }
            }
        }
    }

    private func reload() {
        records = FileStore.loadRecords()
    }

    private func delete(_ record: RecoveredFileRecord) {
        do {
            try FileStore.deleteRecord(record)
            reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct IdentifiedURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

private struct RecoveredQuickLook: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

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
