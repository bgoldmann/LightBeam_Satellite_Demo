import CryptoKit
import Foundation
import zlib

enum PayloadProcessor {
    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func decompressIfNeeded(_ data: Data, compression: String) throws -> Data {
        switch compression {
        case "none":
            return data
        case "deflate":
            return try inflateZlib(data)
        default:
            throw SessionDecoderError.unsupportedCompression(compression)
        }
    }

    /// Zlib-wrapped deflate from web encoder `pako.deflate()` (windowBits = 15).
    private static func inflateZlib(_ data: Data) throws -> Data {
        var stream = z_stream()
        var status: Int32 = inflateInit2_(&stream, 15, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        guard status == Z_OK else { throw SessionDecoderError.inflateFailed }

        defer { inflateEnd(&stream) }

        var output = Data()
        let chunkSize = 32_768

        try data.withUnsafeBytes { inputPtr in
            guard let inputBase = inputPtr.baseAddress?.assumingMemoryBound(to: Bytef.self) else {
                throw SessionDecoderError.inflateFailed
            }
            stream.next_in = UnsafeMutablePointer(mutating: inputBase)
            stream.avail_in = uInt(data.count)

            var done = false
            while !done {
                var buffer = [UInt8](repeating: 0, count: chunkSize)
                let produced: Int = buffer.withUnsafeMutableBytes { outPtr in
                    stream.next_out = outPtr.baseAddress?.assumingMemoryBound(to: Bytef.self)
                    stream.avail_out = uInt(chunkSize)
                    status = inflate(&stream, Z_NO_FLUSH)
                    return chunkSize - Int(stream.avail_out)
                }
                if produced > 0 {
                    output.append(buffer, count: produced)
                }
                if status == Z_STREAM_END {
                    done = true
                } else if status != Z_OK {
                    throw SessionDecoderError.inflateFailed
                }
                if stream.avail_in == 0 && produced == 0 {
                    break
                }
            }
        }

        guard !output.isEmpty else { throw SessionDecoderError.inflateFailed }
        return output
    }
}
