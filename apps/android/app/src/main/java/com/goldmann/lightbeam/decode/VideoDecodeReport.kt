package com.goldmann.lightbeam.decode

/**
 * Structured result for Decode Video — mirrors web DecodeReport outcomes.
 */
enum class VideoDecodeOutcome {
    Verified,
    NoOpticalSignal,
    UnsupportedFormat,
    Incomplete,
    HashFailed,
    Cancelled,
}

data class VideoDecodeReport(
    val outcome: VideoDecodeOutcome,
    val message: String,
    val mime: String? = null,
    val width: Int = 0,
    val height: Int = 0,
    val framesScanned: Int = 0,
    val qrHits: Int = 0,
    val lbopUseful: Int = 0,
)
