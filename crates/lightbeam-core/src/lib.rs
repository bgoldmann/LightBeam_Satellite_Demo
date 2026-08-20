//! LightBeam shared encode/decode session facade.

use std::collections::HashMap;
use std::io::{Read, Write};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use lightbeam_crypto::{
    generate_keypair, key_id, sign, verify, verifying_key_from_bytes, EncryptionParams,
};
use lightbeam_fec::{Decoder, Encoder, Symbol, DEFAULT_BLOCK_SIZE};
use lightbeam_protocol::{
    sanitize_filename, sha256_hex, BeaconPayload, CompressionAlg, DataPayload, EncryptionAlg,
    Frame, FrameType, Manifest, SessionId, PROTOCOL_VERSION,
};
use lightbeam_qr::{encode_binary_modules, encode_png, satellite_ecc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error(transparent)]
    Fec(#[from] lightbeam_fec::FecError),
    #[error(transparent)]
    Protocol(#[from] lightbeam_protocol::ProtocolError),
    #[error(transparent)]
    Crypto(#[from] lightbeam_crypto::CryptoError),
    #[error(transparent)]
    Qr(#[from] lightbeam_qr::QrError),
    #[error("compression failed")]
    Compression,
    #[error("session not ready")]
    NotReady,
    #[error("verification failed: {0}")]
    Verification(String),
    #[error("{0}")]
    Msg(String),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EncodeOptions {
    pub title: String,
    pub publisher_name: String,
    pub filename: String,
    pub mime_type: String,
    pub language: String,
    pub description: Option<String>,
    pub compress: bool,
    pub password: Option<String>,
    pub block_size: usize,
    pub profile: String,
    /// Demo signing seed (32 bytes hex) — production uses HSM/offline keys.
    pub signing_seed_hex: Option<String>,
}

impl Default for EncodeOptions {
    fn default() -> Self {
        Self {
            title: "LightBeam Transmission".into(),
            publisher_name: "Goldmann LLC Demo".into(),
            filename: "file.bin".into(),
            mime_type: "application/octet-stream".into(),
            language: "en".into(),
            description: None,
            compress: true,
            password: None,
            block_size: DEFAULT_BLOCK_SIZE,
            profile: "satellite_safe".into(),
            signing_seed_hex: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EncodeSessionInfo {
    pub session_id: String,
    pub short_code: String,
    pub package_id: String,
    pub payload_hash: String,
    pub original_len: u64,
    pub encoded_len: u64,
    pub block_count: u32,
    pub block_size: u32,
    pub manifest_json: String,
    pub publisher_key_id: String,
}

/// Prepared transmission ready to emit frames.
pub struct EncodeSession {
    pub info: EncodeSessionInfo,
    session_id: SessionId,
    encoder: Encoder,
    manifest_cbor: Vec<u8>,
    beacon_json: Vec<u8>,
    next_symbol: u32,
    beacon_interval: u32,
}

impl EncodeSession {
    pub fn create(file_bytes: &[u8], opts: EncodeOptions) -> Result<Self, CoreError> {
        let filename = sanitize_filename(&opts.filename);
        let mut payload = file_bytes.to_vec();
        let mut compression = CompressionAlg::None;
        if opts.compress {
            let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
            enc.write_all(file_bytes)
                .map_err(|_| CoreError::Compression)?;
            let compressed = enc.finish().map_err(|_| CoreError::Compression)?;
            if compressed.len() < payload.len() {
                payload = compressed;
                compression = CompressionAlg::Deflate;
            }
        }

        let mut encryption = EncryptionAlg::None;
        let mut salt_hex = None;
        let mut argon2_memory_kib = None;
        let mut argon2_iterations = None;
        let mut argon2_parallelism = None;
        if let Some(ref pw) = opts.password {
            let params = EncryptionParams::new_random();
            payload = lightbeam_crypto::encrypt_password(&payload, pw.as_bytes(), &params)?;
            encryption = EncryptionAlg::Xchacha20Poly1305;
            salt_hex = Some(format!(
                "{}:{}",
                hex::encode(params.salt),
                hex::encode(params.nonce)
            ));
            argon2_memory_kib = Some(params.memory_kib);
            argon2_iterations = Some(params.iterations);
            argon2_parallelism = Some(params.parallelism);
        }

        let payload_hash = sha256_hex(&payload);
        let session_id = SessionId::random();
        let (signing_key, verifying_key) = if let Some(ref seed_hex) = opts.signing_seed_hex {
            let bytes = hex::decode(seed_hex).map_err(|e| CoreError::Msg(e.to_string()))?;
            let sk = lightbeam_crypto::signing_key_from_bytes(&bytes)?;
            let vk = sk.verifying_key();
            (sk, vk)
        } else {
            generate_keypair()
        };
        let publisher_key_id = key_id(&verifying_key);

        let block_size = if opts.block_size == 0 {
            DEFAULT_BLOCK_SIZE
        } else {
            opts.block_size
        };
        let encoder = Encoder::new(&payload, block_size)?;
        let block_count = encoder.k() as u32;

        let mut manifest = Manifest {
            protocol_version: PROTOCOL_VERSION,
            session_id: session_id.to_hex(),
            package_id: Manifest::package_id_from_hash(&payload_hash),
            filename,
            mime_type: opts.mime_type,
            original_byte_length: file_bytes.len() as u64,
            encoded_byte_length: payload.len() as u64,
            creation_timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            expiration_timestamp: None,
            compression,
            encryption,
            hash_algorithm: "sha256".into(),
            payload_hash: payload_hash.clone(),
            publisher_key_id: publisher_key_id.clone(),
            title: opts.title.clone(),
            language: opts.language,
            content_classification: "demo".into(),
            block_size: block_size as u32,
            block_count,
            description: opts.description,
            publisher_name: opts.publisher_name,
            signature: None,
            salt_hex,
            argon2_memory_kib,
            argon2_iterations,
            argon2_parallelism,
        };

        let canonical = manifest.canonical_bytes()?;
        let sig = sign(&signing_key, &canonical);
        manifest.signature = Some(B64.encode(sig));

        // Wire CBOR includes the signature; verification re-derives unsigned canonical bytes.
        let manifest_cbor =
            serde_cbor::to_vec(&manifest).map_err(|e| CoreError::Msg(e.to_string()))?;
        let manifest_json = manifest.to_json_pretty()?;

        let beacon = BeaconPayload {
            title: opts.title,
            profile: opts.profile,
            block_count,
            block_size: block_size as u32,
            original_len: file_bytes.len() as u64,
            payload_hash: payload_hash.clone(),
            short_code: session_id.short_code(),
        };
        let beacon_json = serde_json::to_vec(&beacon).map_err(|e| CoreError::Msg(e.to_string()))?;

        let info = EncodeSessionInfo {
            session_id: session_id.to_hex(),
            short_code: session_id.short_code(),
            package_id: manifest.package_id.clone(),
            payload_hash,
            original_len: file_bytes.len() as u64,
            encoded_len: payload.len() as u64,
            block_count,
            block_size: block_size as u32,
            manifest_json,
            publisher_key_id,
        };

        Ok(Self {
            info,
            session_id,
            encoder,
            manifest_cbor,
            beacon_json,
            next_symbol: 0,
            beacon_interval: 8,
        })
    }

    /// Emit next wire frame bytes (beacon/manifest interleaved with data).
    pub fn next_frame_bytes(&mut self) -> Result<Vec<u8>, CoreError> {
        let tick = self.next_symbol;
        if tick % self.beacon_interval == 0 {
            let frame = Frame::new(
                FrameType::Beacon,
                self.session_id,
                tick as u64,
                self.beacon_json.clone(),
            )?;
            self.next_symbol = self.next_symbol.wrapping_add(1);
            return Ok(frame.encode()?);
        }
        if tick % self.beacon_interval == 1 {
            // Manifest fragment (full CBOR for Phase 1 small manifests)
            let frame = Frame::new(
                FrameType::Manifest,
                self.session_id,
                tick as u64,
                self.manifest_cbor.clone(),
            )?;
            self.next_symbol = self.next_symbol.wrapping_add(1);
            return Ok(frame.encode()?);
        }
        let sym = self.encoder.symbol_at(tick)?;
        let data = DataPayload {
            degree: sym.degree,
            neighbors: sym.neighbors.clone(),
            symbol_bytes: sym.payload.clone(),
        };
        let frame = Frame::new(
            FrameType::Data,
            self.session_id,
            tick as u64,
            data.encode(),
        )?;
        self.next_symbol = self.next_symbol.wrapping_add(1);
        Ok(frame.encode()?)
    }

    pub fn next_qr_png(&mut self, module_px: u32) -> Result<Vec<u8>, CoreError> {
        let bytes = self.next_frame_bytes()?;
        Ok(encode_png(&bytes, module_px, satellite_ecc())?)
    }

    pub fn next_qr_modules(&mut self) -> Result<Vec<Vec<bool>>, CoreError> {
        let bytes = self.next_frame_bytes()?;
        Ok(encode_binary_modules(&bytes, satellite_ecc())?)
    }

    pub fn estimated_symbols_needed(&self) -> u32 {
        ((self.info.block_count as f64) * 1.5).ceil() as u32
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum DecodeStage {
    Searching,
    SessionFound,
    ReadingManifest,
    CollectingData,
    Reconstructing,
    Verifying,
    Complete,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DecodeProgress {
    pub stage: String,
    pub session_id: Option<String>,
    pub short_code: Option<String>,
    pub title: Option<String>,
    pub useful_symbols: u32,
    pub block_count: u32,
    pub resolved_blocks: u32,
    pub percent: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DecodedPackage {
    pub filename: String,
    pub mime_type: String,
    pub title: String,
    pub publisher_name: String,
    pub payload_hash: String,
    pub signature_valid: bool,
    pub bytes_b64: String,
    pub original_len: u64,
}

/// Receiver that collects frames and reconstructs the package.
pub struct DecodeSession {
    locked_session: Option<SessionId>,
    beacon: Option<BeaconPayload>,
    manifest: Option<Manifest>,
    decoder: Option<Decoder>,
    trusted_keys: HashMap<String, Vec<u8>>,
    password: Option<String>,
    stage: DecodeStage,
}

impl DecodeSession {
    pub fn new() -> Self {
        Self {
            locked_session: None,
            beacon: None,
            manifest: None,
            decoder: None,
            trusted_keys: HashMap::new(),
            password: None,
            stage: DecodeStage::Searching,
        }
    }

    pub fn add_trusted_key(&mut self, key_id: String, public_key_bytes: Vec<u8>) {
        self.trusted_keys.insert(key_id, public_key_bytes);
    }

    pub fn set_password(&mut self, password: Option<String>) {
        self.password = password;
    }

    pub fn reset(&mut self) {
        *self = Self {
            trusted_keys: self.trusted_keys.clone(),
            password: self.password.clone(),
            ..Self::new()
        };
    }

    pub fn progress(&self) -> DecodeProgress {
        let (useful, blocks, resolved) = if let Some(ref d) = self.decoder {
            (
                d.useful_count() as u32,
                self.manifest
                    .as_ref()
                    .map(|m| m.block_count)
                    .unwrap_or(0),
                d.resolved_count() as u32,
            )
        } else {
            (0, 0, 0)
        };
        let percent = if blocks == 0 {
            0.0
        } else {
            (resolved as f32 / blocks as f32 * 100.0).min(99.0)
        };
        let stage = if matches!(self.stage, DecodeStage::Complete) {
            100.0
        } else {
            percent
        };
        DecodeProgress {
            stage: format!("{:?}", self.stage),
            session_id: self.locked_session.map(|s| s.to_hex()),
            short_code: self.beacon.as_ref().map(|b| b.short_code.clone()),
            title: self
                .beacon
                .as_ref()
                .map(|b| b.title.clone())
                .or_else(|| self.manifest.as_ref().map(|m| m.title.clone())),
            useful_symbols: useful,
            block_count: blocks,
            resolved_blocks: resolved,
            percent: stage,
        }
    }

    /// Ingest raw frame bytes from a decoded QR. Returns true if useful.
    pub fn ingest_frame_bytes(&mut self, data: &[u8]) -> Result<bool, CoreError> {
        let frame = Frame::decode(data)?;
        if let Some(locked) = self.locked_session {
            if frame.session_id != locked {
                return Ok(false);
            }
        }

        match frame.frame_type {
            FrameType::Beacon => {
                let beacon: BeaconPayload =
                    serde_json::from_slice(&frame.payload).map_err(|e| CoreError::Msg(e.to_string()))?;
                self.locked_session = Some(frame.session_id);
                self.beacon = Some(beacon);
                if matches!(self.stage, DecodeStage::Searching) {
                    self.stage = DecodeStage::SessionFound;
                }
                Ok(true)
            }
            FrameType::Manifest => {
                let manifest: Manifest = serde_cbor::from_slice(&frame.payload)
                    .map_err(|e| CoreError::Msg(e.to_string()))?;
                self.locked_session = Some(frame.session_id);
                if self.decoder.is_none() {
                    let block_size = manifest.block_size as usize;
                    let k = manifest.block_count as usize;
                    let original_encoded = manifest.encoded_byte_length as usize;
                    self.decoder = Some(Decoder::new(k, block_size, original_encoded)?);
                    self.stage = DecodeStage::ReadingManifest;
                }
                self.manifest = Some(manifest);
                Ok(true)
            }
            FrameType::Data => {
                if self.decoder.is_none() {
                    return Ok(false);
                }
                self.stage = DecodeStage::CollectingData;
                let data = DataPayload::decode(&frame.payload)?;
                let sym = Symbol {
                    id: frame.symbol_id as u32,
                    degree: data.degree,
                    neighbors: data.neighbors,
                    payload: data.symbol_bytes,
                };
                let useful = self.decoder.as_mut().unwrap().ingest(&sym);
                if self.decoder.as_ref().unwrap().is_complete() {
                    self.stage = DecodeStage::Reconstructing;
                }
                Ok(useful)
            }
            FrameType::EndLoop => Ok(false),
        }
    }

    pub fn is_complete(&self) -> bool {
        self.decoder
            .as_ref()
            .map(|d| d.is_complete())
            .unwrap_or(false)
    }

    pub fn finish(&mut self) -> Result<DecodedPackage, CoreError> {
        let manifest = self
            .manifest
            .as_ref()
            .ok_or_else(|| CoreError::NotReady)?
            .clone();
        let decoder = self.decoder.as_ref().ok_or(CoreError::NotReady)?;
        if !decoder.is_complete() {
            return Err(CoreError::NotReady);
        }
        self.stage = DecodeStage::Verifying;
        let mut payload = decoder.reconstruct()?;
        let hash = sha256_hex(&payload);
        if hash != manifest.payload_hash {
            return Err(CoreError::Verification(format!(
                "payload hash mismatch: got {hash}, expected {}",
                manifest.payload_hash
            )));
        }

        // Decrypt if needed
        if matches!(manifest.encryption, EncryptionAlg::Xchacha20Poly1305) {
            let pw = self
                .password
                .as_ref()
                .ok_or_else(|| CoreError::Verification("password required".into()))?;
            let salt_nonce = manifest
                .salt_hex
                .as_ref()
                .ok_or_else(|| CoreError::Verification("missing salt".into()))?;
            let parts: Vec<_> = salt_nonce.split(':').collect();
            if parts.len() != 2 {
                return Err(CoreError::Verification("bad salt/nonce".into()));
            }
            let salt = hex::decode(parts[0]).map_err(|e| CoreError::Msg(e.to_string()))?;
            let nonce = hex::decode(parts[1]).map_err(|e| CoreError::Msg(e.to_string()))?;
            let mut params = EncryptionParams::new_random();
            params.salt.copy_from_slice(&salt);
            params.nonce.copy_from_slice(&nonce);
            params.memory_kib = manifest.argon2_memory_kib.unwrap_or(19_456);
            params.iterations = manifest.argon2_iterations.unwrap_or(2);
            params.parallelism = manifest.argon2_parallelism.unwrap_or(1);
            payload = lightbeam_crypto::decrypt_password(&payload, pw.as_bytes(), &params)?;
        }

        // Decompress
        match manifest.compression {
            CompressionAlg::Deflate => {
                let mut dec = DeflateDecoder::new(&payload[..]);
                let mut out = Vec::new();
                dec.read_to_end(&mut out)
                    .map_err(|_| CoreError::Compression)?;
                payload = out;
            }
            CompressionAlg::Zstd => {
                payload = zstd::stream::decode_all(&payload[..])
                    .map_err(|_| CoreError::Compression)?;
            }
            CompressionAlg::None => {}
        }

        if payload.len() as u64 != manifest.original_byte_length {
            return Err(CoreError::Verification(format!(
                "length mismatch after decode: {} vs {}",
                payload.len(),
                manifest.original_byte_length
            )));
        }

        let mut signature_valid = false;
        if let Some(ref sig_b64) = manifest.signature {
            if let Some(pk) = self.trusted_keys.get(&manifest.publisher_key_id) {
                let mut unsigned = manifest.clone();
                unsigned.signature = None;
                let canonical = unsigned.canonical_bytes()?;
                let sig = B64
                    .decode(sig_b64)
                    .map_err(|e| CoreError::Msg(e.to_string()))?;
                let vk = verifying_key_from_bytes(pk)?;
                signature_valid = verify(&vk, &canonical, &sig).is_ok();
            }
        }

        self.stage = DecodeStage::Complete;
        Ok(DecodedPackage {
            filename: manifest.filename,
            mime_type: manifest.mime_type,
            title: manifest.title,
            publisher_name: manifest.publisher_name,
            payload_hash: manifest.payload_hash,
            signature_valid,
            bytes_b64: B64.encode(&payload),
            original_len: manifest.original_byte_length,
        })
    }
}

impl Default for DecodeSession {
    fn default() -> Self {
        Self::new()
    }
}

/// Convenience: encode file and produce N frame byte vectors.
pub fn encode_frames(file_bytes: &[u8], opts: EncodeOptions, count: usize) -> Result<(EncodeSessionInfo, Vec<Vec<u8>>), CoreError> {
    let mut session = EncodeSession::create(file_bytes, opts)?;
    let info = session.info.clone();
    let mut frames = Vec::with_capacity(count);
    for _ in 0..count {
        frames.push(session.next_frame_bytes()?);
    }
    Ok((info, frames))
}

/// Convenience: decode frames into package.
pub fn decode_frames(
    frames: &[Vec<u8>],
    trusted: &[(String, Vec<u8>)],
    password: Option<String>,
) -> Result<DecodedPackage, CoreError> {
    let mut dec = DecodeSession::new();
    for (kid, pk) in trusted {
        dec.add_trusted_key(kid.clone(), pk.clone());
    }
    dec.set_password(password);
    for f in frames {
        let _ = dec.ingest_frame_bytes(f)?;
        if dec.is_complete() {
            break;
        }
    }
    dec.finish()
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(start)]
pub fn wasm_init() {
    console_error_panic_hook::set_once();
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub struct WasmEncoder {
    inner: EncodeSession,
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl WasmEncoder {
    #[wasm_bindgen(constructor)]
    pub fn new(file_bytes: &[u8], options_json: &str) -> Result<WasmEncoder, JsValue> {
        let opts: EncodeOptions =
            serde_json::from_str(options_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let inner =
            EncodeSession::create(file_bytes, opts).map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(WasmEncoder { inner })
    }

    #[wasm_bindgen(js_name = infoJson)]
    pub fn info_json(&self) -> String {
        serde_json::to_string(&self.inner.info).unwrap_or_default()
    }

    #[wasm_bindgen(js_name = nextFrameBytes)]
    pub fn next_frame_bytes(&mut self) -> Result<Vec<u8>, JsValue> {
        self.inner
            .next_frame_bytes()
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = nextQrPng)]
    pub fn next_qr_png(&mut self, module_px: u32) -> Result<Vec<u8>, JsValue> {
        self.inner
            .next_qr_png(module_px)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = estimatedSymbols)]
    pub fn estimated_symbols(&self) -> u32 {
        self.inner.estimated_symbols_needed()
    }
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub struct WasmDecoder {
    inner: DecodeSession,
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl WasmDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmDecoder {
        WasmDecoder {
            inner: DecodeSession::new(),
        }
    }

    #[wasm_bindgen(js_name = ingestFrame)]
    pub fn ingest_frame(&mut self, data: &[u8]) -> Result<bool, JsValue> {
        self.inner
            .ingest_frame_bytes(data)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen(js_name = progressJson)]
    pub fn progress_json(&self) -> String {
        serde_json::to_string(&self.inner.progress()).unwrap_or_default()
    }

    #[wasm_bindgen(js_name = isComplete)]
    pub fn is_complete(&self) -> bool {
        self.inner.is_complete()
    }

    #[wasm_bindgen(js_name = finishJson)]
    pub fn finish_json(&mut self) -> Result<String, JsValue> {
        let pkg = self
            .inner
            .finish()
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        serde_json::to_string(&pkg).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lightbeam_crypto::generate_keypair;

    #[test]
    fn end_to_end_roundtrip() {
        let data: Vec<u8> = (0..8_000u32).flat_map(|i| i.to_le_bytes()).collect();
        let (sk, vk) = generate_keypair();
        let seed = hex::encode(sk.to_bytes());
        let opts = EncodeOptions {
            filename: "demo.bin".into(),
            title: "Demo".into(),
            compress: true,
            signing_seed_hex: Some(seed),
            block_size: 256,
            ..Default::default()
        };
        let mut enc = EncodeSession::create(&data, opts).unwrap();
        let kid = enc.info.publisher_key_id.clone();
        let need = enc.estimated_symbols_needed() as usize + 50;
        let mut frames = Vec::new();
        for _ in 0..need {
            frames.push(enc.next_frame_bytes().unwrap());
        }

        let mut dec = DecodeSession::new();
        dec.add_trusted_key(kid, vk.as_bytes().to_vec());
        for f in &frames {
            let _ = dec.ingest_frame_bytes(f).unwrap();
            if dec.is_complete() {
                break;
            }
        }
        assert!(dec.is_complete());
        let pkg = dec.finish().unwrap();
        let recovered = B64.decode(&pkg.bytes_b64).unwrap();
        assert_eq!(recovered, data);
        assert!(pkg.signature_valid);
    }

    #[test]
    fn midstream_and_loss() {
        let data = vec![0x5Au8; 4096];
        let opts = EncodeOptions {
            compress: false,
            block_size: 128,
            ..Default::default()
        };
        let mut enc = EncodeSession::create(&data, opts).unwrap();
        let mut frames = Vec::new();
        for _ in 0..800 {
            frames.push(enc.next_frame_bytes().unwrap());
        }
        // Drop first 40 and every 4th thereafter
        let mut dec = DecodeSession::new();
        for (i, f) in frames.iter().enumerate().skip(40) {
            if i % 4 == 0 {
                continue;
            }
            let _ = dec.ingest_frame_bytes(f);
            if dec.is_complete() {
                break;
            }
        }
        assert!(dec.is_complete());
        let pkg = dec.finish().unwrap();
        assert_eq!(B64.decode(&pkg.bytes_b64).unwrap(), data);
    }
}
