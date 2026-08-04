/** LBOP/1 frame envelope — mirrors crates/lightbeam-protocol. */
import { crc32 } from "./crc32";

export const MAGIC = new TextEncoder().encode("LBOP");
export const PROTOCOL_VERSION = 1;

export const FrameType = {
  Beacon: 0x01,
  Manifest: 0x02,
  Data: 0x03,
  EndLoop: 0x04,
} as const;
export type FrameType = (typeof FrameType)[keyof typeof FrameType];

export const HEADER_LEN = 38;

function u16be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
}
function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
function u64be(n: number | bigint): Uint8Array {
  const v = BigInt(n);
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) out[i] = Number((v >> BigInt((7 - i) * 8)) & 0xffn);
  return out;
}

export interface Frame {
  version: number;
  frameType: FrameType;
  flags: number;
  sessionId: Uint8Array; // 16
  symbolId: number;
  payload: Uint8Array;
}

export function encodeFrame(frame: Frame): Uint8Array {
  const plen = frame.payload.length;
  if (plen > 0xffff) throw new Error("payload too large");
  const header = new Uint8Array(34);
  header.set(MAGIC, 0);
  header[4] = frame.version;
  header[5] = frame.frameType;
  header.set(u16be(frame.flags), 6);
  header.set(frame.sessionId, 8);
  header.set(u64be(frame.symbolId), 24);
  header.set(u16be(plen), 32);
  const hcrc = u32be(crc32(header));
  const body = new Uint8Array(38 + plen);
  body.set(header, 0);
  body.set(hcrc, 34);
  body.set(frame.payload, 38);
  const fcrc = u32be(crc32(body));
  const out = new Uint8Array(body.length + 4);
  out.set(body, 0);
  out.set(fcrc, body.length);
  return out;
}

export function decodeFrame(data: Uint8Array): Frame {
  if (data.length < HEADER_LEN + 4) throw new Error("truncated");
  if (data[0] !== MAGIC[0] || data[1] !== MAGIC[1] || data[2] !== MAGIC[2] || data[3] !== MAGIC[3]) {
    throw new Error("invalid magic");
  }
  const version = data[4];
  if (version !== PROTOCOL_VERSION) throw new Error("unsupported version");
  const frameType = data[5] as FrameType;
  const flags = (data[6] << 8) | data[7];
  const sessionId = data.slice(8, 24);
  let symbolId = 0;
  for (let i = 0; i < 8; i++) symbolId = symbolId * 256 + data[24 + i];
  const plen = (data[32] << 8) | data[33];
  const expectedH = (data[34] << 24) | (data[35] << 16) | (data[36] << 8) | data[37];
  if (crc32(data.subarray(0, 34)) !== expectedH >>> 0) throw new Error("header crc");
  if (data.length < 38 + plen + 4) throw new Error("truncated");
  const payload = data.slice(38, 38 + plen);
  const body = data.subarray(0, 38 + plen);
  const expectedF =
    ((data[38 + plen] << 24) | (data[38 + plen + 1] << 16) | (data[38 + plen + 2] << 8) | data[38 + plen + 3]) >>> 0;
  if (crc32(body) !== expectedF) throw new Error("frame crc");
  return { version, frameType, flags, sessionId, symbolId, payload };
}

export function encodeDataPayload(degree: number, neighbors: number[], symbolBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + neighbors.length * 2 + symbolBytes.length);
  out.set(u16be(degree), 0);
  out.set(u16be(neighbors.length), 2);
  for (let i = 0; i < neighbors.length; i++) out.set(u16be(neighbors[i]), 4 + i * 2);
  out.set(symbolBytes, 4 + neighbors.length * 2);
  return out;
}

export function decodeDataPayload(data: Uint8Array): { degree: number; neighbors: number[]; symbolBytes: Uint8Array } {
  const degree = (data[0] << 8) | data[1];
  const ncount = (data[2] << 8) | data[3];
  const neighbors: number[] = [];
  for (let i = 0; i < ncount; i++) {
    const off = 4 + i * 2;
    neighbors.push((data[off] << 8) | data[off + 1]);
  }
  return { degree, neighbors, symbolBytes: data.slice(4 + ncount * 2) };
}

export function randomSessionId(): Uint8Array {
  const id = new Uint8Array(16);
  crypto.getRandomValues(id);
  return id;
}

export function sessionShortCode(sessionId: Uint8Array): string {
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(sessionId[i]);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHA[Number(n % 32n)];
    n /= 32n;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data.slice());
  return toHex(new Uint8Array(hash));
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "file";
  const cleaned = [...base].map((c) => (/[<>:"|?*\x00-\x1f]/.test(c) ? "_" : c)).join("");
  if (!cleaned || cleaned === "." || cleaned === "..") return "file.bin";
  return cleaned;
}
