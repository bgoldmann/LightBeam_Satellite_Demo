//! Cryptography for LightBeam: SHA-256, Ed25519, Argon2id, XChaCha20-Poly1305.

use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2, Params, Version,
};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("encryption failed")]
    Encrypt,
    #[error("decryption failed (wrong password or tampered ciphertext)")]
    Decrypt,
    #[error("invalid key length")]
    InvalidKey,
    #[error("invalid signature")]
    InvalidSignature,
    #[error("argon2 error: {0}")]
    Argon2(String),
    #[error("bad hex")]
    BadHex,
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(sha256(data))
}

/// Generate a new Ed25519 signing keypair.
pub fn generate_keypair() -> (SigningKey, VerifyingKey) {
    let mut csprng = rand::rngs::OsRng;
    let signing = SigningKey::generate(&mut csprng);
    let verifying = signing.verifying_key();
    (signing, verifying)
}

pub fn sign(signing_key: &SigningKey, message: &[u8]) -> [u8; 64] {
    signing_key.sign(message).to_bytes()
}

pub fn verify(verifying_key: &VerifyingKey, message: &[u8], signature: &[u8]) -> Result<(), CryptoError> {
    let sig = Signature::from_slice(signature).map_err(|_| CryptoError::InvalidSignature)?;
    verifying_key
        .verify(message, &sig)
        .map_err(|_| CryptoError::InvalidSignature)
}

pub fn verifying_key_from_bytes(bytes: &[u8]) -> Result<VerifyingKey, CryptoError> {
    let arr: [u8; 32] = bytes.try_into().map_err(|_| CryptoError::InvalidKey)?;
    VerifyingKey::from_bytes(&arr).map_err(|_| CryptoError::InvalidKey)
}

pub fn signing_key_from_bytes(bytes: &[u8]) -> Result<SigningKey, CryptoError> {
    let arr: [u8; 32] = bytes.try_into().map_err(|_| CryptoError::InvalidKey)?;
    Ok(SigningKey::from_bytes(&arr))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EncryptionParams {
    pub salt: [u8; 16],
    pub nonce: [u8; 24],
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl EncryptionParams {
    pub fn new_random() -> Self {
        let mut salt = [0u8; 16];
        let mut nonce = [0u8; 24];
        rand::thread_rng().fill_bytes(&mut salt);
        rand::thread_rng().fill_bytes(&mut nonce);
        Self {
            salt,
            nonce,
            memory_kib: 19_456, // ~19 MiB — demo-friendly
            iterations: 2,
            parallelism: 1,
        }
    }
}

fn derive_key(password: &[u8], params: &EncryptionParams) -> Result<[u8; 32], CryptoError> {
    let argon = Argon2::new(
        argon2::Algorithm::Argon2id,
        Version::V0x13,
        Params::new(
            params.memory_kib,
            params.iterations,
            params.parallelism,
            Some(32),
        )
        .map_err(|e| CryptoError::Argon2(e.to_string()))?,
    );
    let salt = SaltString::encode_b64(&params.salt).map_err(|e| CryptoError::Argon2(e.to_string()))?;
    let hash = argon
        .hash_password(password, &salt)
        .map_err(|e| CryptoError::Argon2(e.to_string()))?;
    let hash_bytes = hash.hash.ok_or_else(|| CryptoError::Argon2("no hash".into()))?;
    let mut key = [0u8; 32];
    key.copy_from_slice(hash_bytes.as_bytes());
    Ok(key)
}

/// Authenticated encrypt with password (Argon2id + XChaCha20-Poly1305).
pub fn encrypt_password(
    plaintext: &[u8],
    password: &[u8],
    params: &EncryptionParams,
) -> Result<Vec<u8>, CryptoError> {
    let key = derive_key(password, params)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| CryptoError::InvalidKey)?;
    let nonce = XNonce::from_slice(&params.nonce);
    cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| CryptoError::Encrypt)
}

pub fn decrypt_password(
    ciphertext: &[u8],
    password: &[u8],
    params: &EncryptionParams,
) -> Result<Vec<u8>, CryptoError> {
    let key = derive_key(password, params)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|_| CryptoError::InvalidKey)?;
    let nonce = XNonce::from_slice(&params.nonce);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::Decrypt)
}

/// Key id: first 16 hex chars of SHA-256 of public key bytes.
pub fn key_id(verifying_key: &VerifyingKey) -> String {
    let h = sha256_hex(verifying_key.as_bytes());
    h[..16].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_verify_roundtrip() {
        let (sk, vk) = generate_keypair();
        let msg = b"canonical manifest bytes";
        let sig = sign(&sk, msg);
        verify(&vk, msg, &sig).unwrap();
        assert!(verify(&vk, b"tampered", &sig).is_err());
    }

    #[test]
    fn aead_roundtrip() {
        let params = EncryptionParams::new_random();
        let pt = b"secret file contents for broadcast";
        let ct = encrypt_password(pt, b"correct-horse", &params).unwrap();
        let out = decrypt_password(&ct, b"correct-horse", &params).unwrap();
        assert_eq!(out, pt);
        assert!(decrypt_password(&ct, b"wrong", &params).is_err());
    }
}
