package com.goldmann.lightbeam.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.goldmann.lightbeam.R
import com.goldmann.lightbeam.ui.OfflineBanner
import com.goldmann.lightbeam.ui.navigation.Screen

@Composable
fun HomeScreen(
    onNavigate: (Screen) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.home_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.home_subtitle), color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f))
        OfflineBanner()
        Spacer(Modifier.height(8.dp))
        HomeTile(stringResource(R.string.scan_tv)) { onNavigate(Screen.Scanner) }
        HomeTile(stringResource(R.string.decode_video)) { onNavigate(Screen.DecodeVideo) }
        HomeTile(stringResource(R.string.recovered_files)) { onNavigate(Screen.RecoveredFiles) }
        HomeTile(stringResource(R.string.how_it_works)) { onNavigate(Screen.HowItWorks) }
        HomeTile(stringResource(R.string.safety_verification)) { onNavigate(Screen.Safety) }
        HomeTile(stringResource(R.string.settings)) { onNavigate(Screen.Settings) }
    }
}

@Composable
private fun HomeTile(title: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Text(
            text = title,
            modifier = Modifier.padding(16.dp),
            style = MaterialTheme.typography.titleMedium,
        )
    }
}

@Composable
fun InfoScreen(title: String, body: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        OfflineBanner()
        Spacer(Modifier.height(12.dp))
        Text(body, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
fun HowItWorksScreen() {
    InfoScreen(
        title = stringResource(R.string.how_it_works),
        body = stringResource(R.string.how_it_works_body),
    )
}

@Composable
fun SafetyScreen() {
    InfoScreen(
        title = stringResource(R.string.safety_verification),
        body = stringResource(R.string.safety_body),
    )
}

@Composable
fun SettingsScreen(onAbout: () -> Unit, demoNote: String?) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        OfflineBanner()
        Text(stringResource(R.string.settings_language))
        Text(stringResource(R.string.settings_wake_lock))
        Button(onClick = onAbout, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.about))
        }
        if (demoNote != null) {
            Text(stringResource(R.string.demo_note_title), style = MaterialTheme.typography.titleMedium)
            Text(demoNote, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
fun AboutScreen(versionName: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.about_version, versionName))
        Text(stringResource(R.string.about_signing_fingerprint))
        Text(stringResource(R.string.about_cbor_note), color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.75f))
        OfflineBanner()
    }
}
