//! Luby Transform fountain coding for LightBeam LBOP/1.
//!
//! Each encoded symbol is the XOR of a pseudorandom subset of source blocks.
//! Degree is drawn from a robust-soliton distribution. The receiver peels
//! once it has enough unique symbols (~K * 1.15 typically for lab overhead).

use rand::Rng;
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha8Rng;
use thiserror::Error;

/// Default source block size for Phase 1 (bytes).
pub const DEFAULT_BLOCK_SIZE: usize = 512;

/// Robust soliton parameters (c, delta) tuned for optical erasure channels.
const RS_C: f64 = 0.1;
const RS_DELTA: f64 = 0.05;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum FecError {
    #[error("empty input")]
    EmptyInput,
    #[error("invalid block size")]
    InvalidBlockSize,
    #[error("insufficient symbols to reconstruct ({have} have, need ~{need})")]
    InsufficientSymbols { have: usize, need: usize },
    #[error("reconstruction failed after peeling")]
    ReconstructionFailed,
    #[error("block count mismatch")]
    BlockCountMismatch,
}

/// Split payload into fixed-size source blocks (last block zero-padded).
pub fn split_blocks(data: &[u8], block_size: usize) -> Result<Vec<Vec<u8>>, FecError> {
    if data.is_empty() {
        return Err(FecError::EmptyInput);
    }
    if block_size == 0 {
        return Err(FecError::InvalidBlockSize);
    }
    let mut blocks = Vec::new();
    for chunk in data.chunks(block_size) {
        let mut block = vec![0u8; block_size];
        block[..chunk.len()].copy_from_slice(chunk);
        blocks.push(block);
    }
    Ok(blocks)
}

/// Number of source blocks needed for `len` bytes at `block_size`.
pub fn block_count(len: usize, block_size: usize) -> usize {
    if len == 0 || block_size == 0 {
        return 0;
    }
    (len + block_size - 1) / block_size
}

/// Ideal soliton probability mass for degree d (1..=k).
fn ideal_soliton(k: usize, d: usize) -> f64 {
    if d == 0 || d > k {
        return 0.0;
    }
    if d == 1 {
        1.0 / k as f64
    } else {
        1.0 / (d as f64 * (d as f64 - 1.0))
    }
}

fn robust_soliton_tau(k: usize, d: usize) -> f64 {
    let s = RS_C * (k as f64).ln() * (k as f64).sqrt() / RS_DELTA;
    let r = (s / k as f64).ceil() as usize;
    if r == 0 {
        return 0.0;
    }
    if d >= 1 && d < r {
        s as f64 / (d as f64 * k as f64)
    } else if d == r {
        (s as f64 * (s / RS_DELTA).ln()) / k as f64
    } else {
        0.0
    }
}

/// Build cumulative distribution for robust soliton over degrees 1..=k.
fn robust_soliton_cdf(k: usize) -> Vec<f64> {
    let mut masses = vec![0.0; k + 1];
    let mut sum = 0.0;
    for d in 1..=k {
        let m = ideal_soliton(k, d) + robust_soliton_tau(k, d);
        masses[d] = m;
        sum += m;
    }
    let mut cdf = vec![0.0; k + 1];
    let mut acc = 0.0;
    for d in 1..=k {
        acc += masses[d] / sum;
        cdf[d] = acc;
    }
    cdf[k] = 1.0;
    cdf
}

fn sample_degree(cdf: &[f64], u: f64) -> usize {
    for (d, &p) in cdf.iter().enumerate().skip(1) {
        if u <= p {
            return d;
        }
    }
    cdf.len() - 1
}

/// Deterministic PRNG seeded from symbol id for reproducible neighbor sets.
fn neighbors(seed: u32, k: usize, degree: usize) -> Vec<usize> {
    let mut rng = ChaCha8Rng::seed_from_u64(((seed as u64) << 32) | (k as u64));
    let mut chosen = Vec::with_capacity(degree);
    while chosen.len() < degree {
        let idx = rng.gen_range(0..k);
        if !chosen.contains(&idx) {
            chosen.push(idx);
        }
        // Safety for tiny k
        if chosen.len() == k {
            break;
        }
    }
    chosen.sort_unstable();
    chosen
}

/// One fountain-coded symbol.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Symbol {
    pub id: u32,
    pub degree: u16,
    pub neighbors: Vec<u16>,
    pub payload: Vec<u8>,
}

impl Symbol {
    /// Encode a symbol from source blocks using robust-soliton degree.
    pub fn encode(blocks: &[Vec<u8>], id: u32) -> Result<Self, FecError> {
        if blocks.is_empty() {
            return Err(FecError::EmptyInput);
        }
        let k = blocks.len();
        let block_size = blocks[0].len();
        let cdf = robust_soliton_cdf(k);
        let mut rng = ChaCha8Rng::seed_from_u64(id as u64 ^ 0x1B0F_ACE5u64);
        let u: f64 = rng.gen();
        let degree = sample_degree(&cdf, u).max(1).min(k);
        let idxs = neighbors(id, k, degree);
        let mut payload = vec![0u8; block_size];
        for &i in &idxs {
            xor_inplace(&mut payload, &blocks[i]);
        }
        Ok(Self {
            id,
            degree: degree as u16,
            neighbors: idxs.iter().map(|&i| i as u16).collect(),
            payload,
        })
    }

    /// Recompute neighbors from id (receiver can verify or omit stored neighbors).
    pub fn neighbors_from_id(id: u32, k: usize, degree: usize) -> Vec<usize> {
        neighbors(id, k, degree)
    }
}

fn xor_inplace(dst: &mut [u8], src: &[u8]) {
    for (d, s) in dst.iter_mut().zip(src.iter()) {
        *d ^= *s;
    }
}

/// Streaming LT encoder that yields symbols by increasing id.
pub struct Encoder {
    blocks: Vec<Vec<u8>>,
    next_id: u32,
    pub original_len: usize,
    pub block_size: usize,
}

impl Encoder {
    pub fn new(data: &[u8], block_size: usize) -> Result<Self, FecError> {
        let blocks = split_blocks(data, block_size)?;
        Ok(Self {
            blocks,
            next_id: 0,
            original_len: data.len(),
            block_size,
        })
    }

    pub fn k(&self) -> usize {
        self.blocks.len()
    }

    pub fn next_symbol(&mut self) -> Result<Symbol, FecError> {
        let sym = Symbol::encode(&self.blocks, self.next_id)?;
        self.next_id = self.next_id.wrapping_add(1);
        Ok(sym)
    }

    pub fn symbol_at(&self, id: u32) -> Result<Symbol, FecError> {
        Symbol::encode(&self.blocks, id)
    }
}

/// Belief-propagation / peel decoder for LT symbols.
pub struct Decoder {
    k: usize,
    block_size: usize,
    original_len: usize,
    /// Resolved source blocks (None = unknown).
    blocks: Vec<Option<Vec<u8>>>,
    /// Pending symbols still to peel: (neighbors, payload)
    pending: Vec<(Vec<usize>, Vec<u8>)>,
    seen_ids: std::collections::HashSet<u32>,
}

impl Decoder {
    pub fn new(k: usize, block_size: usize, original_len: usize) -> Result<Self, FecError> {
        if k == 0 || block_size == 0 {
            return Err(FecError::InvalidBlockSize);
        }
        Ok(Self {
            k,
            block_size,
            original_len,
            blocks: vec![None; k],
            pending: Vec::new(),
            seen_ids: std::collections::HashSet::new(),
        })
    }

    pub fn useful_count(&self) -> usize {
        self.seen_ids.len()
    }

    pub fn resolved_count(&self) -> usize {
        self.blocks.iter().filter(|b| b.is_some()).count()
    }

    pub fn is_complete(&self) -> bool {
        self.resolved_count() == self.k
    }

    /// Ingest a symbol. Returns true if it was new (useful).
    pub fn ingest(&mut self, symbol: &Symbol) -> bool {
        if !self.seen_ids.insert(symbol.id) {
            return false;
        }
        let neighbors: Vec<usize> = if symbol.neighbors.is_empty() {
            // Reconstruct neighbors from degree + id if wire omits them
            neighbors(symbol.id, self.k, symbol.degree as usize)
        } else {
            symbol
                .neighbors
                .iter()
                .map(|&n| n as usize)
                .filter(|&n| n < self.k)
                .collect()
        };
        if neighbors.is_empty() || symbol.payload.len() != self.block_size {
            return true; // counted as seen but useless
        }
        self.pending.push((neighbors, symbol.payload.clone()));
        self.peel();
        true
    }

    fn peel(&mut self) {
        let mut progressed = true;
        while progressed {
            progressed = false;
            let mut i = 0;
            while i < self.pending.len() {
                // Reduce known neighbors
                let (ref mut neigh, ref mut payload) = self.pending[i];
                let mut j = 0;
                while j < neigh.len() {
                    let idx = neigh[j];
                    if let Some(ref known) = self.blocks[idx] {
                        xor_inplace(payload, known);
                        neigh.swap_remove(j);
                    } else {
                        j += 1;
                    }
                }
                if neigh.len() == 1 {
                    let idx = neigh[0];
                    if self.blocks[idx].is_none() {
                        self.blocks[idx] = Some(payload.clone());
                        progressed = true;
                    }
                    self.pending.swap_remove(i);
                } else if neigh.is_empty() {
                    self.pending.swap_remove(i);
                } else {
                    i += 1;
                }
            }
        }
    }

    /// Reconstruct original bytes once complete.
    pub fn reconstruct(&self) -> Result<Vec<u8>, FecError> {
        if !self.is_complete() {
            return Err(FecError::InsufficientSymbols {
                have: self.useful_count(),
                need: ((self.k as f64) * 1.15).ceil() as usize,
            });
        }
        let mut out = Vec::with_capacity(self.original_len);
        for block in &self.blocks {
            let b = block.as_ref().ok_or(FecError::ReconstructionFailed)?;
            out.extend_from_slice(b);
        }
        out.truncate(self.original_len);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_small() {
        let data = b"Hello LightBeam optical transfer protocol!".to_vec();
        let enc = Encoder::new(&data, 8).unwrap();
        let k = enc.k();
        let mut dec = Decoder::new(k, 8, data.len()).unwrap();
        let mut id = 0u32;
        while !dec.is_complete() {
            let sym = enc.symbol_at(id).unwrap();
            dec.ingest(&sym);
            id += 1;
            assert!(id < 500, "took too many symbols");
        }
        assert_eq!(dec.reconstruct().unwrap(), data);
    }

    #[test]
    fn roundtrip_with_loss() {
        let data: Vec<u8> = (0..10_000u32).flat_map(|i| i.to_le_bytes()).collect();
        let block_size = 64;
        let enc = Encoder::new(&data, block_size).unwrap();
        let k = enc.k();
        let mut dec = Decoder::new(k, block_size, data.len()).unwrap();
        // Skip every 3rd symbol to simulate ~33% loss
        let mut id = 0u32;
        while !dec.is_complete() {
            if id % 3 != 0 {
                let sym = enc.symbol_at(id).unwrap();
                dec.ingest(&sym);
            }
            id += 1;
            assert!(id < k as u32 * 10, "failed with loss");
        }
        assert_eq!(dec.reconstruct().unwrap(), data);
    }

    #[test]
    fn midstream_join() {
        let data = vec![0xABu8; 2048];
        let enc = Encoder::new(&data, 128).unwrap();
        let k = enc.k();
        let mut dec = Decoder::new(k, 128, data.len()).unwrap();
        // Start at symbol 50 (midstream)
        let mut id = 50u32;
        while !dec.is_complete() {
            let sym = enc.symbol_at(id).unwrap();
            dec.ingest(&sym);
            id += 1;
            assert!(id < 50 + k as u32 * 5);
        }
        assert_eq!(dec.reconstruct().unwrap(), data);
    }

    #[test]
    fn duplicate_symbols_ignored() {
        let data = b"dup-test".to_vec();
        let enc = Encoder::new(&data, 4).unwrap();
        let mut dec = Decoder::new(enc.k(), 4, data.len()).unwrap();
        let sym = enc.symbol_at(0).unwrap();
        assert!(dec.ingest(&sym));
        assert!(!dec.ingest(&sym));
        assert_eq!(dec.useful_count(), 1);
    }
}
