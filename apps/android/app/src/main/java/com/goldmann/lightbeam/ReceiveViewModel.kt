package com.goldmann.lightbeam

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.goldmann.lightbeam.data.RecoveredFileEntry
import com.goldmann.lightbeam.data.RecoveredFileStore
import com.goldmann.lightbeam.decode.VideoDecodeOutcome
import com.goldmann.lightbeam.decode.VideoDecodeReport
import com.goldmann.lightbeam.decode.VideoFrameDecoder
import com.goldmann.lightbeam.protocol.ReceiveSession
import com.goldmann.lightbeam.protocol.SessionPhase
import com.goldmann.lightbeam.protocol.SessionSnapshot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

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

    fun resetSession() {
        session.reset()
        _videoReport.value = null
        _videoProgress.value = 0 to 0
        publish()
    }

    fun onQrDetected(text: String): Boolean {
        return when (val result = session.ingestQrText(text)) {
            is ReceiveSession.FrameResult.Accepted -> {
                publish()
                true
            }
            is ReceiveSession.FrameResult.Completed -> {
                publish()
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

    fun decodeVideo(uri: Uri) {
        resetSession()
        _isDecodingVideo.value = true
        viewModelScope.launch {
            try {
                val decoder = videoDecoderFactory(appContext)
                val report = decoder.scanVideo(
                    uri = uri,
                    onProgress = { frames, qr ->
                        _videoProgress.value = frames to qr
                        publish()
                    },
                    onQr = { qr -> onQrDetected(qr) },
                )
                val finalReport = when {
                    session.snapshot().phase == SessionPhase.Complete &&
                        session.snapshot().hashVerified == true ->
                        report.copy(
                            outcome = VideoDecodeOutcome.Verified,
                            message = "Recovered and verified.",
                        )
                    session.snapshot().phase == SessionPhase.Complete ->
                        report.copy(
                            outcome = VideoDecodeOutcome.HashFailed,
                            message = "Reconstructed but hash verification failed.",
                        )
                    report.outcome == VideoDecodeOutcome.Incomplete &&
                        session.snapshot().usefulSymbols > 0 ->
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

    private fun publish() {
        _snapshot.value = session.snapshot()
    }

    private fun emitToast(key: String) {
        _toast.value = key
    }

    fun isComplete(): Boolean = _snapshot.value.phase == SessionPhase.Complete
}
