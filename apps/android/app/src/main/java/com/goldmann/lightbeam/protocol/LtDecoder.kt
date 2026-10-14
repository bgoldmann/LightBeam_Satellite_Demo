package com.goldmann.lightbeam.protocol

import kotlin.math.ceil

const val DEFAULT_BLOCK_SIZE = 512

data class LtSymbol(
    val id: Int,
    val degree: Int,
    val neighbors: IntArray,
    val payload: ByteArray,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is LtSymbol) return false
        return id == other.id &&
            degree == other.degree &&
            neighbors.contentEquals(other.neighbors) &&
            payload.contentEquals(other.payload)
    }

    override fun hashCode(): Int {
        var result = id
        result = 31 * result + degree
        result = 31 * result + neighbors.contentHashCode()
        result = 31 * result + payload.contentHashCode()
        return result
    }
}

/** Hash-mixed neighbor selection (fallback when wire omits neighbors). Matches web/iOS. */
fun neighborsFromSeed(seed: Int, k: Int, degree: Int): IntArray {
    fun mix32(a: Int, b: Int): Int {
        var h = (a xor b) * -0x7a143595 // 0x85ebca6b
        h = h xor (h ushr 13)
        h *= -0x3d4d51cb // 0xc2b2ae35
        h = h xor (h ushr 16)
        return h
    }
    val want = minOf(degree, k)
    val chosen = linkedSetOf<Int>()
    var attempt = 0
    while (chosen.size < want && attempt < k * 32) {
        // Match web/iOS: unsigned modulo without ushr 1.
        val h = mix32(seed xor ((attempt + 1) * -0x61c88647), k) // 0x9e3779b9
        val idx = ((h.toLong() and 0xFFFFFFFFL) % k.toLong()).toInt()
        chosen.add(idx)
        attempt++
    }
    var i = 0
    while (chosen.size < want && i < k) {
        chosen.add(i++)
    }
    return chosen.sorted().toIntArray()
}

/**
 * O(edges) queue-based LT peel decoder.
 */
class LtDecoder(
    val k: Int,
    val blockSize: Int,
    originalLen: Int,
) {
    /** Truncation length for reconstruct() — must be encoded (post-compression) size. */
    var originalLen: Int = originalLen
        private set

    fun setFountainPayloadLength(len: Int) {
        if (len > 0) originalLen = len
    }
    private val blocks: Array<ByteArray?> = arrayOfNulls(k)
    private val pending = mutableListOf<PendingSymbol>()
    private val blockToPending: Array<MutableList<Int>> = Array(k) { mutableListOf() }
    private val peelQueue = ArrayDeque<Int>()
    private val seenIds = mutableSetOf<Int>()
    var resolvedCount: Int = 0
        private set

    private data class PendingSymbol(
        var neighbors: MutableList<Int>,
        val payload: ByteArray,
        var alive: Boolean = true,
    )

    val usefulCount: Int get() = seenIds.size
    val isComplete: Boolean get() = resolvedCount == k
    val estimatedNeed: Int get() = ceil(k * 1.25).toInt()

    fun ingest(symbol: LtSymbol): IngestResult {
        if (!seenIds.add(symbol.id)) return IngestResult.Duplicate
        val neigh = if (symbol.neighbors.isNotEmpty()) {
            symbol.neighbors.toMutableList()
        } else {
            neighborsFromSeed(symbol.id, k, symbol.degree).toMutableList()
        }
        if (neigh.isEmpty() || symbol.payload.size != blockSize) {
            return IngestResult.SeenUseless
        }

        val remaining = mutableListOf<Int>()
        val payload = symbol.payload.copyOf()
        for (idx in neigh) {
            if (idx !in 0 until k) continue
            val known = blocks[idx]
            if (known != null) xorInPlace(payload, known)
            else remaining.add(idx)
        }
        if (remaining.isEmpty()) return IngestResult.Accepted

        val pendingIdx = pending.size
        pending.add(PendingSymbol(remaining, payload))
        for (idx in remaining) blockToPending[idx].add(pendingIdx)
        if (remaining.size == 1) peelQueue.addLast(pendingIdx)
        peel()
        return IngestResult.Accepted
    }

    private fun peel() {
        while (peelQueue.isNotEmpty()) {
            val pendingIdx = peelQueue.removeLast()
            if (pendingIdx >= pending.size) continue
            val item = pending[pendingIdx]
            if (!item.alive) continue

            val remaining = mutableListOf<Int>()
            for (idx in item.neighbors) {
                val known = blocks[idx]
                if (known != null) xorInPlace(item.payload, known)
                else remaining.add(idx)
            }
            item.neighbors = remaining

            when {
                remaining.size == 1 -> {
                    val blockIdx = remaining[0]
                    if (blocks[blockIdx] == null) {
                        blocks[blockIdx] = item.payload.copyOf()
                        resolvedCount++
                        item.alive = false
                        for (otherIdx in blockToPending[blockIdx]) {
                            if (otherIdx == pendingIdx || otherIdx >= pending.size) continue
                            val other = pending[otherIdx]
                            if (!other.alive) continue
                            val pos = other.neighbors.indexOf(blockIdx)
                            if (pos < 0) continue
                            xorInPlace(other.payload, item.payload)
                            other.neighbors.removeAt(pos)
                            when {
                                other.neighbors.size == 1 -> peelQueue.addLast(otherIdx)
                                other.neighbors.isEmpty() -> other.alive = false
                            }
                        }
                    } else {
                        item.alive = false
                    }
                }
                remaining.isEmpty() -> item.alive = false
            }
        }
    }

    fun reconstruct(): ByteArray {
        if (!isComplete) throw ProtocolException("incomplete reconstruction")
        val out = ByteArray(k * blockSize)
        for (i in 0 until k) {
            val block = blocks[i] ?: throw ProtocolException("missing block $i")
            System.arraycopy(block, 0, out, i * blockSize, blockSize)
        }
        return out.copyOf(originalLen)
    }

    private fun xorInPlace(dst: ByteArray, src: ByteArray) {
        for (i in dst.indices) dst[i] = (dst[i].toInt() xor src[i].toInt()).toByte()
    }
}

enum class IngestResult {
    Accepted,
    Duplicate,
    SeenUseless,
}
