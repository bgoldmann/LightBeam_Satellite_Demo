package com.goldmann.lightbeam.protocol

object MediaTypes {
    private val extToMime = mapOf(
        "mp4" to "video/mp4",
        "m4v" to "video/x-m4v",
        "mov" to "video/quicktime",
        "webm" to "video/webm",
        "mkv" to "video/x-matroska",
        "mp3" to "audio/mpeg",
        "m4a" to "audio/mp4",
        "wav" to "audio/wav",
        "aac" to "audio/aac",
        "pdf" to "application/pdf",
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "gif" to "image/gif",
        "webp" to "image/webp",
        "heic" to "image/heic",
        "txt" to "text/plain",
        "json" to "application/json",
        "zip" to "application/zip",
        "bin" to "application/octet-stream",
    )

    private val mimeToExt = mapOf(
        "video/mp4" to "mp4",
        "video/x-m4v" to "m4v",
        "video/quicktime" to "mov",
        "video/webm" to "webm",
        "video/x-matroska" to "mkv",
        "audio/mpeg" to "mp3",
        "audio/mp4" to "m4a",
        "audio/wav" to "wav",
        "audio/x-wav" to "wav",
        "audio/aac" to "aac",
        "application/pdf" to "pdf",
        "image/png" to "png",
        "image/jpeg" to "jpg",
        "image/gif" to "gif",
        "image/webp" to "webp",
        "image/heic" to "heic",
        "text/plain" to "txt",
        "application/json" to "json",
        "application/zip" to "zip",
    )

    fun extensionOf(filename: String): String {
        val base = filename.substringAfterLast('/').substringAfterLast('\\')
        val i = base.lastIndexOf('.')
        if (i <= 0 || i == base.lastIndex) return ""
        return base.substring(i + 1).lowercase()
    }

    fun mimeFromFilename(filename: String): String? {
        val ext = extensionOf(filename)
        return if (ext.isEmpty()) null else extToMime[ext]
    }

    fun extensionFromMime(mime: String): String? {
        val key = mime.lowercase().substringBefore(';').trim()
        if (key.isEmpty() || key == "application/octet-stream") return null
        return mimeToExt[key]
    }

    fun resolveMime(filename: String, mimeHint: String?): String {
        val hint = mimeHint?.trim()?.lowercase().orEmpty()
        if (hint.isNotEmpty() && hint != "application/octet-stream") {
            return hint.substringBefore(';').trim()
        }
        return mimeFromFilename(filename) ?: "application/octet-stream"
    }

    fun ensureFilenameExtension(filename: String, mime: String): String {
        val base = filename.substringAfterLast('/').substringAfterLast('\\').trim().ifEmpty { "file" }
        if (extensionOf(base).isNotEmpty()) return base
        val ext = extensionFromMime(mime) ?: return base
        return "$base.$ext"
    }
}
