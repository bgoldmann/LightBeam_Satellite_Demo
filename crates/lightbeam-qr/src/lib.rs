//! QR code helpers for LightBeam frame payloads.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::Luma;
use qrcode::{EcLevel, QrCode};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum QrError {
    #[error("QR encode failed: {0}")]
    Encode(String),
}

/// Encode binary payload as a base64 QR. Returns module matrix: true = dark.
pub fn encode_modules(data: &[u8], ecc: EcLevel) -> Result<Vec<Vec<bool>>, QrError> {
    let b64 = B64.encode(data);
    let code = QrCode::with_error_correction_level(b64.as_bytes(), ecc)
        .map_err(|e| QrError::Encode(e.to_string()))?;
    Ok(modules_from_code(&code))
}

/// Encode to PNG bytes (grayscale), scaled by `module_px`.
pub fn encode_png(data: &[u8], module_px: u32, ecc: EcLevel) -> Result<Vec<u8>, QrError> {
    let b64 = B64.encode(data);
    let code = QrCode::with_error_correction_level(b64.as_bytes(), ecc)
        .map_err(|e| QrError::Encode(e.to_string()))?;
    let img = code
        .render::<Luma<u8>>()
        .quiet_zone(true)
        .module_dimensions(module_px, module_px)
        .build();
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    image::DynamicImage::ImageLuma8(img)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|e| QrError::Encode(e.to_string()))?;
    Ok(buf)
}

/// Encode raw binary using QR byte mode directly.
pub fn encode_binary_modules(data: &[u8], ecc: EcLevel) -> Result<Vec<Vec<bool>>, QrError> {
    let code = QrCode::with_error_correction_level(data, ecc)
        .map_err(|e| QrError::Encode(e.to_string()))?;
    Ok(modules_from_code(&code))
}

fn modules_from_code(code: &QrCode) -> Vec<Vec<bool>> {
    let width = code.width();
    let mut rows = Vec::with_capacity(width);
    for y in 0..width {
        let mut row = Vec::with_capacity(width);
        for x in 0..width {
            row.push(code[(x, y)] == qrcode::Color::Dark);
        }
        rows.push(row);
    }
    rows
}

pub fn decode_base64_payload(s: &str) -> Result<Vec<u8>, QrError> {
    B64.decode(s.trim())
        .map_err(|e| QrError::Encode(e.to_string()))
}

/// Recommended ECC for satellite-safe profile: Medium.
pub fn satellite_ecc() -> EcLevel {
    EcLevel::M
}

/// Lab/high-speed: Low ECC (fountain handles erasures).
pub fn lab_ecc() -> EcLevel {
    EcLevel::L
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_png_nonempty() {
        let png = encode_png(b"LBOP test", 4, EcLevel::M).unwrap();
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn binary_modules_square() {
        let m = encode_binary_modules(b"hello", EcLevel::L).unwrap();
        assert!(!m.is_empty());
        assert_eq!(m.len(), m[0].len());
    }
}
