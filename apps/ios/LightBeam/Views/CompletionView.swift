import SwiftUI

struct CompletionView: View {
    let result: SessionDecodeResult
    let onDone: () -> Void

    @State private var savedRecord: RecoveredFileRecord?
    @State private var saveError: String?

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
                        detailRow("completion.size", ByteCountFormatter.string(fromByteCount: Int64(result.fileData.count), countStyle: .file))
                        detailRow("completion.hash", String(result.payloadHash.prefix(16)) + "…")
                    }

                    if let url = savedRecord?.fileURL {
                        ShareLink(item: url) {
                            Label("completion.share", systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
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
        }
    }

    private func detailRow(_ key: LocalizedStringKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(key)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.body)
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
