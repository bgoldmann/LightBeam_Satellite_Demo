import Foundation

/// LT data frame payload: degree, neighbors, symbol bytes.
struct DataPayload {
    let degree: Int
    let neighbors: [Int]
    let symbolBytes: Data

    static func decode(_ data: Data) throws -> DataPayload {
        guard data.count >= 4 else { throw LBOPError.truncated }
        let degree = Int(u16be(data, 0))
        let neighborCount = Int(u16be(data, 2))
        let headerLen = 4 + neighborCount * 2
        guard data.count >= headerLen else { throw LBOPError.truncated }

        var neighbors: [Int] = []
        neighbors.reserveCapacity(neighborCount)
        for i in 0..<neighborCount {
            let offset = 4 + i * 2
            neighbors.append(Int(u16be(data, offset)))
        }

        return DataPayload(
            degree: degree,
            neighbors: neighbors,
            symbolBytes: data.subdata(in: headerLen..<data.count)
        )
    }

    private static func u16be(_ data: Data, _ offset: Int) -> UInt16 {
        (UInt16(data[offset]) << 8) | UInt16(data[offset + 1])
    }
}

struct LTSymbol {
    let id: UInt64
    let degree: Int
    let neighbors: [Int]
    let payload: Data
}
