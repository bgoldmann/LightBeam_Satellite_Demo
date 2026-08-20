package com.goldmann.lightbeam.ui.screens

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import android.view.WindowManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.view.PreviewView
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.goldmann.lightbeam.R
import com.goldmann.lightbeam.camera.ScannerController
import com.goldmann.lightbeam.protocol.MediaTypes
import com.goldmann.lightbeam.protocol.SessionPhase
import com.goldmann.lightbeam.protocol.SessionSnapshot
import com.goldmann.lightbeam.protocol.TrustState
import com.goldmann.lightbeam.ui.SessionProgress

@Composable
fun ScannerScreen(
    snapshot: SessionSnapshot,
    onQr: (String) -> Unit,
    onReset: () -> Unit,
    onComplete: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var hasCamera by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED,
        )
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> hasCamera = granted }

    LaunchedEffect(Unit) {
        if (!hasCamera) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    DisposableEffect(Unit) {
        val activity = context as? Activity
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose {
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    LaunchedEffect(snapshot.phase) {
        if (snapshot.phase == SessionPhase.Complete) onComplete()
    }

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(onClick = onBack) { Text(stringResource(R.string.back)) }
            Button(onClick = onReset) { Text(stringResource(R.string.session_reset)) }
        }
        if (!hasCamera) {
            Column(
                Modifier
                    .fillMaxSize()
                    .padding(20.dp),
                verticalArrangement = Arrangement.Center,
            ) {
                Text(stringResource(R.string.camera_permission_required))
                Spacer(Modifier.height(12.dp))
                Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                    Text(stringResource(R.string.grant_camera))
                }
            }
            return
        }

        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            val previewView = remember { PreviewView(context) }
            val controller = remember { ScannerController(onQrDetected = onQr) }
            var torchOn by remember { mutableStateOf(false) }

            DisposableEffect(lifecycleOwner) {
                controller.bind(lifecycleOwner, previewView)
                onDispose { controller.unbind() }
            }

            AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())

            Box(
                Modifier
                    .align(Alignment.Center)
                    .fillMaxWidth(0.7f)
                    .height(280.dp)
                    .border(3.dp, Color(0xFF5EEAD4)),
            )

            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp),
            ) {
                Button(onClick = { torchOn = controller.toggleTorch() }) {
                    Text(if (torchOn) stringResource(R.string.torch_on) else stringResource(R.string.torch_off))
                }
            }
        }

        Column(Modifier.padding(16.dp)) {
            Text(stringResource(R.string.alignment_guide))
            Text(
                when (snapshot.phase) {
                    SessionPhase.Idle, SessionPhase.WaitingBeacon -> stringResource(R.string.waiting_beacon)
                    SessionPhase.WaitingManifest -> stringResource(R.string.waiting_manifest)
                    SessionPhase.Collecting -> stringResource(R.string.collecting_symbols)
                    SessionPhase.Complete -> stringResource(R.string.completion_title)
                    SessionPhase.Failed -> snapshot.statusMessage ?: "Failed"
                },
            )
            snapshot.shortCode?.let { Text(stringResource(R.string.short_code_label) + ": $it") }
            SessionProgress(
                useful = snapshot.usefulSymbols,
                need = snapshot.estimatedNeed,
                resolved = snapshot.resolvedBlocks,
                total = snapshot.blockCount,
                percent = snapshot.progressPercent,
            )
        }
    }
}

@Composable
fun DecodeVideoScreen(
    snapshot: SessionSnapshot,
    videoReport: com.goldmann.lightbeam.decode.VideoDecodeReport?,
    videoProgress: Pair<Int, Int>,
    isDecoding: Boolean,
    onPickVideo: (Uri) -> Unit,
    onReset: () -> Unit,
    onComplete: () -> Unit,
) {
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) onPickVideo(uri)
    }

    LaunchedEffect(snapshot.phase) {
        if (snapshot.phase == SessionPhase.Complete) onComplete()
    }

    Column(
        Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            stringResource(R.string.decode_video_tip),
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFF93A4BB),
        )
        Button(
            onClick = { picker.launch(arrayOf("video/*")) },
            modifier = Modifier.fillMaxWidth(),
            enabled = !isDecoding,
        ) {
            Text(stringResource(R.string.pick_video))
        }
        Button(onClick = onReset, modifier = Modifier.fillMaxWidth(), enabled = !isDecoding) {
            Text(stringResource(R.string.session_reset))
        }
        if (isDecoding) {
            Text(stringResource(R.string.decoding_video))
            Text(
                stringResource(
                    R.string.decode_progress,
                    videoProgress.first,
                    videoProgress.second,
                ),
            )
        }
        snapshot.shortCode?.let { Text(stringResource(R.string.short_code_label) + ": $it") }
        SessionProgress(
            useful = snapshot.usefulSymbols,
            need = snapshot.estimatedNeed,
            resolved = snapshot.resolvedBlocks,
            total = snapshot.blockCount,
            percent = snapshot.progressPercent,
        )
        videoReport?.let { report ->
            val color = when (report.outcome) {
                com.goldmann.lightbeam.decode.VideoDecodeOutcome.Verified -> Color(0xFF5EEAD4)
                com.goldmann.lightbeam.decode.VideoDecodeOutcome.NoOpticalSignal,
                com.goldmann.lightbeam.decode.VideoDecodeOutcome.UnsupportedFormat,
                -> Color(0xFFFBBF24)
                else -> Color(0xFFF87171)
            }
            Text(report.message, color = color)
        }
    }
}

@Composable
fun CompletionScreen(
    snapshot: SessionSnapshot,
    onSaveInternal: () -> Unit,
    onDone: () -> Unit,
) {
    val context = LocalContext.current
    val saveName = remember(snapshot.filename, snapshot.mimeType) {
        MediaTypes.ensureFilenameExtension(
            snapshot.filename ?: "file.bin",
            MediaTypes.resolveMime(snapshot.filename ?: "file.bin", snapshot.mimeType),
        )
    }
    val saveMime = remember(snapshot.filename, snapshot.mimeType) {
        MediaTypes.resolveMime(snapshot.filename ?: "file.bin", snapshot.mimeType)
    }
    val createDoc = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument(saveMime),
    ) { uri ->
        val bytes = snapshot.recoveredBytes
        if (uri != null && bytes != null) {
            context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
            onSaveInternal()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.completion_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.filename_label) + ": $saveName")
        snapshot.title?.let { Text(it) }
        snapshot.publisherName?.let { Text(stringResource(R.string.publisher_label) + ": $it") }
        Text(stringResource(R.string.mime_type_label) + ": $saveMime")
        snapshot.payloadHash?.let { Text(stringResource(R.string.payload_hash_label) + ": ${it.take(16)}…") }
        Text(
            if (snapshot.hashVerified == true) stringResource(R.string.hash_verified)
            else stringResource(R.string.hash_mismatch),
            color = if (snapshot.hashVerified == true) Color(0xFF5EEAD4) else Color(0xFFF87171),
        )
        snapshot.trustState?.let { trust ->
            val (label, color) = when (trust) {
                TrustState.Verified -> stringResource(R.string.trust_verified) to Color(0xFF5EEAD4)
                TrustState.UnknownPublisher -> stringResource(R.string.trust_unknown) to Color(0xFFFBBF24)
                TrustState.HashOnly -> stringResource(R.string.trust_hash_only) to Color(0xFF5EEAD4)
                TrustState.VerificationFailed -> stringResource(R.string.trust_failed) to Color(0xFFF87171)
            }
            Text(stringResource(R.string.trust_label) + ": $label", color = color)
        }
        Button(
            onClick = { createDoc.launch(saveName) },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(R.string.save_file))
        }
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.back))
        }
    }
}

@Composable
fun RecoveredFilesScreen(entries: List<com.goldmann.lightbeam.data.RecoveredFileEntry>) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(20.dp),
    ) {
        if (entries.isEmpty()) {
            Text(stringResource(R.string.no_recovered_files))
        } else {
            entries.forEach { entry ->
                Text(entry.filename, style = MaterialTheme.typography.titleMedium)
                Text("${entry.sizeBytes} bytes · ${entry.payloadHash.take(12)}…")
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}
