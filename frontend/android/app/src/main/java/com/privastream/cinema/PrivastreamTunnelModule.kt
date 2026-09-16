package com.privastream.cinema

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64

import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

import com.wireguard.android.backend.GoBackend
import com.wireguard.android.backend.Tunnel
import com.wireguard.config.Config
import com.wireguard.config.InetNetwork
import com.wireguard.config.Interface
import com.wireguard.config.Peer
import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyPair

import java.io.ByteArrayInputStream
import java.net.Inet4Address
import java.net.Inet6Address
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.Arrays
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors

import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * V739A_PRIVASTREAM_TUNNEL
 *
 * Native WireGuard bridge for Privastream Cinema.
 *
 * This module is deliberately dormant until JavaScript supplies an
 * authenticated, per-device WireGuard configuration.
 *
 * SECURITY:
 * - No VPN private key is embedded in the APK.
 * - No configuration or key material is logged.
 * - connect() refuses configs that do not exclusively whitelist
 *   com.privastream.cinema via IncludedApplications.
 */
class PrivastreamTunnelModule(
    private val appContext: ReactApplicationContext
) : ReactContextBaseJavaModule(appContext), ActivityEventListener {

    companion object {
        private const val MODULE_NAME =
            "PrivastreamTunnel"

        private const val TUNNEL_NAME =
            "privastream"

        private const val VPN_REQUEST_CODE =
            73901

        // V739B2_DEVICE_IDENTITY
        private const val IDENTITY_PREFS =
            "privastream_tunnel_identity_v1"

        private const val DEVICE_ID_KEY =
            "device_id"

        private const val PRIVATE_KEY_IV_KEY =
            "wg_private_iv"

        private const val PRIVATE_KEY_CIPHERTEXT_KEY =
            "wg_private_ciphertext"

        private const val KEYSTORE_PROVIDER =
            "AndroidKeyStore"

        private const val KEYSTORE_ALIAS =
            "privastream_tunnel_identity_aes_v1"

        // V739B4B_PROVISIONED_CONNECT
        // Public/non-secret server identity pin.
        private const val EXPECTED_APP_PACKAGE =
            "com.privastream.cinema"

        private const val EXPECTED_SERVER_PUBLIC_KEY =
            "3jjiq7KenZnOBPq/C0kxfPNr7oGFNv8ZaZqgWVOXLxU="

        private const val EXPECTED_SERVER_PORT =
            51820
    }

    private val executor =
        Executors.newSingleThreadExecutor()

    @Volatile
    private var tunnelState =
        Tunnel.State.DOWN

    @Volatile
    private var preparePromise: Promise? =
        null

    private val tunnel =
        object : Tunnel {

            override fun getName(): String =
                TUNNEL_NAME

            override fun onStateChange(
                newState: Tunnel.State
            ) {
                tunnelState =
                    newState
            }
        }

    private val backend: GoBackend by lazy {
        GoBackend(
            appContext.applicationContext
        )
    }

    init {
        appContext.addActivityEventListener(
            this
        )
    }

    override fun getName(): String =
        MODULE_NAME


    // ========================================================
    // V739B2_DEVICE_IDENTITY
    //
    // The WireGuard private key is generated natively.
    //
    // It is NEVER:
    // - embedded in the APK
    // - returned to JavaScript
    // - written to logs
    // - sent to the Privastream backend
    //
    // SharedPreferences contains only AES-GCM ciphertext + IV.
    // The wrapping AES key lives in AndroidKeyStore.
    // ========================================================

    private data class ProvisioningIdentity(
        val deviceId: String,
        val publicKey: String
    )

    private data class ProtectedPrivateKey(
        val iv: String,
        val ciphertext: String
    )


    private fun requireIdentityKeystoreSupport() {

        if (
            Build.VERSION.SDK_INT <
            Build.VERSION_CODES.M
        ) {
            throw SecurityException(
                "Privastream tunnel identity requires Android 6.0 or newer."
            )
        }
    }


    private fun getIdentityStorageKey(
        createIfMissing: Boolean
    ): SecretKey {

        requireIdentityKeystoreSupport()

        val keyStore =
            KeyStore.getInstance(
                KEYSTORE_PROVIDER
            )

        keyStore.load(null)

        val existing =
            keyStore.getKey(
                KEYSTORE_ALIAS,
                null
            )

        if (existing != null) {

            if (existing !is SecretKey) {
                throw SecurityException(
                    "Privastream tunnel identity key is invalid."
                )
            }

            return existing
        }

        // Existing ciphertext without its original Keystore key
        // must fail closed. Never silently rotate the identity.
        if (!createIfMissing) {
            throw SecurityException(
                "Privastream tunnel identity key is unavailable."
            )
        }

        val generator =
            KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                KEYSTORE_PROVIDER
            )

        val spec =
            KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or
                    KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(
                    KeyProperties.BLOCK_MODE_GCM
                )
                .setEncryptionPaddings(
                    KeyProperties.ENCRYPTION_PADDING_NONE
                )
                .setRandomizedEncryptionRequired(
                    true
                )
                .build()

        generator.init(spec)

        return generator.generateKey()
    }


    private fun protectPrivateKey(
        privateKeyBytes: ByteArray
    ): ProtectedPrivateKey {

        val storageKey =
            getIdentityStorageKey(
                createIfMissing = true
            )

        val cipher =
            Cipher.getInstance(
                "AES/GCM/NoPadding"
            )

        cipher.init(
            Cipher.ENCRYPT_MODE,
            storageKey
        )

        val encrypted =
            cipher.doFinal(
                privateKeyBytes
            )

        return ProtectedPrivateKey(
            iv = Base64.encodeToString(
                cipher.iv,
                Base64.NO_WRAP
            ),
            ciphertext = Base64.encodeToString(
                encrypted,
                Base64.NO_WRAP
            )
        )
    }


    private fun unprotectPrivateKey(
        ivBase64: String,
        ciphertextBase64: String
    ): ByteArray {

        val storageKey =
            getIdentityStorageKey(
                createIfMissing = false
            )

        val iv =
            Base64.decode(
                ivBase64,
                Base64.NO_WRAP
            )

        val ciphertext =
            Base64.decode(
                ciphertextBase64,
                Base64.NO_WRAP
            )

        if (iv.size != 12) {
            throw SecurityException(
                "Privastream tunnel identity IV is invalid."
            )
        }

        val cipher =
            Cipher.getInstance(
                "AES/GCM/NoPadding"
            )

        cipher.init(
            Cipher.DECRYPT_MODE,
            storageKey,
            GCMParameterSpec(
                128,
                iv
            )
        )

        return cipher.doFinal(
            ciphertext
        )
    }


    private fun validateStoredDeviceId(
        value: String
    ): String {

        val raw =
            value.trim()

        val parsed =
            try {
                UUID.fromString(raw)
            }
            catch (error: IllegalArgumentException) {
                throw SecurityException(
                    "Privastream tunnel device identity is invalid."
                )
            }

        val canonical =
            parsed.toString()

        if (
            canonical !=
            raw.lowercase(Locale.US)
        ) {
            throw SecurityException(
                "Privastream tunnel device identity is invalid."
            )
        }

        return canonical
    }


    private fun loadOrCreateProvisioningIdentity():
        ProvisioningIdentity {

        requireIdentityKeystoreSupport()

        val prefs =
            appContext.getSharedPreferences(
                IDENTITY_PREFS,
                Context.MODE_PRIVATE
            )

        val storedDeviceId =
            prefs.getString(
                DEVICE_ID_KEY,
                null
            )

        val storedIv =
            prefs.getString(
                PRIVATE_KEY_IV_KEY,
                null
            )

        val storedCiphertext =
            prefs.getString(
                PRIVATE_KEY_CIPHERTEXT_KEY,
                null
            )

        val populated =
            listOf(
                storedDeviceId,
                storedIv,
                storedCiphertext
            ).count {
                !it.isNullOrBlank()
            }

        // First use: create one installation identity.
        if (populated == 0) {

            val deviceId =
                UUID.randomUUID()
                    .toString()

            val keyPair =
                KeyPair()

            val privateBytes =
                keyPair.privateKey.bytes

            try {

                val protected =
                    protectPrivateKey(
                        privateBytes
                    )

                val committed =
                    prefs.edit()
                        .putString(
                            DEVICE_ID_KEY,
                            deviceId
                        )
                        .putString(
                            PRIVATE_KEY_IV_KEY,
                            protected.iv
                        )
                        .putString(
                            PRIVATE_KEY_CIPHERTEXT_KEY,
                            protected.ciphertext
                        )
                        .commit()

                if (!committed) {
                    throw IllegalStateException(
                        "Unable to persist Privastream tunnel identity."
                    )
                }

                return ProvisioningIdentity(
                    deviceId = deviceId,
                    publicKey =
                        keyPair.publicKey
                            .toBase64()
                )
            }
            finally {
                Arrays.fill(
                    privateBytes,
                    0.toByte()
                )
            }
        }

        // Partial/corrupt storage must never trigger an implicit
        // replacement identity.
        if (populated != 3) {
            throw SecurityException(
                "Privastream tunnel identity storage is incomplete."
            )
        }

        val deviceId =
            validateStoredDeviceId(
                storedDeviceId!!
            )

        val privateBytes =
            unprotectPrivateKey(
                storedIv!!,
                storedCiphertext!!
            )

        try {

            val privateKey =
                Key.fromBytes(
                    privateBytes
                )

            val keyPair =
                KeyPair(
                    privateKey
                )

            return ProvisioningIdentity(
                deviceId = deviceId,
                publicKey =
                    keyPair.publicKey
                        .toBase64()
            )
        }
        finally {
            Arrays.fill(
                privateBytes,
                0.toByte()
            )
        }
    }


    // ========================================================
    // V739B4B_PROVISIONED_CONNECT
    // ========================================================

    /**
     * Load the existing protected WireGuard identity.
     *
     * This never creates a replacement identity.
     * Raw private-key bytes are zeroed immediately after
     * reconstruction of the native WireGuard KeyPair.
     */
    private fun loadExistingProvisioningKeyPair(): KeyPair {

        requireIdentityKeystoreSupport()

        val prefs =
            appContext.getSharedPreferences(
                IDENTITY_PREFS,
                Context.MODE_PRIVATE
            )

        val storedDeviceId =
            prefs.getString(
                DEVICE_ID_KEY,
                null
            )
                ?: throw SecurityException(
                    "Privastream tunnel device identity is unavailable."
                )

        val storedIv =
            prefs.getString(
                PRIVATE_KEY_IV_KEY,
                null
            )
                ?: throw SecurityException(
                    "Privastream tunnel private-key protection state is unavailable."
                )

        val storedCiphertext =
            prefs.getString(
                PRIVATE_KEY_CIPHERTEXT_KEY,
                null
            )
                ?: throw SecurityException(
                    "Privastream tunnel private-key protection state is unavailable."
                )

        validateStoredDeviceId(
            storedDeviceId
        )

        val privateBytes =
            unprotectPrivateKey(
                storedIv,
                storedCiphertext
            )

        try {

            val privateKey =
                Key.fromBytes(
                    privateBytes
                )

            return KeyPair(
                privateKey
            )
        }
        finally {

            Arrays.fill(
                privateBytes,
                0.toByte()
            )
        }
    }


    /**
     * Enforce the V739 client address pools.
     *
     * IPv4 clients:
     *   10.197.1.1 through 10.197.255.254 as /32.
     *
     * IPv6 clients:
     *   fd73:739:1::/64 as /128.
     *   ::0 through ::ff remain reserved.
     */
    private fun validateProvisionedAddresses(
        wgInterface: Interface
    ) {

        val addresses =
            wgInterface.getAddresses()

        if (addresses.size != 2) {
            throw SecurityException(
                "Privastream tunnel requires exactly one IPv4 and one IPv6 client address."
            )
        }

        var ipv4Count =
            0

        var ipv6Count =
            0

        for (network in addresses) {

            val inetAddress =
                network.getAddress()

            when (inetAddress) {

                is Inet4Address -> {

                    if (network.getMask() != 32) {
                        throw SecurityException(
                            "Privastream IPv4 client address must use /32."
                        )
                    }

                    val bytes =
                        inetAddress.address

                    if (bytes.size != 4) {
                        throw SecurityException(
                            "Privastream IPv4 client address is invalid."
                        )
                    }

                    val octet0 =
                        bytes[0].toInt() and 0xff

                    val octet1 =
                        bytes[1].toInt() and 0xff

                    val octet2 =
                        bytes[2].toInt() and 0xff

                    val octet3 =
                        bytes[3].toInt() and 0xff

                    val hostPart =
                        (octet2 * 256) + octet3

                    if (
                        octet0 != 10 ||
                        octet1 != 197 ||
                        hostPart < 257 ||
                        hostPart > 65534
                    ) {
                        throw SecurityException(
                            "Privastream IPv4 client address is outside the authorized pool."
                        )
                    }

                    ipv4Count +=
                        1
                }


                is Inet6Address -> {

                    if (network.getMask() != 128) {
                        throw SecurityException(
                            "Privastream IPv6 client address must use /128."
                        )
                    }

                    val bytes =
                        inetAddress.address

                    if (bytes.size != 16) {
                        throw SecurityException(
                            "Privastream IPv6 client address is invalid."
                        )
                    }

                    val prefix =
                        byteArrayOf(
                            0xfd.toByte(),
                            0x73.toByte(),
                            0x07.toByte(),
                            0x39.toByte(),
                            0x00.toByte(),
                            0x01.toByte(),
                            0x00.toByte(),
                            0x00.toByte()
                        )

                    for (index in prefix.indices) {

                        if (bytes[index] != prefix[index]) {
                            throw SecurityException(
                                "Privastream IPv6 client address is outside the authorized pool."
                            )
                        }
                    }

                    var infrastructureRange =
                        true

                    for (index in 8..14) {

                        if (bytes[index] != 0.toByte()) {
                            infrastructureRange =
                                false
                            break
                        }
                    }

                    if (infrastructureRange) {
                        throw SecurityException(
                            "Privastream IPv6 client address is inside the reserved infrastructure range."
                        )
                    }

                    ipv6Count +=
                        1
                }


                else -> {
                    throw SecurityException(
                        "Privastream tunnel received an unsupported address family."
                    )
                }
            }
        }

        if (
            ipv4Count != 1 ||
            ipv6Count != 1
        ) {
            throw SecurityException(
                "Privastream tunnel requires one authorized IPv4 and one authorized IPv6 address."
            )
        }
    }


    /**
     * Require full-tunnel IPv4 and IPv6 routing.
     */
    private fun validateProvisionedAllowedIps(
        peer: Peer
    ) {

        val expected =
            setOf(
                InetNetwork.parse(
                    "0.0.0.0/0"
                ),
                InetNetwork.parse(
                    "::/0"
                )
            )

        val actual =
            peer.getAllowedIps()

        if (
            actual.size != 2 ||
            actual != expected
        ) {
            throw SecurityException(
                "Privastream tunnel requires full IPv4 and IPv6 routing."
            )
        }
    }

    /**
     * Return the stable per-installation provisioning identity.
     *
     * Only deviceId + PUBLIC WireGuard key cross the RN bridge.
     */
    @ReactMethod
    fun provisioningIdentity(
        promise: Promise
    ) {

        executor.execute {

            try {

                val identity =
                    loadOrCreateProvisioningIdentity()

                val result =
                    Arguments.createMap()

                result.putString(
                    "deviceId",
                    identity.deviceId
                )

                result.putString(
                    "publicKey",
                    identity.publicKey
                )

                result.putBoolean(
                    "privateKeyProtected",
                    true
                )

                promise.resolve(
                    result
                )
            }
            catch (error: Throwable) {

                promise.reject(
                    "VPN_IDENTITY_FAILED",
                    error.message
                        ?: "Unable to establish Privastream tunnel identity.",
                    error
                )
            }
        }
    }

    /**
     * Ask Android for one-time VPN authorization.
     *
     * Resolves true if VPN permission is granted/already granted,
     * false if the user declines.
     */
    @ReactMethod
    fun prepare(
        promise: Promise
    ) {

        val intent =
            VpnService.prepare(
                appContext
            )

        if (intent == null) {
            promise.resolve(true)
            return
        }

        val activity =
            appContext.currentActivity

        if (activity == null) {
            promise.reject(
                "VPN_NO_ACTIVITY",
                "Privastream Cinema has no foreground activity."
            )
            return
        }

        synchronized(this) {

            if (preparePromise != null) {
                promise.reject(
                    "VPN_PREPARE_BUSY",
                    "A VPN authorization request is already active."
                )
                return
            }

            preparePromise =
                promise
        }

        try {

            activity.startActivityForResult(
                intent,
                VPN_REQUEST_CODE
            )

        }
        catch (error: Throwable) {

            synchronized(this) {
                preparePromise = null
            }

            promise.reject(
                "VPN_PREPARE_FAILED",
                error.message ?: "Unable to request VPN authorization.",
                error
            )
        }
    }


    /**
     * Return authorization and native tunnel state.
     *
     * Does not expose configuration or key material.
     */
    @ReactMethod
    fun status(
        promise: Promise
    ) {

        try {

            val result =
                Arguments.createMap()

            result.putBoolean(
                "authorized",
                VpnService.prepare(
                    appContext
                ) == null
            )

            result.putString(
                "state",
                tunnelState.name.lowercase(
                    Locale.US
                )
            )

            result.putString(
                "packageName",
                appContext.packageName
            )

            result.putBoolean(
                "appOnly",
                true
            )

            promise.resolve(
                result
            )

        }
        catch (error: Throwable) {

            promise.reject(
                "VPN_STATUS_FAILED",
                error.message ?: "Unable to read VPN status.",
                error
            )
        }
    }


    /**
     * Start WireGuard from authenticated provisioning data.
     *
     * Only non-secret fields cross React Native.
     * The private key remains native and protected.
     */
    @ReactMethod
    fun connectProvisioned(
        address: String,
        dns: String,
        serverPublicKey: String,
        endpoint: String,
        allowedIps: String,
        persistentKeepalive: Int,
        appOnlyPackage: String,
        promise: Promise
    ) {

        if (
            VpnService.prepare(
                appContext
            ) != null
        ) {
            promise.reject(
                "VPN_PERMISSION_REQUIRED",
                "Android VPN authorization is required."
            )
            return
        }

        if (
            tunnelState !=
            Tunnel.State.DOWN
        ) {
            promise.reject(
                "VPN_ALREADY_ACTIVE",
                "Privastream tunnel must be down before applying new provisioning."
            )
            return
        }

        executor.execute {

            try {

                if (
                    appContext.packageName !=
                    EXPECTED_APP_PACKAGE ||
                    appOnlyPackage.trim() !=
                    EXPECTED_APP_PACKAGE
                ) {
                    throw SecurityException(
                        "Privastream provisioning package is invalid."
                    )
                }

                if (
                    address.isBlank() ||
                    dns.isBlank() ||
                    serverPublicKey.isBlank() ||
                    endpoint.isBlank() ||
                    allowedIps.isBlank()
                ) {
                    throw SecurityException(
                        "Privastream provisioning data is incomplete."
                    )
                }

                if (
                    serverPublicKey.trim() !=
                    EXPECTED_SERVER_PUBLIC_KEY
                ) {
                    throw SecurityException(
                        "Privastream server WireGuard identity does not match the pinned server key."
                    )
                }

                if (
                    persistentKeepalive < 0 ||
                    persistentKeepalive > 65535
                ) {
                    throw SecurityException(
                        "Privastream persistent keepalive is invalid."
                    )
                }

                val keyPair =
                    loadExistingProvisioningKeyPair()

                val wgInterface =
                    Interface.Builder()
                        .setKeyPair(
                            keyPair
                        )
                        .parseAddresses(
                            address.trim()
                        )
                        .parseDnsServers(
                            dns.trim()
                        )
                        .includeApplication(
                            EXPECTED_APP_PACKAGE
                        )
                        .build()

                validateProvisionedAddresses(
                    wgInterface
                )

                if (
                    wgInterface
                        .getDnsServers()
                        .isEmpty()
                ) {
                    throw SecurityException(
                        "Privastream tunnel requires at least one DNS server."
                    )
                }

                val included =
                    wgInterface
                        .getIncludedApplications()

                val excluded =
                    wgInterface
                        .getExcludedApplications()

                if (
                    included.size != 1 ||
                    !included.contains(
                        EXPECTED_APP_PACKAGE
                    )
                ) {
                    throw SecurityException(
                        "Privastream tunnel must include only Privastream Cinema."
                    )
                }

                if (excluded.isNotEmpty()) {
                    throw SecurityException(
                        "Privastream tunnel may not exclude applications."
                    )
                }

                val peer =
                    Peer.Builder()
                        .parsePublicKey(
                            serverPublicKey.trim()
                        )
                        .parseEndpoint(
                            endpoint.trim()
                        )
                        .parseAllowedIPs(
                            allowedIps.trim()
                        )
                        .setPersistentKeepalive(
                            persistentKeepalive
                        )
                        .build()

                if (
                    peer.getPublicKey()
                        .toBase64() !=
                    EXPECTED_SERVER_PUBLIC_KEY
                ) {
                    throw SecurityException(
                        "Privastream server WireGuard identity validation failed."
                    )
                }

                validateProvisionedAllowedIps(
                    peer
                )

                val parsedEndpoint =
                    peer.getEndpoint()

                if (!parsedEndpoint.isPresent) {
                    throw SecurityException(
                        "Privastream WireGuard endpoint is missing."
                    )
                }

                if (
                    parsedEndpoint
                        .get()
                        .getPort() !=
                    EXPECTED_SERVER_PORT
                ) {
                    throw SecurityException(
                        "Privastream WireGuard endpoint port is invalid."
                    )
                }

                val config =
                    Config.Builder()
                        .setInterface(
                            wgInterface
                        )
                        .addPeer(
                            peer
                        )
                        .build()

                if (config.getPeers().size != 1) {
                    throw SecurityException(
                        "Privastream tunnel must contain exactly one server peer."
                    )
                }

                val state =
                    backend.setState(
                        tunnel,
                        Tunnel.State.UP,
                        config
                    )

                tunnelState =
                    state

                promise.resolve(
                    state.name.lowercase(
                        Locale.US
                    )
                )
            }
            catch (error: Throwable) {

                promise.reject(
                    "VPN_PROVISIONED_CONNECT_FAILED",
                    error.message
                        ?: "Unable to start provisioned Privastream tunnel.",
                    error
                )
            }
        }
    }

    /**
     * Bring up the WireGuard tunnel.
     *
     * The config must contain:
     *
     * IncludedApplications = com.privastream.cinema
     *
     * and it must not contain any excluded applications.
     */
    @ReactMethod
    fun connect(
        configText: String,
        promise: Promise
    ) {

        if (
            VpnService.prepare(
                appContext
            ) != null
        ) {
            promise.reject(
                "VPN_PERMISSION_REQUIRED",
                "Android VPN authorization is required."
            )
            return
        }

        if (configText.isBlank()) {
            promise.reject(
                "VPN_CONFIG_EMPTY",
                "WireGuard configuration is empty."
            )
            return
        }

        executor.execute {

            try {

                val config =
                    Config.parse(
                        ByteArrayInputStream(
                            configText.toByteArray(
                                StandardCharsets.UTF_8
                            )
                        )
                    )

                val wgInterface =
                    config.getInterface()

                val included =
                    wgInterface
                        .getIncludedApplications()

                val excluded =
                    wgInterface
                        .getExcludedApplications()

                val expectedPackage =
                    appContext.packageName

                if (
                    included.size != 1 ||
                    !included.contains(
                        expectedPackage
                    )
                ) {
                    throw SecurityException(
                        "WireGuard IncludedApplications must contain only Privastream Cinema."
                    )
                }

                if (
                    excluded.isNotEmpty()
                ) {
                    throw SecurityException(
                        "WireGuard ExcludedApplications is not permitted."
                    )
                }

                val state =
                    backend.setState(
                        tunnel,
                        Tunnel.State.UP,
                        config
                    )

                tunnelState =
                    state

                promise.resolve(
                    state.name.lowercase(
                        Locale.US
                    )
                )

            }
            catch (error: Throwable) {

                promise.reject(
                    "VPN_CONNECT_FAILED",
                    error.message ?: "Unable to start Privastream tunnel.",
                    error
                )
            }
        }
    }


    /**
     * Bring down the Privastream tunnel.
     */
    @ReactMethod
    fun disconnect(
        promise: Promise
    ) {

        executor.execute {

            try {

                val state =
                    backend.setState(
                        tunnel,
                        Tunnel.State.DOWN,
                        null
                    )

                tunnelState =
                    state

                promise.resolve(
                    state.name.lowercase(
                        Locale.US
                    )
                )

            }
            catch (error: Throwable) {

                promise.reject(
                    "VPN_DISCONNECT_FAILED",
                    error.message ?: "Unable to stop Privastream tunnel.",
                    error
                )
            }
        }
    }


    override fun onActivityResult(
        activity: Activity,
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {

        if (
            requestCode !=
            VPN_REQUEST_CODE
        ) {
            return
        }

        val pending =
            synchronized(this) {

                val value =
                    preparePromise

                preparePromise =
                    null

                value
            }

        pending?.resolve(
            resultCode ==
            Activity.RESULT_OK
        )
    }


    override fun onNewIntent(
        intent: Intent
    ) {
        // No-op.
    }
}
