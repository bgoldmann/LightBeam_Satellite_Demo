package com.goldmann.lightbeam.protocol

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.cbor.CBORFactory
import org.json.JSONObject

object ManifestParser {
    private val cborMapper = ObjectMapper(CBORFactory())

    fun parseBeaconJson(payload: ByteArray): BeaconPayload {
        val json = JSONObject(String(payload, Charsets.UTF_8))
        return BeaconPayload(
            title = json.optString("title", ""),
            profile = json.optString("profile", ""),
            blockCount = json.optInt("block_count", 0),
            blockSize = json.optInt("block_size", DEFAULT_BLOCK_SIZE),
            originalLen = json.optLong("original_len", 0),
            payloadHash = json.optString("payload_hash", ""),
            shortCode = json.optString("short_code", ""),
        )
    }

    fun parseManifest(payload: ByteArray): ManifestInfo {
        return try {
            parseManifestCbor(payload)
        } catch (_: Exception) {
            parseManifestJson(payload)
        }
    }

    private fun parseManifestCbor(payload: ByteArray): ManifestInfo {
        @Suppress("UNCHECKED_CAST")
        val map = cborMapper.readValue(payload, Map::class.java) as Map<String, Any?>
        return manifestFromMap(map)
    }

    private fun parseManifestJson(payload: ByteArray): ManifestInfo {
        val json = JSONObject(String(payload, Charsets.UTF_8))
        val map = json.keys().asSequence().associateWith { key ->
            json.get(key)
        }
        return manifestFromMap(map)
    }

    private fun manifestFromMap(map: Map<*, *>): ManifestInfo {
        fun num(name: String, default: Long = 0L): Long = when (val v = map[name]) {
            is Number -> v.toLong()
            is String -> v.toLongOrNull() ?: default
            else -> default
        }
        fun int(name: String, default: Int = 0): Int = num(name, default.toLong()).toInt()
        fun str(name: String, default: String = ""): String = when (val v = map[name]) {
            null -> default
            is ByteArray -> v.toString(Charsets.UTF_8)
            else -> v.toString()
        }

        val rawName = LbopCodec.sanitizeFilename(str("filename", "file.bin"))
        val rawMime = str("mime_type", "application/octet-stream").ifBlank { "application/octet-stream" }
        val mime = MediaTypes.resolveMime(rawName, rawMime)
        val filename = MediaTypes.ensureFilenameExtension(rawName, mime)
        val fields = LinkedHashMap<String, Any?>()
        for ((k, v) in map) {
            fields[k.toString()] = normalizeJson(v)
        }
        fields["signature"] = null
        return ManifestInfo(
            filename = filename,
            mimeType = mime,
            originalByteLength = num("original_byte_length"),
            encodedByteLength = num("encoded_byte_length"),
            payloadHash = str("payload_hash"),
            blockSize = int("block_size", DEFAULT_BLOCK_SIZE),
            blockCount = int("block_count"),
            publisherName = str("publisher_name"),
            title = str("title"),
            sessionIdHex = str("session_id"),
            compression = str("compression", "none"),
            publisherKeyId = str("publisher_key_id").ifBlank { null },
            signatureBase64 = str("signature").ifBlank { null },
            unsignedFields = fields,
        )
    }

    private fun normalizeJson(v: Any?): Any? = when (v) {
        null -> null
        is Number, is String, is Boolean -> v
        is ByteArray -> android.util.Base64.encodeToString(v, android.util.Base64.NO_WRAP)
        is Map<*, *> -> v.entries.associate { it.key.toString() to normalizeJson(it.value) }
        is List<*> -> v.map { normalizeJson(it) }
        else -> v.toString()
    }
}
