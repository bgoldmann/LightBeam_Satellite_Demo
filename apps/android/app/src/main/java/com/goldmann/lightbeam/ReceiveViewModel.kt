package com.goldmann.lightbeam

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.goldmann.lightbeam.camera.ScanFrameStats
import com.goldmann.lightbeam.data.RecoveredFileEntry
import com.goldmann.lightbeam.data.RecoveredFileStore
import com.goldmann.lightbeam.decode.VideoDecodeOutcome
import com.goldmann.lightbeam.decode.VideoDecodeReport
import com.goldmann.lightbeam.decode.VideoFrameDecoder
import com.goldmann.lightbeam.protocol.ReceiveSession
import com.goldmann.lightbeam.protocol.SessionPhase
import com.goldmann.lightbeam.protocol.SessionSnapshot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class ReceiveViewModel(
    private val recoveredFileStore: RecoveredFileStore,
    private val videoDecoderFactory: (android.content.Context) -> VideoFrameDecoder,
    private val appContext: android.content.Context,
) : ViewModel() {
    private val session = ReceiveSession()
    private val _snapshot = MutableStateFlow(session.snapshot())
    val snapshot: StateFlow<SessionSnapshot> = _snapshot.asStateFlow()

    private val _recoveredFiles = MutableStateFlow(recoveredFileStore.list())
    val recoveredFiles: StateFlow<List<RecoveredFileEntry>> = _recoveredFiles.asStateFlow()

    private val _toast = MutableStateFlow<String?>(null)
    val toast: StateFlow<String?> = _toast.asStateFlow()

    private val _videoReport = MutableStateFlow<VideoDecodeReport?>(null)
    val videoReport: StateFlow<VideoDecodeReport?> = _videoReport.asStateFlow()

    private val _videoProgress = MutableStateFlow(0 to 0)
    val videoProgress: StateFlow<Pair<Int, Int>> = _videoProgress.asStateFlow()

    private val _isDecodingVideo = MutableStateFlow(false)
    val isDecodingVideo: StateFlow<Boolean> = _isDecodingVideo.asStateFlow()

    private val _frameStats = MutableStateFlow(ScanFrameStats(0.0, 0))
    val frameStats: StateFlow<ScanFrameStats> = _frameStats.asStateFlow()

    private val ingestExecutor = Executors.newSingleThreadExecutor()
    private val publishPending = AtomicBoolean(false)
    private var lastPublishMs = 0L

    fun resetSession() {
        ingestExecutor.execute {
            session.reset()
            publishNow()
        }
        _videoReport.value = null
        _videoProgress.value = 0 to 0
    }

    fun onQrDetected(text: String): Boolean {
        return onQrPayload(text.toByteArray(Charsets.US_ASCII))
    }

    /** Called from camera analyzer threads — schedules ingest off-camera. */
    fun onQrPayloadAsync(data: ByteArray) {
        ingestExecutor.execute {
            ingestOnIngestThread(data)
        }
    }

    fun onFrameStats(stats: ScanFrameStats) {
        _frameStats.value = stats
    }

    fun onQrPayload(data: ByteArray): Boolean {
        // Synchronous path (video decode) — already off main.
        return ingestOnIngestThread(data)
    }

    private fun ingestOnIngestThread(data: ByteArray): Boolean {
        return when (val result = session.ingestQrPayload(data)) {
            is ReceiveSession.FrameResult.Accepted -> {
                schedulePublish()
                true
            }
            is ReceiveSession.FrameResult.Completed -> {
                publishNow()
                true
            }
            is ReceiveSession.FrameResult.Duplicate -> false
            is ReceiveSession.FrameResult.WrongSession -> {
                emitToast("wrong_session")
                false
            }
            is ReceiveSession.FrameResult.Corrupt -> {
                emitToast("corrupt")
                false
            }
        }
    }

    /** Throttle StateFlow publishes to ~10 Hz. */
    private fun schedulePublish() {
        val now = System.currentTimeMillis()
        if (now - lastPublishMs >= 100) {
            publishNow()
            return
        }
        if (publishPending.compareAndSet(false, true)) {
            val delay = 100 - (now - lastPublishMs)
            ingestExecutor.execute {
                try {
                    Thread.sleep(delay.coerceAtLeast(1))
                } catch (_: InterruptedException) {
                    return@execute
                }
                if (publishPending.getAndSet(false)) {
                    publishNow()
                }
            }
        }
    }

    private fun publishNow() {
        lastPublishMs = System.currentTimeMillis()
        publishPending.set(false)
        _snapshot.value = session.snapshot()
    }

    private fun publish() {
        publishNow()
    }

    fun decodeVideo(uri: Uri) {
        resetSession()
        _isDecodingVideo.value = true
        viewModelScope.launch {
            try {
                val decoder = videoDecoderFactory(appContext)
                val report = withContext(Dispatchers.IO) {
                    decoder.scanVideo(
                        uri = uri,
                        onProgress = { frames, qr ->
                            _videoProgress.value = frames to qr
                            publish()
                        },
                        onQr = { qr -> onQrPayload(qr) },
                    )
                }
                val snap = session.snapshot()
                val finalReport = when {
                    snap.phase == SessionPhase.Complete && snap.hashVerified == true ->
                        report.copy(
                            outcome = VideoDecodeOutcome.Verified,
                            message = "Recovered and verified.",
                        )
                    snap.phase == SessionPhase.Complete ->
                        report.copy(
                            outcome = VideoDecodeOutcome.HashFailed,
                            message = "Reconstructed but hash verification failed.",
                        )
                    report.outcome == VideoDecodeOutcome.Incomplete && snap.usefulSymbols > 0 ->
                        report.copy(
                            outcome = VideoDecodeOutcome.Incomplete,
                            message = appContext.getString(R.string.decode_incomplete_hint),
                        )
                    report.outcome == VideoDecodeOutcome.NoOpticalSignal ->
                        report.copy(message = appContext.getString(R.string.decode_no_signal))
                    report.outcome == VideoDecodeOutcome.UnsupportedFormat ->
                        report.copy(message = appContext.getString(R.string.decode_unsupported))
                    else -> report
                }
                _videoReport.value = finalReport
            } finally {
                _isDecodingVideo.value = false
                publish()
            }
        }
    }

    fun saveRecoveredInternal() {
        val snap = _snapshot.value
        val bytes = snap.recoveredBytes ?: return
        val filename = snap.filename ?: "file.bin"
        val hash = snap.payloadHash ?: ""
        recoveredFileStore.saveInternal(filename, bytes, hash)
        _recoveredFiles.value = recoveredFileStore.list()
    }

    fun refreshRecoveredFiles() {
        _recoveredFiles.value = recoveredFileStore.list()
    }

    fun clearToast() {
        _toast.value = null
    }

    private fun emitToast(key: String) {
        _toast.value = key
    }

    fun isComplete(): Boolean = _snapshot.value.phase == SessionPhase.Complete

    override fun onCleared() {
        ingestExecutor.shutdownNow()
        super.onCleared()
    }
}
