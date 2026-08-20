package com.goldmann.lightbeam.protocol

import android.util.Base64
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer

object PublisherTrust {
    /** key_id → raw 32-byte Ed25519 public key (Phase 1 demo allowlist). */
    private val allowlist = mapOf(
        "cf64d74ed0175771" to hexToBytes(
            "2cad00fc5952f978eee1a9f55ba7e43c1d7ec11baa8f918feac025c0c728568f",
        ),
    )

    fun evaluate(
        publisherKeyId: String?,
        signatureBase64: String?,
        unsignedManifest: Map<String, Any?>,
    ): TrustState {
        if (publisherKeyId.isNullOrBlank()) return TrustState.UnknownPublisher
        if (signatureBase64.isNullOrBlank()) return TrustState.VerificationFailed
        val pub = allowlist[publisherKeyId.lowercase()] ?: return TrustState.UnknownPublisher
        val sig = try {
            Base64.decode(signatureBase64, Base64.DEFAULT)
        } catch (_: Exception) {
            return TrustState.VerificationFailed
        }
        val fields = unsignedManifest.toMutableMap()
        fields["signature"] = null
        val canonical = CanonicalCbor.encode(fields)
        return try {
            val params = Ed25519PublicKeyParameters(pub, 0)
            val signer = Ed25519Signer()
            signer.init(false, params)
            signer.update(canonical, 0, canonical.size)
            if (signer.verifySignature(sig)) TrustState.Verified else TrustState.VerificationFailed
        } catch (_: Exception) {
            TrustState.VerificationFailed
        }
    }

    private fun hexToBytes(hex: String): ByteArray {
        val out = ByteArray(hex.length / 2)
        for (i in out.indices) {
            out[i] = hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
        return out
    }
}
