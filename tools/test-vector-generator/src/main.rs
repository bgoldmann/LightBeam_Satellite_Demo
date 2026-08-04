//! Generate golden test vectors for LBOP/1.

use std::fs;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use lightbeam_core::{encode_frames, EncodeOptions};
use lightbeam_crypto::signing_key_from_bytes;
use lightbeam_protocol::sha256_hex;
use serde_json::json;

fn main() {
    let out_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../spec/test-vectors");
    fs::create_dir_all(&out_dir).expect("create test-vectors dir");

    let seed = [7u8; 32];
    let sk = signing_key_from_bytes(&seed).unwrap();
    let vk = sk.verifying_key();
    let seed_hex = hex::encode(seed);

    let payload = b"LightBeam LBOP/1 golden vector payload v0.1\n".to_vec();
    let opts = EncodeOptions {
        title: "Golden Vector".into(),
        publisher_name: "LightBeam Test".into(),
        filename: "golden.txt".into(),
        mime_type: "text/plain".into(),
        language: "en".into(),
        description: Some("Deterministic test vector".into()),
        compress: false,
        password: None,
        block_size: 32,
        profile: "lab".into(),
        signing_seed_hex: Some(seed_hex.clone()),
    };

    let (info, frames) = encode_frames(&payload, opts, 120).expect("encode");
    let frame_hex: Vec<String> = frames.iter().map(|f| hex::encode(f)).collect();

    let vector = json!({
        "version": "0.1",
        "protocol": "LBOP/1",
        "payload_utf8": String::from_utf8(payload.clone()).unwrap(),
        "payload_sha256": sha256_hex(&payload),
        "signing_seed_hex": seed_hex,
        "public_key_hex": hex::encode(vk.as_bytes()),
        "publisher_key_id": info.publisher_key_id,
        "session_info": {
            "session_id": info.session_id,
            "short_code": info.short_code,
            "package_id": info.package_id,
            "payload_hash": info.payload_hash,
            "block_count": info.block_count,
            "block_size": info.block_size,
        },
        "manifest_json": serde_json::from_str::<serde_json::Value>(&info.manifest_json).unwrap(),
        "frames_hex": frame_hex,
        "frames_b64": frames.iter().map(|f| B64.encode(f)).collect::<Vec<_>>(),
    });

    let path = out_dir.join("v0.1-golden.json");
    fs::write(&path, serde_json::to_string_pretty(&vector).unwrap()).unwrap();
    println!("Wrote {}", path.display());

    fs::write(
        out_dir.join("README.md"),
        "# LBOP/1 Test Vectors\n\n`v0.1-golden.json` — deterministic encode of a fixed plaintext with fixed Ed25519 seed.\n\nRegenerate: `cargo run -p test-vector-generator`\n",
    )
    .unwrap();
}
