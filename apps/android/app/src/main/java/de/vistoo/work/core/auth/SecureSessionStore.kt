package de.vistoo.work.core.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Session storage (the Android counterpart of the iOS Keychain entry).
 *
 * The session JSON is encrypted with AES-GCM using a non-exportable key in the
 * Android Keystore; only the ciphertext lands in app-private preferences, which
 * are excluded from backups (res/xml/data_extraction_rules.xml). Tokens are never
 * logged. One entry per Supabase project: environments never share a session.
 */
class SecureSessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("vistoo.secure", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    fun load(storageKey: String): String? {
        val stored = prefs.getString(storageKey, null) ?: return null
        return try {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            val iv = bytes.copyOfRange(0, IV_LENGTH)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(bytes, IV_LENGTH, bytes.size - IV_LENGTH), Charsets.UTF_8)
        } catch (_: Exception) {
            // Key lost (e.g. restored device) or corrupted entry: the session is gone.
            remove(storageKey)
            null
        }
    }

    fun save(storageKey: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        // Synchronous on purpose: the session must be on disk before sign-in reports success.
        prefs.edit(commit = true) { putString(storageKey, Base64.encodeToString(encrypted, Base64.NO_WRAP)) }
    }

    fun remove(storageKey: String) {
        prefs.edit(commit = true) { remove(storageKey) }
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "work.vistoo.session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_LENGTH = 12
    }
}
