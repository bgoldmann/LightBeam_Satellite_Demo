package com.goldmann.lightbeam.protocol

/** CRC-32 (IEEE) matching Rust crc32fast and web encoder. */
object Crc32 {
    private val table: IntArray = IntArray(256) { i ->
        var c = i
        repeat(8) {
            c = if (c and 1 != 0) 0xEDB88320.toInt() xor (c ushr 1) else c ushr 1
        }
        c
    }

    fun compute(data: ByteArray, offset: Int = 0, length: Int = data.size): Int {
        var c = 0xFFFFFFFF.toInt()
        val end = offset + length
        for (i in offset until end) {
            c = table[(c xor data[i].toInt()) and 0xFF] xor (c ushr 8)
        }
        return c xor 0xFFFFFFFF.toInt()
    }

    fun compute(data: ByteArray): Int = compute(data, 0, data.size)
}
