import SwiftUI

struct RecoveredFilesView: View {
    @State private var records: [RecoveredFileRecord] = []
    @State private var errorMessage: String?

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
                    VStack(alignment: .leading, spacing: 6) {
                        Text(record.title).font(.headline)
                        Text(record.filename).font(.subheadline).foregroundStyle(.secondary)
                        Text(record.recoveredAt.formatted(date: .abbreviated, time: .shortened))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ShareLink(item: record.fileURL) {
                            Label("completion.share", systemImage: "square.and.arrow.up")
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
