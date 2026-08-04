import Foundation

enum FileStore {
    static var documentsDirectory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    private static var indexURL: URL {
        documentsDirectory.appendingPathComponent("recovered_index.json")
    }

    static func loadRecords() -> [RecoveredFileRecord] {
        guard let data = try? Data(contentsOf: indexURL) else { return [] }
        return (try? JSONDecoder().decode([RecoveredFileRecord].self, from: data)) ?? []
    }

    static func saveRecord(from result: SessionDecodeResult) throws -> RecoveredFileRecord {
        let id = UUID()
        let mime = MediaTypes.resolveMime(filename: result.filename, mimeHint: result.mimeType)
        let safeName = MediaTypes.ensureFilenameExtension(
            filename: sanitizeFilename(result.filename),
            mime: mime
        )
        // Leaf name is the original filename+extension (folder isolates collisions).
        let relative = "Recovered/\(id.uuidString)/\(safeName)"
        let url = documentsDirectory.appendingPathComponent(relative)

        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try result.fileData.write(to: url, options: .atomic)

        let record = RecoveredFileRecord(
            id: id,
            filename: safeName,
            title: result.title,
            publisherName: result.publisherName,
            mimeType: mime,
            payloadHash: result.payloadHash,
            byteCount: result.fileData.count,
            recoveredAt: Date(),
            relativePath: relative
        )

        var records = loadRecords()
        records.insert(record, at: 0)
        let data = try JSONEncoder().encode(records)
        try data.write(to: indexURL, options: .atomic)
        return record
    }

    static func deleteRecord(_ record: RecoveredFileRecord) throws {
        let url = record.fileURL
        try? FileManager.default.removeItem(at: url)
        let parent = url.deletingLastPathComponent()
        if (try? FileManager.default.contentsOfDirectory(atPath: parent.path))?.isEmpty == true {
            try? FileManager.default.removeItem(at: parent)
        }
        var records = loadRecords().filter { $0.id != record.id }
        let data = try JSONEncoder().encode(records)
        try data.write(to: indexURL, options: .atomic)
    }

    private static func sanitizeFilename(_ name: String) -> String {
        let base = (name as NSString).lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleaned = base.map { char -> Character in
            let forbidden = CharacterSet(charactersIn: "<>:\"|?*\u{0000}...\u{001f}")
            if String(char).rangeOfCharacter(from: forbidden) != nil { return "_" }
            return char
        }
        let result = String(cleaned)
        if result.isEmpty || result == "." || result == ".." { return "file.bin" }
        return result
    }
}
