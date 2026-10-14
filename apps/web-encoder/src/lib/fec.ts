/** Luby Transform fountain coding — mirrors crates/lightbeam-fec. */

const RS_C = 0.1;
const RS_DELTA = 0.05;
export const DEFAULT_BLOCK_SIZE = 512;

function idealSoliton(k: number, d: number): number {
  if (d === 0 || d > k) return 0;
  if (d === 1) return 1 / k;
  return 1 / (d * (d - 1));
}

/**
 * Correct robust-soliton τ spike (Luby 2002 / Shokrollahi):
 *   S = c · ln(k/δ) · √k
 *   R = round(k/S)   // spike degree
 */
function robustSolitonTau(k: number, d: number): number {
  const s = RS_C * Math.log(k / RS_DELTA) * Math.sqrt(k);
  const r = Math.max(1, Math.round(k / s));
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

export class LtEncoder {
  blocks: Uint8Array[];
  originalLen: number;
  blockSize: number;
  nextId = 0;
  private cdf: Float64Array;

  constructor(data: Uint8Array, blockSize: number) {
    this.blocks = splitBlocks(data, blockSize);
    this.originalLen = data.length;
    this.blockSize = blockSize;
    this.cdf = robustSolitonCdf(this.blocks.length);
  }

  get k() {
    return this.blocks.length;
  }

  private sampleDegreeForId(id: number): number {
    const u = (mix32(id, 0x1b0face5) >>> 0) / 0x100000000;
    return Math.max(1, Math.min(this.k, sampleDegree(this.cdf, u)));
  }

  symbolAt(id: number): Symbol {
    const k = this.k;
    const degree = this.sampleDegreeForId(id);
    const idxs = neighbors(id, k, degree);
    const payload = new Uint8Array(this.blockSize);
    for (const i of idxs) xorInplace(payload, this.blocks[i]);
    return { id, degree, neighbors: idxs, payload };
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
  private pending: { neighbors: number[]; payload: Uint8Array; alive: boolean }[] = [];
  private blockToPending: number[][];
  private peelQueue: number[] = [];
  seenIds = new Set<number>();
  resolvedCount = 0;

  constructor(k: number, blockSize: number, originalLen: number) {
    this.k = k;
    this.blockSize = blockSize;
    this.originalLen = originalLen;
    this.blocks = Array.from({ length: k }, () => null);
    this.blockToPending = Array.from({ length: k }, () => []);
  }

  get usefulCount() {
    return this.seenIds.size;
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

    const remaining: number[] = [];
    const payload = new Uint8Array(symbol.payload);
    for (const idx of neigh) {
      if (idx < 0 || idx >= this.k) continue;
      const known = this.blocks[idx];
      if (known) xorInplace(payload, known);
      else remaining.push(idx);
    }
    if (remaining.length === 0) return true;

    const pendingIdx = this.pending.length;
    this.pending.push({ neighbors: remaining, payload, alive: true });
    for (const idx of remaining) this.blockToPending[idx].push(pendingIdx);
    if (remaining.length === 1) this.peelQueue.push(pendingIdx);
    this.peel();
    return true;
  }

  private peel() {
    while (this.peelQueue.length > 0) {
      const pendingIdx = this.peelQueue.pop()!;
      const item = this.pending[pendingIdx];
      if (!item?.alive) continue;

      const remaining: number[] = [];
      for (const idx of item.neighbors) {
        const known = this.blocks[idx];
        if (known) xorInplace(item.payload, known);
        else remaining.push(idx);
      }
      item.neighbors = remaining;

      if (remaining.length === 1) {
        const blockIdx = remaining[0];
        if (!this.blocks[blockIdx]) {
          this.blocks[blockIdx] = new Uint8Array(item.payload);
          this.resolvedCount++;
          item.alive = false;
          for (const otherIdx of this.blockToPending[blockIdx]) {
            if (otherIdx === pendingIdx) continue;
            const other = this.pending[otherIdx];
            if (!other?.alive) continue;
            const pos = other.neighbors.indexOf(blockIdx);
            if (pos < 0) continue;
            xorInplace(other.payload, item.payload);
            other.neighbors.splice(pos, 1);
            if (other.neighbors.length === 1) this.peelQueue.push(otherIdx);
            else if (other.neighbors.length === 0) other.alive = false;
          }
        } else {
          item.alive = false;
        }
      } else if (remaining.length === 0) {
        item.alive = false;
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

/** Expected symbols / k for progressive peeling with fixed robust soliton (~1.15–1.35). */
export const LT_OVERHEAD_FACTOR = 1.25;
