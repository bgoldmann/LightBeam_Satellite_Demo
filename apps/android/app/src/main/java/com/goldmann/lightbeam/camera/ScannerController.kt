package com.goldmann.lightbeam.camera

import android.hardware.camera2.CaptureRequest
import android.util.Range
import android.util.Size
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import zxingcpp.BarcodeReader
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

@OptIn(ExperimentalCamera2Interop::class)

data class ScanFrameStats(
    val decodeMs: Double,
    val qrCount: Int,
)

class ScannerController(
    private val onQrPayload: (ByteArray) -> Unit,
    private val onFrameStats: ((ScanFrameStats) -> Unit)? = null,
) {
    private val analysisExecutor = Executors.newFixedThreadPool(2)
    private val processing = AtomicBoolean(false)
    private val readerIndex = AtomicInteger(0)
    private var camera: Camera? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var torchOn = false

    private fun makeReader() = BarcodeReader(
        BarcodeReader.Options(
            formats = setOf(BarcodeReader.Format.QR_CODE),
            tryHarder = true,
            tryRotate = false,
            tryInvert = false,
            tryDownscale = true,
            maxNumberOfSymbols = 8,
        ),
    )

    // One reader per analysis thread to avoid contention.
    private val readers = arrayOf(makeReader(), makeReader())

    fun bind(
        lifecycleOwner: LifecycleOwner,
        previewView: PreviewView,
        onBound: (Camera?) -> Unit = {},
    ) {
        val context = previewView.context
        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener({
            val provider = providerFuture.get()
            cameraProvider = provider
            provider.unbindAll()

            val resolutionSelector = ResolutionSelector.Builder()
                .setResolutionStrategy(
                    ResolutionStrategy(
                        Size(1920, 1080),
                        ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER,
                    ),
                )
                .build()

            val preview = Preview.Builder()
                .setResolutionSelector(resolutionSelector)
                .build()
                .also { it.surfaceProvider = previewView.surfaceProvider }

            val analysisBuilder = ImageAnalysis.Builder()
                .setResolutionSelector(resolutionSelector)
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)

            // Prefer 60 fps; cap AE exposure so consecutive QR ticks don't blend.
            try {
                Camera2Interop.Extender(analysisBuilder)
                    .setCaptureRequestOption(
                        CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE,
                        Range(30, 60),
                    )
                    .setCaptureRequestOption(
                        CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION,
                        -2,
                    )
            } catch (_: Exception) {
                /* Camera2 options optional */
            }

            val analysis = analysisBuilder.build()
            analysis.setAnalyzer(analysisExecutor) { imageProxy ->
                analyze(imageProxy)
            }
            try {
                camera = provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
                onBound(camera)
            } catch (_: Exception) {
                onBound(null)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    fun toggleTorch(): Boolean {
        val cam = camera ?: return torchOn
        if (!cam.cameraInfo.hasFlashUnit()) return torchOn
        torchOn = !torchOn
        cam.cameraControl.enableTorch(torchOn)
        return torchOn
    }

    fun unbind() {
        processing.set(false)
        torchOn = false
        camera = null
        cameraProvider?.unbindAll()
        cameraProvider = null
    }

    fun shutdown() {
        unbind()
        analysisExecutor.shutdownNow()
    }

    private fun analyze(imageProxy: ImageProxy) {
        if (!processing.compareAndSet(false, true)) {
            imageProxy.close()
            return
        }
        val reader = readers[readerIndex.getAndIncrement() and 1]
        try {
            val t0 = System.nanoTime()
            val results = reader.read(imageProxy)
            val decodeMs = (System.nanoTime() - t0) / 1_000_000.0
            var count = 0
            for (result in results) {
                val bytes = result.bytes
                if (bytes != null && bytes.isNotEmpty()) {
                    onQrPayload(bytes)
                    count++
                } else {
                    val text = result.text
                    if (!text.isNullOrEmpty()) {
                        onQrPayload(text.toByteArray(Charsets.US_ASCII))
                        count++
                    }
                }
            }
            onFrameStats?.invoke(ScanFrameStats(decodeMs, count))
        } catch (_: Exception) {
            /* drop frame */
        } finally {
            processing.set(false)
            imageProxy.close()
        }
    }
}
