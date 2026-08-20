package com.goldmann.lightbeam.protocol

/** Deterministic CBOR (sorted string keys) matching web canonicalCbor.ts. */
object CanonicalCbor {
    fun encode(value: Any?): ByteArray {
        val out = ArrayList<Byte>()
        write(out, value)
        return out.toByteArray()
    }

    private fun write(out: MutableList<Byte>, value: Any?) {
        when (value) {
            null -> out.add(0xf6.toByte())
            is Boolean -> out.add(if (value) 0xf5.toByte() else 0xf4.toByte())
            is Number -> writeInt(out, value.toLong())
            is String -> {
                val bytes = value.toByteArray(Charsets.UTF_8)
                writeTypeLen(out, 3, bytes.size.toLong())
                bytes.forEach { out.add(it) }
            }
            is List<*> -> {
                writeTypeLen(out, 4, value.size.toLong())
                value.forEach { write(out, it) }
            }
            is Map<*, *> -> {
                val keys = value.keys.map { it.toString() }.sorted()
                writeTypeLen(out, 5, keys.size.toLong())
                for (k in keys) {
                    write(out, k)
                    write(out, value[k])
                }
            }
            else -> out.add(0xf6.toByte())
        }
    }

    private fun writeInt(out: MutableList<Byte>, n: Long) {
        if (n >= 0) writeTypeLen(out, 0, n)
        else writeTypeLen(out, 1, -1 - n)
    }

    private fun writeTypeLen(out: MutableList<Byte>, major: Int, len: Long) {
        val mt = (major shl 5) and 0xFF
        when {
            len < 24 -> out.add((mt or len.toInt()).toByte())
            len < 0x100 -> {
                out.add((mt or 24).toByte())
                out.add(len.toByte())
            }
            len < 0x10000 -> {
                out.add((mt or 25).toByte())
                out.add(((len shr 8) and 0xFF).toByte())
                out.add((len and 0xFF).toByte())
            }
            else -> {
                out.add((mt or 26).toByte())
                out.add(((len ushr 24) and 0xFF).toByte())
                out.add(((len ushr 16) and 0xFF).toByte())
                out.add(((len ushr 8) and 0xFF).toByte())
                out.add((len and 0xFF).toByte())
            }
        }
    }
}
