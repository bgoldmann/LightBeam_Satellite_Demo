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
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class ScannerController(
    private val onQrDetected: (String) -> Unit,
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val processing = AtomicBoolean(false)
    private var camera: Camera? = null
    private var cameraProvider: ProcessCameraProvider? = null
    private var torchOn = false

    private val scanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
            .build(),
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
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            processing.set(false)
            imageProxy.close()
            return
        }
        val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
        scanner.process(image)
            .addOnSuccessListener { barcodes ->
                val best = barcodes.maxByOrNull { barcode ->
                    barcode.boundingBox?.let { it.width() * it.height() } ?: 0
                }
                best?.rawValue?.let(onQrDetected)
            }
            .addOnCompleteListener {
                processing.set(false)
                imageProxy.close()
            }
    }
}
