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
        let safeName = sanitizeFilename(result.filename)
        let relative = "Recovered/\(id.uuidString)_\(safeName)"
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
            mimeType: result.mimeType,
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
        try? FileManager.default.removeItem(at: record.fileURL)
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
