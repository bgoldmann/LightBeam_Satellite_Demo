package com.goldmann.lightbeam.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class RecoveredFileEntry(
    val id: String,
    val filename: String,
    val sizeBytes: Long,
    val payloadHash: String,
    val savedAtMillis: Long,
    val internalPath: String,
)

class RecoveredFileStore(context: Context) {
    private val appContext = context.applicationContext
    private val indexFile = File(appContext.filesDir, "recovered/index.json")
    private val recoveredDir = File(appContext.filesDir, "recovered/files").apply { mkdirs() }

    fun list(): List<RecoveredFileEntry> {
        if (!indexFile.exists()) return emptyList()
        val arr = JSONArray(indexFile.readText())
        return buildList {
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                add(
                    RecoveredFileEntry(
                        id = obj.getString("id"),
                        filename = obj.getString("filename"),
                        sizeBytes = obj.getLong("sizeBytes"),
                        payloadHash = obj.getString("payloadHash"),
                        savedAtMillis = obj.getLong("savedAtMillis"),
                        internalPath = obj.getString("internalPath"),
                    ),
                )
            }
        }.sortedByDescending { it.savedAtMillis }
    }

    fun saveInternal(filename: String, bytes: ByteArray, payloadHash: String): RecoveredFileEntry {
        val id = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val mime = com.goldmann.lightbeam.protocol.MediaTypes.resolveMime(filename, null)
        val displayName = com.goldmann.lightbeam.protocol.MediaTypes.ensureFilenameExtension(filename, mime)
        val safeName = displayName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val file = File(recoveredDir, "${id}_$safeName")
        file.writeBytes(bytes)
        val entry = RecoveredFileEntry(
            id = id,
            filename = displayName,
            sizeBytes = bytes.size.toLong(),
            payloadHash = payloadHash,
            savedAtMillis = System.currentTimeMillis(),
            internalPath = file.absolutePath,
        )
        val existing = list().toMutableList()
        existing.add(0, entry)
        persist(existing)
        return entry
    }

    fun readBytes(entry: RecoveredFileEntry): ByteArray = File(entry.internalPath).readBytes()

    private fun persist(entries: List<RecoveredFileEntry>) {
        indexFile.parentFile?.mkdirs()
        val arr = JSONArray()
        entries.forEach { e ->
            arr.put(
                JSONObject()
                    .put("id", e.id)
                    .put("filename", e.filename)
                    .put("sizeBytes", e.sizeBytes)
                    .put("payloadHash", e.payloadHash)
                    .put("savedAtMillis", e.savedAtMillis)
                    .put("internalPath", e.internalPath),
            )
        }
        indexFile.writeText(arr.toString())
    }
}
