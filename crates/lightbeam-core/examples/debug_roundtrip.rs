use lightbeam_core::{DecodeSession, EncodeOptions, EncodeSession};
use lightbeam_crypto::generate_keypair;
use base64::{engine::general_purpose::STANDARD as B64, Engine};

fn main() {
    let data: Vec<u8> = (0..800u32).flat_map(|i| i.to_le_bytes()).collect();
    let (sk, vk) = generate_keypair();
    let seed = hex::encode(sk.to_bytes());
    let opts = EncodeOptions {
        filename: "demo.bin".into(),
        title: "Demo".into(),
        compress: false,
        signing_seed_hex: Some(seed),
        block_size: 64,
        ..Default::default()
    };
    let mut enc = EncodeSession::create(&data, opts).unwrap();
    println!("k={} hash={} encoded_len={}", enc.info.block_count, enc.info.payload_hash, enc.info.encoded_len);
    let kid = enc.info.publisher_key_id.clone();
    let mut dec = DecodeSession::new();
    dec.add_trusted_key(kid, vk.as_bytes().to_vec());
    for i in 0..500 {
        let f = enc.next_frame_bytes().unwrap();
        match dec.ingest_frame_bytes(&f) {
            Ok(u) => {
                let p = dec.progress();
                if i < 8 || i % 50 == 0 {
                    println!("i={i} useful={u} stage={} resolved={}/{} symbols={}", p.stage, p.resolved_blocks, p.block_count, p.useful_symbols);
                }
            }
            Err(e) => println!("i={i} ERR {e}"),
        }
        if dec.is_complete() {
            println!("COMPLETE at {i}");
            let pkg = dec.finish().unwrap();
            let recovered = B64.decode(&pkg.bytes_b64).unwrap();
            println!("match={} sig={} len={}", recovered == data, pkg.signature_valid, recovered.len());
            return;
        }
    }
    println!("FAILED progress={:?}", dec.progress());
}
