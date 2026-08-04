import Foundation
import UniformTypeIdentifiers

/// Map filename ↔ MIME so recovered files keep a playable/openable extension.
enum MediaTypes {
    private static let extToMime: [String: String] = [
        "mp4": "video/mp4",
        "m4v": "video/x-m4v",
        "mov": "video/quicktime",
        "webm": "video/webm",
        "mkv": "video/x-matroska",
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "wav": "audio/wav",
        "aac": "audio/aac",
        "pdf": "application/pdf",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "heic": "image/heic",
        "txt": "text/plain",
        "json": "application/json",
        "zip": "application/zip",
        "bin": "application/octet-stream",
    ]

    private static let mimeToExt: [String: String] = [
        "video/mp4": "mp4",
        "video/x-m4v": "m4v",
        "video/quicktime": "mov",
        "video/webm": "webm",
        "video/x-matroska": "mkv",
        "audio/mpeg": "mp3",
        "audio/mp4": "m4a",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/aac": "aac",
        "application/pdf": "pdf",
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/heic": "heic",
        "text/plain": "txt",
        "application/json": "json",
        "application/zip": "zip",
    ]

    static func extensionOf(_ filename: String) -> String {
        let base = (filename as NSString).lastPathComponent
        let ext = (base as NSString).pathExtension.lowercased()
        return ext
    }

    static func mimeFromFilename(_ filename: String) -> String? {
        let ext = extensionOf(filename)
        guard !ext.isEmpty else { return nil }
        return extToMime[ext]
    }

    static func extensionFromMime(_ mime: String) -> String? {
        let key = mime.lowercased().split(separator: ";").first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        if key.isEmpty || key == "application/octet-stream" { return nil }
        return mimeToExt[key]
    }

    static func resolveMime(filename: String, mimeHint: String?) -> String {
        let hint = (mimeHint ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !hint.isEmpty && hint != "application/octet-stream" {
            return hint.split(separator: ";").first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? hint
        }
        return mimeFromFilename(filename) ?? "application/octet-stream"
    }

    /// Keep original extension; if missing, append one from MIME.
    static func ensureFilenameExtension(filename: String, mime: String) -> String {
        let base = (filename as NSString).lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleaned = base.isEmpty ? "file" : base
        if !extensionOf(cleaned).isEmpty { return cleaned }
        if let ext = extensionFromMime(mime) {
            return "\(cleaned).\(ext)"
        }
        return cleaned
    }

    static func utType(filename: String, mime: String) -> UTType {
        let ext = extensionOf(filename)
        if !ext.isEmpty, let t = UTType(filenameExtension: ext) { return t }
        if let t = UTType(mimeType: mime) { return t }
        return .data
    }

    static func isVideo(mime: String, filename: String) -> Bool {
        let m = resolveMime(filename: filename, mimeHint: mime)
        return m.hasPrefix("video/")
    }

    static func isAudio(mime: String, filename: String) -> Bool {
        let m = resolveMime(filename: filename, mimeHint: mime)
        return m.hasPrefix("audio/")
    }

    static func isImage(mime: String, filename: String) -> Bool {
        let m = resolveMime(filename: filename, mimeHint: mime)
        return m.hasPrefix("image/")
    }
}
