package com.goldmann.lightbeam.protocol

import java.security.MessageDigest
import java.util.zip.Inflater

enum class SessionPhase {
    Idle,
    WaitingBeacon,
    WaitingManifest,
    Collecting,
    Complete,
    Failed,
}

data class SessionSnapshot(
    val phase: SessionPhase,
    val shortCode: String?,
    val title: String?,
    val publisherName: String?,
    val filename: String?,
    val mimeType: String?,
    val usefulSymbols: Int,
    val estimatedNeed: Int,
    val resolvedBlocks: Int,
    val blockCount: Int,
    val progressPercent: Int,
    val statusMessage: String?,
    val hashVerified: Boolean?,
    val payloadHash: String?,
    val recoveredBytes: ByteArray?,
    val trustState: TrustState?,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SessionSnapshot) return false
        return phase == other.phase &&
            shortCode == other.shortCode &&
            title == other.title &&
            publisherName == other.publisherName &&
            filename == other.filename &&
            mimeType == other.mimeType &&
            usefulSymbols == other.usefulSymbols &&
            estimatedNeed == other.estimatedNeed &&
            resolvedBlocks == other.resolvedBlocks &&
            blockCount == other.blockCount &&
            progressPercent == other.progressPercent &&
            statusMessage == other.statusMessage &&
            hashVerified == other.hashVerified &&
            payloadHash == other.payloadHash &&
            recoveredBytes.contentEquals(other.recoveredBytes) &&
            trustState == other.trustState
    }

    override fun hashCode(): Int {
        var result = phase.hashCode()
        result = 31 * result + (shortCode?.hashCode() ?: 0)
        result = 31 * result + (title?.hashCode() ?: 0)
        result = 31 * result + (publisherName?.hashCode() ?: 0)
        result = 31 * result + (filename?.hashCode() ?: 0)
        result = 31 * result + (mimeType?.hashCode() ?: 0)
        result = 31 * result + usefulSymbols
        result = 31 * result + estimatedNeed
        result = 31 * result + resolvedBlocks
        result = 31 * result + blockCount
        result = 31 * result + progressPercent
        result = 31 * result + (statusMessage?.hashCode() ?: 0)
        result = 31 * result + (hashVerified?.hashCode() ?: 0)
        result = 31 * result + (payloadHash?.hashCode() ?: 0)
        result = 31 * result + (recoveredBytes?.contentHashCode() ?: 0)
        result = 31 * result + (trustState?.hashCode() ?: 0)
        return result
    }
}

class ReceiveSession {
    private var lockedSessionId: ByteArray? = null
    private var beacon: BeaconPayload? = null
    private var manifest: ManifestInfo? = null
    private var decoder: LtDecoder? = null
    private var phase = SessionPhase.Idle
    private var statusMessage: String? = null
    private var hashVerified: Boolean? = null
    private var recoveredBytes: ByteArray? = null
    private var trustState: TrustState? = null

    fun reset() {
        lockedSessionId = null
        beacon = null
        manifest = null
        decoder = null
        phase = SessionPhase.Idle
        statusMessage = null
        hashVerified = null
        recoveredBytes = null
        trustState = null
    }

    fun snapshot(): SessionSnapshot {
        val dec = decoder
        val man = manifest
        val bec = beacon
        val blockCount = man?.blockCount ?: bec?.blockCount ?: 0
        val useful = dec?.usefulCount ?: 0
        val need = dec?.estimatedNeed ?: blockCount
        val resolved = dec?.resolvedCount ?: 0
        val progress = when {
            phase == SessionPhase.Complete -> 100
            blockCount == 0 -> 0
            else -> ((resolved.toDouble() / blockCount) * 100).toInt().coerceIn(0, 99)
        }
        return SessionSnapshot(
            phase = phase,
            shortCode = bec?.shortCode,
            title = man?.title ?: bec?.title,
            publisherName = man?.publisherName,
            filename = man?.filename,
            mimeType = man?.mimeType,
            usefulSymbols = useful,
            estimatedNeed = need,
            resolvedBlocks = resolved,
            blockCount = blockCount,
            progressPercent = progress,
            statusMessage = statusMessage,
            hashVerified = hashVerified,
            payloadHash = man?.payloadHash ?: bec?.payloadHash,
            recoveredBytes = recoveredBytes,
            trustState = trustState,
        )
    }

    sealed class FrameResult {
        data object Accepted : FrameResult()
        data object Duplicate : FrameResult()
        data object WrongSession : FrameResult()
        data class Corrupt(val reason: String) : FrameResult()
        data class Completed(val verified: Boolean) : FrameResult()
    }

    fun ingestQrText(qrText: String): FrameResult {
        val frame = try {
            LbopCodec.decodeQrPayload(qrText)
        } catch (e: Exception) {
            return FrameResult.Corrupt(e.message ?: "decode error")
        }
        return ingestFrame(frame)
    }

    fun ingestFrame(frame: LbopFrame): FrameResult {
        val locked = lockedSessionId
        if (locked != null && !locked.contentEquals(frame.sessionId)) {
            return FrameResult.WrongSession
        }

        return when (frame.frameType) {
            FrameType.Beacon -> ingestBeacon(frame)
            FrameType.Manifest -> ingestManifest(frame)
            FrameType.Data -> ingestData(frame)
            FrameType.EndLoop -> {
                tryComplete()
                FrameResult.Accepted
            }
        }
    }

    private fun ingestBeacon(frame: LbopFrame): FrameResult {
        val parsed = try {
            ManifestParser.parseBeaconJson(frame.payload)
        } catch (e: Exception) {
            return FrameResult.Corrupt("beacon parse: ${e.message}")
        }
        if (lockedSessionId == null) {
            lockedSessionId = frame.sessionId.copyOf()
        }
        beacon = parsed
        if (phase == SessionPhase.Idle || phase == SessionPhase.WaitingBeacon) {
            phase = SessionPhase.WaitingManifest
        }
        statusMessage = null
        return FrameResult.Accepted
    }

    private fun ingestManifest(frame: LbopFrame): FrameResult {
        if (lockedSessionId == null) lockedSessionId = frame.sessionId.copyOf()
        val parsed = try {
            ManifestParser.parseManifest(frame.payload)
        } catch (e: Exception) {
            return FrameResult.Corrupt("manifest parse: ${e.message}")
        }
        manifest = parsed
        val blockCount = parsed.blockCount
        val blockSize = parsed.blockSize
        val encodedLen = parsed.encodedByteLength.toInt()
        if (blockCount <= 0 || blockSize <= 0) {
            return FrameResult.Corrupt("invalid block parameters")
        }
        if (decoder == null) {
            decoder = LtDecoder(blockCount, blockSize, encodedLen)
        }
        phase = SessionPhase.Collecting
        statusMessage = null
        return FrameResult.Accepted
    }

    private fun ingestData(frame: LbopFrame): FrameResult {
        val dec = decoder ?: run {
            phase = SessionPhase.WaitingManifest
            return FrameResult.Corrupt("manifest not yet received")
        }
        val dataPayload = try {
            LbopCodec.decodeDataPayload(frame.payload)
        } catch (e: Exception) {
            return FrameResult.Corrupt("data payload: ${e.message}")
        }
        val symbol = LtSymbol(
            id = frame.symbolId.coerceIn(0L, Int.MAX_VALUE.toLong()).toInt(),
            degree = dataPayload.degree,
            neighbors = dataPayload.neighbors,
            payload = dataPayload.symbolBytes,
        )
        return when (dec.ingest(symbol)) {
            IngestResult.Duplicate -> FrameResult.Duplicate
            IngestResult.SeenUseless, IngestResult.Accepted -> {
                if (dec.isComplete) {
                    val completed = tryComplete()
                    FrameResult.Completed(completed)
                } else {
                    FrameResult.Accepted
                }
            }
        }
    }

    private fun tryComplete(): Boolean {
        val dec = decoder ?: return false
        if (!dec.isComplete) return false
        val man = manifest
        val bec = beacon
        val payloadHash = man?.payloadHash ?: bec?.payloadHash
        return try {
            val encodedBytes = dec.reconstruct()
            // payload_hash covers the encoded (possibly compressed) fountain payload
            val hash = sha256Hex(encodedBytes)
            val verified = payloadHash != null && hash.equals(payloadHash, ignoreCase = true)
            hashVerified = verified
            var recovered = when (man?.compression) {
                "deflate" -> inflateZlib(encodedBytes)
                "zstd" -> {
                    val expected = man.originalByteLength.toInt().coerceAtLeast(1)
                    com.github.luben.zstd.Zstd.decompress(encodedBytes, expected)
                }
                else -> encodedBytes
            }
            val expectedLen = man?.originalByteLength?.toInt()
            if (expectedLen != null && expectedLen >= 0 && recovered.size != expectedLen) {
                if (recovered.size > expectedLen) {
                    recovered = recovered.copyOf(expectedLen)
                } else {
                    throw ProtocolException(
                        "length mismatch after decode: ${recovered.size} vs $expectedLen",
                    )
                }
            }
            val trust = PublisherTrust.evaluate(
                man?.publisherKeyId,
                man?.signatureBase64,
                man?.unsignedFields ?: emptyMap(),
            )
            if (trust == TrustState.VerificationFailed) {
                phase = SessionPhase.Failed
                statusMessage = "Publisher signature verification failed"
                hashVerified = verified
                trustState = trust
                return false
            }
            recoveredBytes = recovered
            trustState = trust
            phase = SessionPhase.Complete
            statusMessage = if (verified) "hash_ok" else "hash_mismatch"
            verified
        } catch (e: Exception) {
            phase = SessionPhase.Failed
            statusMessage = e.message
            false
        }
    }

    /** Zlib-wrapped deflate — matches pako.deflate() from the web encoder. */
    private fun inflateZlib(data: ByteArray): ByteArray {
        val inflater = Inflater(false)
        return try {
            inflater.setInput(data)
            val buffer = ByteArray(maxOf(data.size * 4, 8192))
            val out = java.io.ByteArrayOutputStream(data.size * 2)
            while (!inflater.finished()) {
                val count = inflater.inflate(buffer)
                if (count == 0) {
                    if (inflater.needsInput()) break
                    if (inflater.needsDictionary()) {
                        throw ProtocolException("deflate stream needs dictionary")
                    }
                } else {
                    out.write(buffer, 0, count)
                }
            }
            if (!inflater.finished()) {
                throw ProtocolException("incomplete deflate stream")
            }
            out.toByteArray()
        } finally {
            inflater.end()
        }
    }

    companion object {
        fun sha256Hex(data: ByteArray): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(data)
            return digest.joinToString("") { "%02x".format(it) }
        }
    }
}
