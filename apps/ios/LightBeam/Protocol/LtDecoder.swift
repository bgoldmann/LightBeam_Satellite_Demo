import Foundation

/// Luby Transform fountain peel decoder — mirrors web-encoder fec.ts.
final class LtDecoder {
    let k: Int
    let blockSize: Int
    let originalLen: Int

    private var blocks: [Data?]
    private var pending: [(neighbors: [Int], payload: Data)] = []
    private(set) var seenIds = Set<UInt64>()

    init(k: Int, blockSize: Int, originalLen: Int) {
        self.k = k
        self.blockSize = blockSize
        self.originalLen = originalLen
        self.blocks = Array(repeating: nil, count: k)
    }

    var usefulCount: Int { seenIds.count }

    var resolvedCount: Int {
        blocks.reduce(0) { $0 + ($1 != nil ? 1 : 0) }
    }

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

        pending.append((neighbors: neighbors, payload: Data(symbol.payload)))
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
        var progressed = true
        while progressed {
            progressed = false
            var i = 0
            while i < pending.count {
                var item = pending[i]
                var j = 0
                while j < item.neighbors.count {
                    let idx = item.neighbors[j]
                    if let known = blocks[idx] {
                        xorInPlace(&item.payload, known)
                        item.neighbors.remove(at: j)
                    } else {
                        j += 1
                    }
                }

                if item.neighbors.count == 1 {
                    let idx = item.neighbors[0]
                    if blocks[idx] == nil {
                        blocks[idx] = item.payload
                        progressed = true
                    }
                    pending.remove(at: i)
                } else if item.neighbors.isEmpty {
                    pending.remove(at: i)
                } else {
                    pending[i] = item
                    i += 1
                }
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
