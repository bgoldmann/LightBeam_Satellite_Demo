package com.goldmann.lightbeam

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.goldmann.lightbeam.ui.LightBeamScaffold
import com.goldmann.lightbeam.ui.navigation.Screen
import com.goldmann.lightbeam.ui.screens.AboutScreen
import com.goldmann.lightbeam.ui.screens.CompletionScreen
import com.goldmann.lightbeam.ui.screens.DecodeVideoScreen
import com.goldmann.lightbeam.ui.screens.HomeScreen
import com.goldmann.lightbeam.ui.screens.HowItWorksScreen
import com.goldmann.lightbeam.ui.screens.RecoveredFilesScreen
import com.goldmann.lightbeam.ui.screens.SafetyScreen
import com.goldmann.lightbeam.ui.screens.ScannerScreen
import com.goldmann.lightbeam.ui.screens.SettingsScreen
import com.goldmann.lightbeam.ui.theme.LightBeamTheme
import com.goldmann.lightbeam.decode.VideoFrameDecoder

class MainActivity : ComponentActivity() {
    private val viewModel: ReceiveViewModel by viewModels {
        ReceiveViewModelFactory(application as LightBeamApp)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            LightBeamTheme {
                val navController = rememberNavController()
                val snapshot by viewModel.snapshot.collectAsState()
                val recovered by viewModel.recoveredFiles.collectAsState()
                val demoNote = remember {
                    try {
                        assets.open("demo_note.txt").bufferedReader().use { it.readText() }
                    } catch (_: Exception) {
                        null
                    }
                }

                NavHost(navController = navController, startDestination = Screen.Home.route) {
                    composable(Screen.Home.route) {
                        HomeScreen(onNavigate = { screen ->
                            navController.navigate(screen.route)
                        })
                    }
                    composable(Screen.Scanner.route) {
                        ScannerScreen(
                            snapshot = snapshot,
                            onQr = { viewModel.onQrPayload(it) },
                            onReset = viewModel::resetSession,
                            onComplete = { navController.navigate(Screen.Completion.route) },
                            onBack = { navController.popBackStack() },
                        )
                    }
                    composable(Screen.DecodeVideo.route) {
                        val videoReport by viewModel.videoReport.collectAsState()
                        val videoProgress by viewModel.videoProgress.collectAsState()
                        val isDecoding by viewModel.isDecodingVideo.collectAsState()
                        LightBeamScaffold(
                            title = stringResource(R.string.decode_video),
                            onBack = { navController.popBackStack() },
                        ) { modifier ->
                            DecodeVideoScreen(
                                snapshot = snapshot,
                                videoReport = videoReport,
                                videoProgress = videoProgress,
                                isDecoding = isDecoding,
                                onPickVideo = viewModel::decodeVideo,
                                onReset = viewModel::resetSession,
                                onComplete = { navController.navigate(Screen.Completion.route) },
                            )
                        }
                    }
                    composable(Screen.Completion.route) {
                        LightBeamScaffold(
                            title = stringResource(R.string.completion_title),
                            onBack = { navController.popBackStack(Screen.Home.route, false) },
                        ) { _ ->
                            CompletionScreen(
                                snapshot = snapshot,
                                onSaveInternal = {
                                    viewModel.saveRecoveredInternal()
                                    navController.navigate(Screen.RecoveredFiles.route)
                                },
                                onDone = {
                                    viewModel.resetSession()
                                    navController.popBackStack(Screen.Home.route, false)
                                },
                            )
                        }
                    }
                    composable(Screen.RecoveredFiles.route) {
                        LightBeamScaffold(
                            title = stringResource(R.string.recovered_files),
                            onBack = {
                                viewModel.refreshRecoveredFiles()
                                navController.popBackStack()
                            },
                        ) { _ ->
                            RecoveredFilesScreen(recovered)
                        }
                    }
                    composable(Screen.HowItWorks.route) {
                        LightBeamScaffold(
                            title = stringResource(R.string.how_it_works),
                            onBack = { navController.popBackStack() },
                        ) { _ -> HowItWorksScreen() }
                    }
                    composable(Screen.Safety.route) {
                        LightBeamScaffold(
                            title = stringResource(R.string.safety_verification),
                            onBack = { navController.popBackStack() },
                        ) { _ -> SafetyScreen() }
                    }
                    composable(Screen.Settings.route) {
                        LightBeamScaffold(
                            title = stringResource(R.string.settings),
                            onBack = { navController.popBackStack() },
                        ) { _ ->
                            SettingsScreen(
                                onAbout = { navController.navigate(Screen.About.route) },
                                demoNote = demoNote,
                            )
                        }
                    }
                    composable(Screen.About.route) {
                        LightBeamScaffold(
                            title = stringResource(R.string.about),
                            onBack = { navController.popBackStack() },
                        ) { _ ->
                            AboutScreen(versionName = BuildConfig.VERSION_NAME)
                        }
                    }
                }
            }
        }
    }
}

class ReceiveViewModelFactory(
    private val app: LightBeamApp,
) : androidx.lifecycle.ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T {
        return ReceiveViewModel(
            recoveredFileStore = app.recoveredFileStore,
            videoDecoderFactory = { ctx -> VideoFrameDecoder(ctx) },
            appContext = app.applicationContext,
        ) as T
    }
}
