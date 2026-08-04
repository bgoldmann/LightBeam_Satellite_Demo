package com.goldmann.lightbeam.ui.navigation

sealed class Screen(val route: String) {
    data object Home : Screen("home")
    data object Scanner : Screen("scanner")
    data object Completion : Screen("completion")
    data object DecodeVideo : Screen("decode_video")
    data object RecoveredFiles : Screen("recovered_files")
    data object HowItWorks : Screen("how_it_works")
    data object Safety : Screen("safety")
    data object Settings : Screen("settings")
    data object About : Screen("about")
}
