import Foundation

/// CRC-32 (IEEE) matching Rust crc32fast and web-encoder.
enum CRC32 {
    private static let table: [UInt32] = {
        (0..<256).map { i -> UInt32 in
            var c = UInt32(i)
            for _ in 0..<8 {
                c = (c & 1) != 0 ? (0xEDB8_8320 ^ (c >> 1)) : (c >> 1)
            }
            return c
        }
    }()

    static func compute(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for byte in data {
            let idx = Int((c ^ UInt32(byte)) & 0xFF)
            c = table[idx] ^ (c >> 8)
        }
        return c ^ 0xFFFF_FFFF
    }
}
