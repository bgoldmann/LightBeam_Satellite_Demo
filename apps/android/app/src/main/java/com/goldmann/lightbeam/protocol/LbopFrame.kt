package com.goldmann.lightbeam.protocol

import java.nio.ByteBuffer
import java.nio.ByteOrder

const val LBOP_MAGIC = "LBOP"
const val PROTOCOL_VERSION: Byte = 1
const val HEADER_LEN = 38

enum class FrameType(val wire: Byte) {
    Beacon(0x01),
    Manifest(0x02),
    Data(0x03),
    EndLoop(0x04),
    ;

    companion object {
        fun fromWire(value: Byte): FrameType? = entries.find { it.wire == value }
    }
}

class ProtocolException(message: String) : Exception(message)

data class LbopFrame(
    val version: Byte,
    val frameType: FrameType,
    val flags: Int,
    val sessionId: ByteArray,
    val symbolId: Long,
    val payload: ByteArray,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is LbopFrame) return false
        return version == other.version &&
            frameType == other.frameType &&
            flags == other.flags &&
            sessionId.contentEquals(other.sessionId) &&
            symbolId == other.symbolId &&
            payload.contentEquals(other.payload)
    }

    override fun hashCode(): Int {
        var result = version.hashCode()
        result = 31 * result + frameType.hashCode()
        result = 31 * result + flags
        result = 31 * result + sessionId.contentHashCode()
        result = 31 * result + symbolId.hashCode()
        result = 31 * result + payload.contentHashCode()
        return result
    }
}

data class DataPayload(
    val degree: Int,
    val neighbors: IntArray,
    val symbolBytes: ByteArray,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is DataPayload) return false
        return degree == other.degree &&
            neighbors.contentEquals(other.neighbors) &&
            symbolBytes.contentEquals(other.symbolBytes)
    }

    override fun hashCode(): Int {
        var result = degree
        result = 31 * result + neighbors.contentHashCode()
        result = 31 * result + symbolBytes.contentHashCode()
        return result
    }
}

data class BeaconPayload(
    val title: String,
    val profile: String,
    val blockCount: Int,
    val blockSize: Int,
    val originalLen: Long,
    val payloadHash: String,
    val shortCode: String,
)

data class ManifestInfo(
    val filename: String,
    val mimeType: String,
    val originalByteLength: Long,
    val encodedByteLength: Long,
    val payloadHash: String,
    val blockSize: Int,
    val blockCount: Int,
    val publisherName: String,
    val title: String,
    val sessionIdHex: String,
    val compression: String,
    val publisherKeyId: String?,
    val signatureBase64: String?,
    val unsignedFields: Map<String, Any?>,
)

enum class TrustState {
    Verified,
    UnknownPublisher,
    VerificationFailed,
    HashOnly,
}

object LbopCodec {
    fun decodeFrame(data: ByteArray): LbopFrame {
        if (data.size < HEADER_LEN + 4) throw ProtocolException("truncated")
        if (data[0].toInt().toChar() != 'L' ||
            data[1].toInt().toChar() != 'B' ||
            data[2].toInt().toChar() != 'O' ||
            data[3].toInt().toChar() != 'P'
        ) {
            throw ProtocolException("invalid magic")
        }
        val version = data[4]
        if (version != PROTOCOL_VERSION) throw ProtocolException("unsupported version $version")
        val frameType = FrameType.fromWire(data[5]) ?: throw ProtocolException("unknown frame type")
        val flags = ((data[6].toInt() and 0xFF) shl 8) or (data[7].toInt() and 0xFF)
        val sessionId = data.copyOfRange(8, 24)
        val symbolId = readU64Be(data, 24)
        val plen = ((data[32].toInt() and 0xFF) shl 8) or (data[33].toInt() and 0xFF)
        val expectedHeaderCrc = readU32Be(data, 34)
        val headerWithoutCrc = data.copyOfRange(0, 34)
        if (Crc32.compute(headerWithoutCrc) != expectedHeaderCrc) throw ProtocolException("header crc")
        if (data.size < 38 + plen + 4) throw ProtocolException("truncated")
        val payload = data.copyOfRange(38, 38 + plen)
        val body = data.copyOfRange(0, 38 + plen)
        val expectedFrameCrc = readU32Be(data, 38 + plen)
        if (Crc32.compute(body) != expectedFrameCrc) throw ProtocolException("frame crc")
        return LbopFrame(version, frameType, flags, sessionId, symbolId, payload)
    }

    fun decodeDataPayload(data: ByteArray): DataPayload {
        if (data.size < 4) throw ProtocolException("truncated data payload")
        val degree = readU16Be(data, 0)
        val ncount = readU16Be(data, 2)
        val need = 4 + ncount * 2
        if (data.size < need) throw ProtocolException("truncated neighbors")
        val neighbors = IntArray(ncount) { i -> readU16Be(data, 4 + i * 2) }
        val symbolBytes = data.copyOfRange(need, data.size)
        return DataPayload(degree, neighbors, symbolBytes)
    }

    fun decodeQrPayload(qrText: String): LbopFrame {
        val trimmed = qrText.trim()
        val frameBytes = if (trimmed.startsWith("{")) {
            parseJsonFramePath(trimmed)
        } else {
            android.util.Base64.decode(trimmed, android.util.Base64.NO_WRAP)
        }
        return decodeFrame(frameBytes)
    }

    /** Simplified JSON-in-QR path for M0 interop testing. */
    private fun parseJsonFramePath(json: String): ByteArray {
        val obj = org.json.JSONObject(json)
        if (obj.has("frame_b64")) {
            return android.util.Base64.decode(obj.getString("frame_b64"), android.util.Base64.NO_WRAP)
        }
        throw ProtocolException("unsupported JSON QR format")
    }

    fun sessionShortCode(sessionId: ByteArray): String {
        val alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        var n = 0L
        for (i in 0 until 8) {
            n = (n shl 8) or (sessionId[i].toLong() and 0xFF)
        }
        val out = StringBuilder(8)
        repeat(8) {
            out.append(alpha[(n % 32).toInt()])
            n /= 32
        }
        return out.toString()
    }

    fun sessionIdHex(sessionId: ByteArray): String =
        sessionId.joinToString("") { "%02x".format(it) }

    fun sanitizeFilename(name: String): String {
        val base = name.substringAfterLast('/').substringAfterLast('\\').trim()
        val cleaned = base.map { c ->
            if (c.isISOControl() || c in "<>:\"|?*") '_' else c
        }.joinToString("")
        return when {
            cleaned.isEmpty() || cleaned == "." || cleaned == ".." -> "file.bin"
            else -> cleaned
        }
    }

    private fun readU16Be(data: ByteArray, offset: Int): Int =
        ((data[offset].toInt() and 0xFF) shl 8) or (data[offset + 1].toInt() and 0xFF)

    private fun readU32Be(data: ByteArray, offset: Int): Int =
        ((data[offset].toInt() and 0xFF) shl 24) or
            ((data[offset + 1].toInt() and 0xFF) shl 16) or
            ((data[offset + 2].toInt() and 0xFF) shl 8) or
            (data[offset + 3].toInt() and 0xFF)

    private fun readU64Be(data: ByteArray, offset: Int): Long {
        val buf = ByteBuffer.wrap(data, offset, 8).order(ByteOrder.BIG_ENDIAN)
        return buf.long
    }
}
