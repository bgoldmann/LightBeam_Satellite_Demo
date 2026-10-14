import Foundation

/// Luby Transform fountain peel decoder — O(edges) queue-based peeling.
final class LtDecoder {
    let k: Int
    let blockSize: Int
    /// Truncation length for reconstruct() — must be encoded (post-compression) byte length.
    private(set) var originalLen: Int

    private var blocks: [Data?]
    private var pending: [PendingSymbol] = []
    private var blockToPending: [[Int]] // block index → pending indices that reference it
    private var peelQueue: [Int] = [] // pending indices ready to peel (degree 1)
    private(set) var seenIds = Set<UInt64>()
    private(set) var resolvedCount = 0

    private struct PendingSymbol {
        var neighbors: [Int]
        var payload: Data
        var alive: Bool
    }

    init(k: Int, blockSize: Int, originalLen: Int) {
        self.k = k
        self.blockSize = blockSize
        self.originalLen = originalLen
        self.blocks = Array(repeating: nil, count: k)
        self.blockToPending = Array(repeating: [], count: k)
    }

    /// Correct truncation length once the manifest arrives (encoded_byte_length).
    func setFountainPayloadLength(_ len: Int) {
        guard len > 0 else { return }
        originalLen = len
    }

    var usefulCount: Int { seenIds.count }

    var isComplete: Bool { resolvedCount == k }

    @discardableResult
    func ingest(_ symbol: LTSymbol) -> Bool {
        if seenIds.contains(symbol.id) { return false }
        seenIds.insert(symbol.id)

        let neighbors: [Int]
        if !symbol.neighbors.isEmpty {
            neighbors = symbol.neighbors
        } else {
            neighbors = Self.neighbors(seed: Int(symbol.id), k: k, degree: symbol.degree)
        }

        guard !neighbors.isEmpty, symbol.payload.count == blockSize else { return true }

        // Reduce against already-known blocks immediately.
        var remaining: [Int] = []
        remaining.reserveCapacity(neighbors.count)
        var payload = Data(symbol.payload)
        for idx in neighbors {
            guard idx >= 0, idx < k else { continue }
            if let known = blocks[idx] {
                xorInPlace(&payload, known)
            } else {
                remaining.append(idx)
            }
        }

        if remaining.isEmpty {
            return true
        }

        let pendingIdx = pending.count
        pending.append(PendingSymbol(neighbors: remaining, payload: payload, alive: true))
        for idx in remaining {
            blockToPending[idx].append(pendingIdx)
        }

        if remaining.count == 1 {
            peelQueue.append(pendingIdx)
        }
        peel()
        return true
    }

    func reconstruct() throws -> Data {
        guard isComplete else { throw LtDecoderError.incomplete }
        var out = Data(count: k * blockSize)
        for i in 0..<k {
            guard let block = blocks[i] else { throw LtDecoderError.incomplete }
            out.replaceSubrange(i * blockSize..<(i + 1) * blockSize, with: block)
        }
        return out.prefix(originalLen)
    }

    private func peel() {
        while !peelQueue.isEmpty {
            let pendingIdx = peelQueue.removeLast()
            guard pendingIdx < pending.count else { continue }
            var item = pending[pendingIdx]
            guard item.alive else { continue }

            // Re-reduce in case new blocks arrived while queued.
            var remaining: [Int] = []
            for idx in item.neighbors {
                if blocks[idx] == nil {
                    remaining.append(idx)
                } else if let known = blocks[idx] {
                    xorInPlace(&item.payload, known)
                }
            }
            item.neighbors = remaining

            if remaining.count == 1 {
                let blockIdx = remaining[0]
                if blocks[blockIdx] == nil {
                    blocks[blockIdx] = item.payload
                    resolvedCount += 1
                    item.alive = false
                    pending[pendingIdx] = item

                    // Propagate to other pending symbols that reference this block.
                    for otherIdx in blockToPending[blockIdx] {
                        guard otherIdx != pendingIdx, otherIdx < pending.count else { continue }
                        var other = pending[otherIdx]
                        guard other.alive else { continue }
                        if let pos = other.neighbors.firstIndex(of: blockIdx) {
                            xorInPlace(&other.payload, item.payload)
                            other.neighbors.remove(at: pos)
                            pending[otherIdx] = other
                            if other.neighbors.count == 1 {
                                peelQueue.append(otherIdx)
                            } else if other.neighbors.isEmpty {
                                other.alive = false
                                pending[otherIdx] = other
                            }
                        }
                    }
                } else {
                    item.alive = false
                    pending[pendingIdx] = item
                }
            } else if remaining.isEmpty {
                item.alive = false
                pending[pendingIdx] = item
            } else {
                pending[pendingIdx] = item
            }
        }
    }

    private func xorInPlace(_ dst: inout Data, _ src: Data) {
        dst.withUnsafeMutableBytes { dstPtr in
            src.withUnsafeBytes { srcPtr in
                let d = dstPtr.bindMemory(to: UInt8.self)
                let s = srcPtr.bindMemory(to: UInt8.self)
                for i in 0..<min(d.count, s.count) {
                    d[i] ^= s[i]
                }
            }
        }
    }

    /// Hash-mixed neighbor selection (fallback when wire omits neighbors).
    static func neighbors(seed: Int, k: Int, degree: Int) -> [Int] {
        func mix32(_ a: Int, _ b: Int) -> UInt32 {
            var h = UInt32(bitPattern: Int32(truncatingIfNeeded: a ^ b)) &* 0x85EB_CA6B
            h ^= h >> 13
            h &*= 0xC2B2_AE35
            h ^= h >> 16
            return h
        }
        let want = min(degree, k)
        var chosen = Set<Int>()
        var attempt = 0
        while chosen.count < want && attempt < k * 32 {
            let h = mix32(seed ^ ((attempt + 1) &* -1_647_531_527), k) // 0x9e3779b9
            chosen.insert(Int(h % UInt32(k)))
            attempt += 1
        }
        var i = 0
        while chosen.count < want && i < k {
            chosen.insert(i)
            i += 1
        }
        return chosen.sorted()
    }
}

enum LtDecoderError: LocalizedError {
    case incomplete

    var errorDescription: String? {
        switch self {
        case .incomplete: return "LT reconstruction incomplete"
        }
    }
}
