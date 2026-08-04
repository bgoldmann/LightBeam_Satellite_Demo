package com.goldmann.lightbeam.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val LbDark = darkColorScheme(
    primary = Color(0xFF38BDF8),
    secondary = Color(0xFF5EEAD4),
    background = Color(0xFF0B1220),
    surface = Color(0xFF1E293B),
    onPrimary = Color(0xFF0B1220),
    onSecondary = Color(0xFF0B1220),
    onBackground = Color(0xFFE8EEF7),
    onSurface = Color(0xFFE8EEF7),
)

private val LbTypography = Typography(
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
)

@Composable
fun LightBeamTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = LbDark,
        typography = LbTypography,
        content = content,
    )
}
