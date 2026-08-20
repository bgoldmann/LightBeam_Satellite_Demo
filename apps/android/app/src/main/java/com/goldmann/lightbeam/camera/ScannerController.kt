package com.goldmann.lightbeam.camera

import android.util.Size
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import zxingcpp.BarcodeReader
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class ScannerController(
    private val onQrPayload: (ByteArray) -> Unit,
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val processing = AtomicBoolean(false)
    private var camera: Camera? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var torchOn = false

    private val reader = BarcodeReader(
        BarcodeReader.Options(
            formats = setOf(BarcodeReader.Format.QR_CODE),
            tryHarder = true,
            tryRotate = false,
            tryInvert = true,
            tryDownscale = true,
            maxNumberOfSymbols = 8,
        ),
    )

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
            val preview = Preview.Builder().build().also {
                it.surfaceProvider = previewView.surfaceProvider
            }
            val analysis = ImageAnalysis.Builder()
                .setTargetResolution(Size(1920, 1080))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analysis.setAnalyzer(executor) { imageProxy ->
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

    private fun analyze(imageProxy: ImageProxy) {
        if (!processing.compareAndSet(false, true)) {
            imageProxy.close()
            return
        }
        try {
            val results = reader.read(imageProxy)
            for (result in results) {
                val bytes = result.bytes
                if (bytes != null && bytes.isNotEmpty()) {
                    onQrPayload(bytes)
                } else {
                    val text = result.text
                    if (!text.isNullOrEmpty()) {
                        onQrPayload(text.toByteArray(Charsets.US_ASCII))
                    }
                }
            }
        } catch (_: Exception) {
            /* drop frame */
        } finally {
            processing.set(false)
            imageProxy.close()
        }
    }
}
