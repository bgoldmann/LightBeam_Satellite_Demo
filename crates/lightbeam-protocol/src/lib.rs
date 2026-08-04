//! LBOP/1 protocol: session IDs, frame envelopes, manifests.

use crc32fast::Hasher as Crc32;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const PROTOCOL_VERSION: u8 = 1;
pub const MAGIC: [u8; 4] = *b"LBOP";

/// Frame type identifiers.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameType {
    Beacon = 0x01,
    Manifest = 0x02,
    Data = 0x03,
    EndLoop = 0x04,
}

impl FrameType {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0x01 => Some(Self::Beacon),
            0x02 => Some(Self::Manifest),
            0x03 => Some(Self::Data),
            0x04 => Some(Self::EndLoop),
            _ => None,
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("invalid magic")]
    InvalidMagic,
    #[error("unsupported protocol version {0}")]
    UnsupportedVersion(u8),
    #[error("unknown frame type {0}")]
    UnknownFrameType(u8),
    #[error("header CRC mismatch")]
    HeaderCrcMismatch,
    #[error("frame CRC mismatch")]
    FrameCrcMismatch,
    #[error("truncated frame")]
    Truncated,
    #[error("payload too large")]
    PayloadTooLarge,
    #[error("serialization error: {0}")]
    Serialize(String),
    #[error("invalid session id")]
    InvalidSessionId,
}

/// 128-bit random session identifier.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SessionId(pub [u8; 16]);

impl SessionId {
    pub fn random() -> Self {
        let mut bytes = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut bytes);
        Self(bytes)
    }

    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }

    pub fn to_hex(&self) -> String {
        hex::encode(self.0)
    }

    /// Human-readable short code: 8 uppercase alphanumerics derived from id.
    pub fn short_code(&self) -> String {
        const ALPHA: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let mut out = String::with_capacity(8);
        let mut n = u64::from_be_bytes(self.0[0..8].try_into().unwrap());
        for _ in 0..8 {
            out.push(ALPHA[(n % 32) as usize] as char);
            n /= 32;
        }
        out
    }
}

/// Wire frame envelope (binary).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame {
    pub version: u8,
    pub frame_type: FrameType,
    pub flags: u16,
    pub session_id: SessionId,
    pub symbol_id: u64,
    pub payload: Vec<u8>,
}

impl Frame {
    pub const HEADER_LEN: usize = 4 + 1 + 1 + 2 + 16 + 8 + 2 + 4; // through header CRC
                                                                   // magic(4)+ver(1)+type(1)+flags(2)+sid(16)+sym(8)+plen(2)+hcrc(4) = 38

    pub fn new(
        frame_type: FrameType,
        session_id: SessionId,
        symbol_id: u64,
        payload: Vec<u8>,
    ) -> Result<Self, ProtocolError> {
        if payload.len() > u16::MAX as usize {
            return Err(ProtocolError::PayloadTooLarge);
        }
        Ok(Self {
            version: PROTOCOL_VERSION,
            frame_type,
            flags: 0,
            session_id,
            symbol_id,
            payload,
        })
    }

    pub fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        let plen = self.payload.len();
        if plen > u16::MAX as usize {
            return Err(ProtocolError::PayloadTooLarge);
        }
        let mut buf = Vec::with_capacity(Self::HEADER_LEN + plen + 4);
        buf.extend_from_slice(&MAGIC);
        buf.push(self.version);
        buf.push(self.frame_type as u8);
        buf.extend_from_slice(&self.flags.to_be_bytes());
        buf.extend_from_slice(&self.session_id.0);
        buf.extend_from_slice(&self.symbol_id.to_be_bytes());
        buf.extend_from_slice(&(plen as u16).to_be_bytes());
        let header_crc = crc32(&buf);
        buf.extend_from_slice(&header_crc.to_be_bytes());
        buf.extend_from_slice(&self.payload);
        let frame_crc = crc32(&buf);
        buf.extend_from_slice(&frame_crc.to_be_bytes());
        Ok(buf)
    }

    pub fn decode(data: &[u8]) -> Result<Self, ProtocolError> {
        if data.len() < Self::HEADER_LEN + 4 {
            return Err(ProtocolError::Truncated);
        }
        if data[0..4] != MAGIC {
            return Err(ProtocolError::InvalidMagic);
        }
        let version = data[4];
        if version != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion(version));
        }
        let frame_type =
            FrameType::from_u8(data[5]).ok_or(ProtocolError::UnknownFrameType(data[5]))?;
        let flags = u16::from_be_bytes([data[6], data[7]]);
        let mut sid = [0u8; 16];
        sid.copy_from_slice(&data[8..24]);
        let symbol_id = u64::from_be_bytes(data[24..32].try_into().unwrap());
        let plen = u16::from_be_bytes([data[32], data[33]]) as usize;
        let header_without_crc = &data[..34];
        let expected_hcrc = u32::from_be_bytes(data[34..38].try_into().unwrap());
        if crc32(header_without_crc) != expected_hcrc {
            return Err(ProtocolError::HeaderCrcMismatch);
        }
        let total = Self::HEADER_LEN + plen + 4;
        if data.len() < total {
            return Err(ProtocolError::Truncated);
        }
        let payload = data[38..38 + plen].to_vec();
        let body = &data[..38 + plen];
        let expected_fcrc = u32::from_be_bytes(data[38 + plen..42 + plen].try_into().unwrap());
        if crc32(body) != expected_fcrc {
            return Err(ProtocolError::FrameCrcMismatch);
        }
        Ok(Self {
            version,
            frame_type,
            flags,
            session_id: SessionId(sid),
            symbol_id,
            payload,
        })
    }
}

fn crc32(data: &[u8]) -> u32 {
    let mut h = Crc32::new();
    h.update(data);
    h.finalize()
}

/// Compression algorithm identifiers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompressionAlg {
    None,
    Deflate,
    Zstd,
}

/// Encryption algorithm identifiers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EncryptionAlg {
    None,
    Xchacha20Poly1305,
}

/// Canonical package manifest (signed as CBOR).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub protocol_version: u8,
    pub session_id: String,
    pub package_id: String,
    pub filename: String,
    pub mime_type: String,
    pub original_byte_length: u64,
    pub encoded_byte_length: u64,
    pub creation_timestamp: u64,
    pub expiration_timestamp: Option<u64>,
    pub compression: CompressionAlg,
    pub encryption: EncryptionAlg,
    pub hash_algorithm: String,
    pub payload_hash: String,
    pub publisher_key_id: String,
    pub title: String,
    pub language: String,
    pub content_classification: String,
    pub block_size: u32,
    pub block_count: u32,
    pub description: Option<String>,
    pub publisher_name: String,
    /// Base64 Ed25519 signature over canonical CBOR of unsigned fields — filled after signing.
    pub signature: Option<String>,
    /// Encryption params when encrypted.
    pub salt_hex: Option<String>,
    pub argon2_memory_kib: Option<u32>,
    pub argon2_iterations: Option<u32>,
    pub argon2_parallelism: Option<u32>,
}

impl Manifest {
    pub fn package_id_from_hash(payload_hash_hex: &str) -> String {
        format!("pkg_{}", &payload_hash_hex[..16.min(payload_hash_hex.len())])
    }

    /// Deterministic CBOR for signing (signature field excluded / None).
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        let mut unsigned = self.clone();
        unsigned.signature = None;
        serde_cbor::to_vec(&unsigned).map_err(|e| ProtocolError::Serialize(e.to_string()))
    }

    pub fn to_json_pretty(&self) -> Result<String, ProtocolError> {
        serde_json::to_string_pretty(self).map_err(|e| ProtocolError::Serialize(e.to_string()))
    }
}

/// Beacon payload (JSON for M0 simplicity; CBOR in frozen LBOP).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BeaconPayload {
    pub title: String,
    pub profile: String,
    pub block_count: u32,
    pub block_size: u32,
    pub original_len: u64,
    pub payload_hash: String,
    pub short_code: String,
}

/// Data-frame payload: degree + neighbors optional + fountain XOR bytes.
#[derive(Clone, Debug)]
pub struct DataPayload {
    pub degree: u16,
    pub neighbors: Vec<u16>,
    pub symbol_bytes: Vec<u8>,
}

impl DataPayload {
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(2 + 2 + self.neighbors.len() * 2 + self.symbol_bytes.len());
        out.extend_from_slice(&self.degree.to_be_bytes());
        out.extend_from_slice(&(self.neighbors.len() as u16).to_be_bytes());
        for n in &self.neighbors {
            out.extend_from_slice(&n.to_be_bytes());
        }
        out.extend_from_slice(&self.symbol_bytes);
        out
    }

    pub fn decode(data: &[u8]) -> Result<Self, ProtocolError> {
        if data.len() < 4 {
            return Err(ProtocolError::Truncated);
        }
        let degree = u16::from_be_bytes([data[0], data[1]]);
        let ncount = u16::from_be_bytes([data[2], data[3]]) as usize;
        let need = 4 + ncount * 2;
        if data.len() < need {
            return Err(ProtocolError::Truncated);
        }
        let mut neighbors = Vec::with_capacity(ncount);
        for i in 0..ncount {
            let off = 4 + i * 2;
            neighbors.push(u16::from_be_bytes([data[off], data[off + 1]]));
        }
        Ok(Self {
            degree,
            neighbors,
            symbol_bytes: data[need..].to_vec(),
        })
    }
}

/// SHA-256 hex of bytes.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Sanitize filename: strip path components and dangerous characters.
pub fn sanitize_filename(name: &str) -> String {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("file")
        .trim()
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect::<String>();
    if base.is_empty() || base == "." || base == ".." {
        "file.bin".into()
    } else {
        base
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip() {
        let sid = SessionId::from_bytes([1u8; 16]);
        let frame = Frame::new(FrameType::Data, sid, 42, b"payload".to_vec()).unwrap();
        let encoded = frame.encode().unwrap();
        let decoded = Frame::decode(&encoded).unwrap();
        assert_eq!(decoded, frame);
    }

    #[test]
    fn frame_crc_detects_corruption() {
        let sid = SessionId::from_bytes([2u8; 16]);
        let frame = Frame::new(FrameType::Beacon, sid, 0, b"hi".to_vec()).unwrap();
        let mut encoded = frame.encode().unwrap();
        encoded[40] ^= 0xff;
        assert!(Frame::decode(&encoded).is_err());
    }

    #[test]
    fn short_code_stable() {
        let sid = SessionId::from_bytes([0x11; 16]);
        assert_eq!(sid.short_code().len(), 8);
        assert_eq!(sid.short_code(), sid.short_code());
    }

    #[test]
    fn sanitize_path_traversal() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename(""), "file.bin");
    }

    #[test]
    fn data_payload_roundtrip() {
        let p = DataPayload {
            degree: 3,
            neighbors: vec![0, 2, 5],
            symbol_bytes: vec![9, 8, 7, 6],
        };
        let enc = p.encode();
        let dec = DataPayload::decode(&enc).unwrap();
        assert_eq!(dec.degree, 3);
        assert_eq!(dec.neighbors, vec![0, 2, 5]);
        assert_eq!(dec.symbol_bytes, vec![9, 8, 7, 6]);
    }

    #[test]
    fn sha256_known() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}
