package com.goldmann.lightbeam.decode

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume
import kotlin.math.max
import kotlin.math.min

/**
 * Universal-ish video frame scanner:
 * 1) MediaExtractor + MediaCodec (primary)
 * 2) MediaMetadataRetriever fallback
 *
 * Adaptive sampling: ~10 Hz until first LBOP-looking QR, then denser.
 * Upscales frames with short side < 720 before ML Kit.
 */
class VideoFrameDecoder(private val context: Context) {
    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build(),
    )

    suspend fun scanVideo(
        uri: Uri,
        onProgress: (framesScanned: Int, qrHits: Int) -> Unit,
        onQr: suspend (String) -> Boolean,
    ): VideoDecodeReport = withContext(Dispatchers.IO) {
        try {
            scanWithMediaCodec(uri, onProgress, onQr)
        } catch (primary: Exception) {
            try {
                scanWithRetriever(uri, onProgress, onQr)
            } catch (fallback: Exception) {
                VideoDecodeReport(
                    outcome = VideoDecodeOutcome.UnsupportedFormat,
                    message = "This device cannot decode that codec (${primary.message}). " +
                        "Re-export as H.264 MP4 from the encoder.",
                    mime = primary.message,
                )
            }
        }
    }

    private suspend fun scanWithMediaCodec(
        uri: Uri,
        onProgress: (Int, Int) -> Unit,
        onQr: suspend (String) -> Boolean,
    ): VideoDecodeReport {
        val extractor = MediaExtractor()
        extractor.setDataSource(context, uri, null)
        val trackIndex = (0 until extractor.trackCount).firstOrNull { i ->
            extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
        } ?: run {
            extractor.release()
            throw IllegalStateException("no video track")
        }
        extractor.selectTrack(trackIndex)
        val format = extractor.getTrackFormat(trackIndex)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: "video/*"
        val width = format.getInteger(MediaFormat.KEY_WIDTH)
        val height = format.getInteger(MediaFormat.KEY_HEIGHT)
        val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) {
            format.getLong(MediaFormat.KEY_DURATION)
        } else {
            0L
        }

        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()

        var framesScanned = 0
        var qrHits = 0
        var lbopUseful = 0
        var sawQr = false
        var sawLbop = false
        var completed = false

        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        var nextSampleUs = 0L
        var sampleIntervalUs = 100_000L // 10 Hz initially

        try {
            while (!outputDone && !completed) {
                if (!inputDone) {
                    val inIndex = codec.dequeueInputBuffer(10_000)
                    if (inIndex >= 0) {
                        val buf = codec.getInputBuffer(inIndex)!!
                        val sampleSize = extractor.readSampleData(buf, 0)
                        if (sampleSize < 0) {
                            codec.queueInputBuffer(
                                inIndex,
                                0,
                                0,
                                0,
                                MediaCodec.BUFFER_FLAG_END_OF_STREAM,
                            )
                            inputDone = true
                        } else {
                            val pts = extractor.sampleTime
                            codec.queueInputBuffer(inIndex, 0, sampleSize, pts, 0)
                            extractor.advance()
                        }
                    }
                }

                val outIndex = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    outIndex >= 0 -> {
                        val pts = info.presentationTimeUs
                        val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                        if (pts >= nextSampleUs && info.size > 0) {
                            val image = codec.getOutputImage(outIndex)
                            if (image != null) {
                                val bitmap = imageToBitmap(image)?.let { maybeUpscale(it) }
                                image.close()
                                if (bitmap != null) {
                                    framesScanned++
                                    val text = scanBitmap(bitmap)
                                    bitmap.recycle()
                                    if (text != null) {
                                        qrHits++
                                        sawQr = true
                                        sampleIntervalUs = 33_000L // denser after first QR
                                        if (looksLikeLbop(text)) {
                                            sawLbop = true
                                            if (onQr(text)) {
                                                lbopUseful++
                                                // Caller returns true on accept/complete; denser already set.
                                                // Stop after useful ingest when session finished (checked by idle).
                                            }
                                        }
                                    }
                                    onProgress(framesScanned, qrHits)
                                    nextSampleUs = pts + sampleIntervalUs
                                }
                            }
                        }
                        codec.releaseOutputBuffer(outIndex, false)
                        if (eos) outputDone = true
                    }
                    outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> Unit
                }

                // Early stop: 8s of content scanned with no QR
                if (!sawQr && durationUs > 0 && nextSampleUs > 8_000_000L) {
                    break
                }
            }
        } finally {
            try {
                codec.stop()
            } catch (_: Exception) {
            }
            codec.release()
            extractor.release()
        }

        return finalizeReport(mime, width, height, framesScanned, qrHits, lbopUseful, sawQr, sawLbop)
    }

    private suspend fun scanWithRetriever(
        uri: Uri,
        onProgress: (Int, Int) -> Unit,
        onQr: suspend (String) -> Boolean,
    ): VideoDecodeReport {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, uri)
            val durationMs =
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
                    ?: 0L
            val width =
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
                    ?: 0
            val height =
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
                    ?: 0
            val mime = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)

            var framesScanned = 0
            var qrHits = 0
            var lbopUseful = 0
            var sawQr = false
            var sawLbop = false
            var stepMs = 100L
            var t = 0L

            while (t <= durationMs) {
                val bitmap = retriever.getFrameAtTime(
                    t * 1000,
                    MediaMetadataRetriever.OPTION_CLOSEST,
                )?.let { maybeUpscale(it) }
                if (bitmap != null) {
                    framesScanned++
                    val text = scanBitmap(bitmap)
                    bitmap.recycle()
                    if (text != null) {
                        qrHits++
                        sawQr = true
                        stepMs = 33L
                        if (looksLikeLbop(text)) {
                            sawLbop = true
                            if (onQr(text)) lbopUseful++
                        }
                    }
                    onProgress(framesScanned, qrHits)
                }
                t += stepMs
                if (!sawQr && t > 8_000L) break
            }

            return finalizeReport(mime, width, height, framesScanned, qrHits, lbopUseful, sawQr, sawLbop)
        } finally {
            retriever.release()
        }
    }

    private fun finalizeReport(
        mime: String?,
        width: Int,
        height: Int,
        framesScanned: Int,
        qrHits: Int,
        lbopUseful: Int,
        sawQr: Boolean,
        sawLbop: Boolean,
    ): VideoDecodeReport {
        val outcome = when {
            !sawQr -> VideoDecodeOutcome.NoOpticalSignal
            !sawLbop -> VideoDecodeOutcome.NoOpticalSignal
            lbopUseful == 0 -> VideoDecodeOutcome.Incomplete
            else -> VideoDecodeOutcome.Incomplete // ViewModel upgrades to Verified on session complete
        }
        val message = when (outcome) {
            VideoDecodeOutcome.NoOpticalSignal ->
                "Video opened, but no LightBeam codes were found."
            else ->
                "Found optical codes; continue or use a longer recording if incomplete."
        }
        return VideoDecodeReport(
            outcome = outcome,
            message = message,
            mime = mime,
            width = width,
            height = height,
            framesScanned = framesScanned,
            qrHits = qrHits,
            lbopUseful = lbopUseful,
        )
    }

    private fun maybeUpscale(src: Bitmap): Bitmap {
        val shortSide = min(src.width, src.height)
        if (shortSide >= 720) return src
        val scale = 720f / shortSide
        val w = max(1, (src.width * scale).toInt())
        val h = max(1, (src.height * scale).toInt())
        val scaled = Bitmap.createScaledBitmap(src, w, h, true)
        if (scaled !== src) src.recycle()
        return scaled
    }

    private fun looksLikeLbop(text: String): Boolean {
        return try {
            val decoded = android.util.Base64.decode(text.trim(), android.util.Base64.DEFAULT)
            decoded.size >= 4 &&
                decoded[0] == 'L'.code.toByte() &&
                decoded[1] == 'B'.code.toByte() &&
                decoded[2] == 'O'.code.toByte() &&
                decoded[3] == 'P'.code.toByte()
        } catch (_: Exception) {
            false
        }
    }

    suspend fun scanBitmap(bitmap: Bitmap): String? = suspendCancellableCoroutine { cont ->
        val image = InputImage.fromBitmap(bitmap, 0)
        scanner.process(image)
            .addOnSuccessListener { barcodes ->
                // Prefer largest QR by bounding box area
                val best = barcodes.maxByOrNull { b ->
                    val box = b.boundingBox
                    if (box != null) box.width() * box.height() else 0
                }
                cont.resume(best?.rawValue)
            }
            .addOnFailureListener { cont.resume(null) }
    }

    private fun imageToBitmap(image: Image): Bitmap? {
        return try {
            when (image.format) {
                ImageFormat.YUV_420_888 -> yuv420ToBitmap(image)
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun yuv420ToBitmap(image: Image): Bitmap? {
        val yBuffer = image.planes[0].buffer
        val uBuffer = image.planes[1].buffer
        val vBuffer = image.planes[2].buffer
        val ySize = yBuffer.remaining()
        val uSize = uBuffer.remaining()
        val vSize = vBuffer.remaining()
        val nv21 = ByteArray(ySize + uSize + vSize)
        yBuffer.get(nv21, 0, ySize)
        // NV21 = Y + V + U interleaved roughly; for compressToJpeg use NV21 layout
        val chromaRowStride = image.planes[2].rowStride
        val chromaPixelStride = image.planes[2].pixelStride
        var offset = ySize
        if (chromaPixelStride == 2) {
            // Interleaved VU
            val v = ByteArray(vSize)
            val u = ByteArray(uSize)
            vBuffer.get(v)
            uBuffer.get(u)
            var i = 0
            while (i < vSize && offset < nv21.size - 1) {
                nv21[offset++] = v[i]
                nv21[offset++] = u[i]
                i += chromaPixelStride
            }
        } else {
            vBuffer.get(nv21, ySize, vSize)
            uBuffer.get(nv21, ySize + vSize, uSize)
        }
        val yuv = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
        val out = ByteArrayOutputStream()
        yuv.compressToJpeg(Rect(0, 0, image.width, image.height), 90, out)
        val bytes = out.toByteArray()
        return android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }
}
