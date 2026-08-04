/** Luby Transform fountain coding — mirrors crates/lightbeam-fec. */

const RS_C = 0.1;
const RS_DELTA = 0.05;
export const DEFAULT_BLOCK_SIZE = 512;

function idealSoliton(k: number, d: number): number {
  if (d === 0 || d > k) return 0;
  if (d === 1) return 1 / k;
  return 1 / (d * (d - 1));
}

function robustSolitonTau(k: number, d: number): number {
  const s = (RS_C * Math.log(k) * Math.sqrt(k)) / RS_DELTA;
  const r = Math.max(1, Math.ceil(s / k));
  if (d >= 1 && d < r) return s / (d * k);
  if (d === r) return (s * Math.log(Math.max(s / RS_DELTA, 1.0001))) / k;
  return 0;
}

function robustSolitonCdf(k: number): Float64Array {
  const masses = new Float64Array(k + 1);
  let sum = 0;
  for (let d = 1; d <= k; d++) {
    masses[d] = idealSoliton(k, d) + robustSolitonTau(k, d);
    sum += masses[d];
  }
  const cdf = new Float64Array(k + 1);
  let acc = 0;
  for (let d = 1; d <= k; d++) {
    acc += masses[d] / sum;
    cdf[d] = acc;
  }
  cdf[k] = 1;
  return cdf;
}

function sampleDegree(cdf: Float64Array, u: number): number {
  for (let d = 1; d < cdf.length; d++) {
    if (u <= cdf[d]) return d;
  }
  return cdf.length - 1;
}

/** Deterministic 32-bit mix (murmur-inspired). */
function mix32(a: number, b = 0): number {
  let h = Math.imul(a ^ b, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/**
 * Neighbor selection via hash mixing. Neighbors are embedded on the wire so
 * encoder/decoder platforms do not need identical PRNGs for recovery.
 */
export function neighbors(seed: number, k: number, degree: number): number[] {
  const want = Math.min(degree, k);
  const chosen = new Set<number>();
  let attempt = 0;
  while (chosen.size < want && attempt < k * 32) {
    const h = mix32(seed ^ Math.imul(attempt + 1, 0x9e3779b9), k);
    chosen.add(h % k);
    attempt++;
  }
  for (let i = 0; chosen.size < want && i < k; i++) chosen.add(i);
  return [...chosen].sort((a, b) => a - b);
}

function xorInplace(dst: Uint8Array, src: Uint8Array) {
  for (let i = 0; i < dst.length; i++) dst[i] ^= src[i];
}

export function splitBlocks(data: Uint8Array, blockSize: number): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += blockSize) {
    const block = new Uint8Array(blockSize);
    const slice = data.subarray(i, Math.min(i + blockSize, data.length));
    block.set(slice);
    blocks.push(block);
  }
  return blocks;
}

export interface Symbol {
  id: number;
  degree: number;
  neighbors: number[];
  payload: Uint8Array;
}

function sampleDegreeForId(id: number, k: number): number {
  const cdf = robustSolitonCdf(k);
  const u = (mix32(id, 0x1b0face5) >>> 0) / 0x100000000;
  return Math.max(1, Math.min(k, sampleDegree(cdf, u)));
}

export function encodeSymbol(blocks: Uint8Array[], id: number): Symbol {
  const k = blocks.length;
  const degree = sampleDegreeForId(id, k);
  const idxs = neighbors(id, k, degree);
  const payload = new Uint8Array(blocks[0].length);
  for (const i of idxs) xorInplace(payload, blocks[i]);
  return { id, degree, neighbors: idxs, payload };
}

export class LtEncoder {
  blocks: Uint8Array[];
  originalLen: number;
  blockSize: number;
  nextId = 0;

  constructor(data: Uint8Array, blockSize: number) {
    this.blocks = splitBlocks(data, blockSize);
    this.originalLen = data.length;
    this.blockSize = blockSize;
  }

  get k() {
    return this.blocks.length;
  }

  symbolAt(id: number): Symbol {
    return encodeSymbol(this.blocks, id);
  }

  nextSymbol(): Symbol {
    const s = this.symbolAt(this.nextId);
    this.nextId++;
    return s;
  }
}

export class LtDecoder {
  k: number;
  blockSize: number;
  originalLen: number;
  blocks: (Uint8Array | null)[];
  pending: { neighbors: number[]; payload: Uint8Array }[] = [];
  seenIds = new Set<number>();

  constructor(k: number, blockSize: number, originalLen: number) {
    this.k = k;
    this.blockSize = blockSize;
    this.originalLen = originalLen;
    this.blocks = Array.from({ length: k }, () => null);
  }

  get usefulCount() {
    return this.seenIds.size;
  }

  get resolvedCount() {
    return this.blocks.filter((b) => b !== null).length;
  }

  get isComplete() {
    return this.resolvedCount === this.k;
  }

  ingest(symbol: Symbol): boolean {
    if (this.seenIds.has(symbol.id)) return false;
    this.seenIds.add(symbol.id);
    const neigh =
      symbol.neighbors.length > 0
        ? [...symbol.neighbors]
        : neighbors(symbol.id, this.k, symbol.degree);
    if (neigh.length === 0 || symbol.payload.length !== this.blockSize) return true;
    this.pending.push({ neighbors: neigh, payload: new Uint8Array(symbol.payload) });
    this.peel();
    return true;
  }

  private peel() {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let i = 0; i < this.pending.length; ) {
        const item = this.pending[i];
        for (let j = 0; j < item.neighbors.length; ) {
          const idx = item.neighbors[j];
          const known = this.blocks[idx];
          if (known) {
            xorInplace(item.payload, known);
            item.neighbors.splice(j, 1);
          } else j++;
        }
        if (item.neighbors.length === 1) {
          const idx = item.neighbors[0];
          if (!this.blocks[idx]) {
            this.blocks[idx] = new Uint8Array(item.payload);
            progressed = true;
          }
          this.pending.splice(i, 1);
        } else if (item.neighbors.length === 0) {
          this.pending.splice(i, 1);
        } else i++;
      }
    }
  }

  reconstruct(): Uint8Array {
    if (!this.isComplete) throw new Error("incomplete");
    const out = new Uint8Array(this.k * this.blockSize);
    for (let i = 0; i < this.k; i++) out.set(this.blocks[i]!, i * this.blockSize);
    return out.subarray(0, this.originalLen);
  }
}
