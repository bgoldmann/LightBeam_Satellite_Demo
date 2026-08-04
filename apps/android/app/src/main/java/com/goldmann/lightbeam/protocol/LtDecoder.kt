package com.goldmann.lightbeam.protocol

import kotlin.math.ceil
import kotlin.math.ln
import kotlin.math.sqrt

const val DEFAULT_BLOCK_SIZE = 512

private const val RS_C = 0.1
private const val RS_DELTA = 0.05

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

private class SeededRng(seed: Long) {
    private var state: Long = if (seed == 0L) -7046029254386353131L else seed

    fun nextU64(): Long {
        var x = state
        x = x xor (x shl 13)
        x = x xor (x ushr 7)
        x = x xor (x shl 17)
        state = x and 0xFFFFFFFFFFFFFFFL
        return state
    }

    fun nextFloat(): Double = (nextU64() and 0xFFFFFFL).toDouble() / 16777216.0

    fun nextRange(max: Int): Int = (nextU64() % max.toLong()).toInt()
}

private fun idealSoliton(k: Int, d: Int): Double {
    if (d == 0 || d > k) return 0.0
    if (d == 1) return 1.0 / k
    return 1.0 / (d.toDouble() * (d - 1))
}

private fun robustSolitonTau(k: Int, d: Int): Double {
    val s = RS_C * ln(k.toDouble()) * sqrt(k.toDouble()) / RS_DELTA
    val r = ceil(s / k).toInt()
    if (r == 0) return 0.0
    return when {
        d in 1 until r -> s / (d * k)
        d == r -> s * ln(s / RS_DELTA) / k
        else -> 0.0
    }
}

private fun robustSolitonCdf(k: Int): DoubleArray {
    val masses = DoubleArray(k + 1)
    var sum = 0.0
    for (d in 1..k) {
        masses[d] = idealSoliton(k, d) + robustSolitonTau(k, d)
        sum += masses[d]
    }
    val cdf = DoubleArray(k + 1)
    var acc = 0.0
    for (d in 1..k) {
        acc += masses[d] / sum
        cdf[d] = acc
    }
    cdf[k] = 1.0
    return cdf
}

private fun sampleDegree(cdf: DoubleArray, u: Double): Int {
    for (d in 1 until cdf.size) {
        if (u <= cdf[d]) return d
    }
    return cdf.size - 1
}

/** Hash-mixed neighbor selection (fallback when wire omits neighbors). */
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
        val h = mix32(seed xor ((attempt + 1) * -0x61c88647), k) // 0x9e3779b9
        chosen.add(((h ushr 1) % k + k) % k)
        attempt++
    }
    var i = 0
    while (chosen.size < want && i < k) {
        chosen.add(i++)
    }
    return chosen.sorted().toIntArray()
}

class LtDecoder(
    val k: Int,
    val blockSize: Int,
    val originalLen: Int,
) {
    private val blocks: Array<ByteArray?> = arrayOfNulls(k)
    private val pending = mutableListOf<PendingSymbol>()
    private val seenIds = mutableSetOf<Int>()

    private data class PendingSymbol(
        val neighbors: MutableList<Int>,
        val payload: ByteArray,
    )

    val usefulCount: Int get() = seenIds.size
    val resolvedCount: Int get() = blocks.count { it != null }
    val isComplete: Boolean get() = resolvedCount == k
    val estimatedNeed: Int get() = ceil(k * 1.15).toInt()

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
        pending.add(PendingSymbol(neigh, symbol.payload.copyOf()))
        peel()
        return IngestResult.Accepted
    }

    private fun peel() {
        var progressed = true
        while (progressed) {
            progressed = false
            var i = 0
            while (i < pending.size) {
                val item = pending[i]
                var j = 0
                while (j < item.neighbors.size) {
                    val idx = item.neighbors[j]
                    val known = blocks[idx]
                    if (known != null) {
                        xorInPlace(item.payload, known)
                        item.neighbors.removeAt(j)
                    } else {
                        j++
                    }
                }
                when {
                    item.neighbors.size == 1 -> {
                        val idx = item.neighbors[0]
                        if (blocks[idx] == null) {
                            blocks[idx] = item.payload.copyOf()
                            progressed = true
                        }
                        pending.removeAt(i)
                    }
                    item.neighbors.isEmpty() -> pending.removeAt(i)
                    else -> i++
                }
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
