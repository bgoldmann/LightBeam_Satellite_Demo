import SwiftUI
import UniformTypeIdentifiers

struct RecoveredFileDocument: FileDocument {
    static var readableContentTypes: [UTType] {
        [.data, .mpeg4Movie, .quickTimeMovie, .movie, .mpeg4Audio, .mp3, .wav, .pdf, .png, .jpeg, .gif, .plainText, .json, .zip]
    }
    static var writableContentTypes: [UTType] { readableContentTypes }

    var data: Data

    init(data: Data) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw CocoaError(.fileReadCorruptFile)
        }
        self.data = data
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
