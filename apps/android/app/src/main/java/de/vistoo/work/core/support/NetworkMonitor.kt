package de.vistoo.work.core.support

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Connectivity state for the offline banner and "back online → resync". */
class NetworkMonitor(context: Context) {
    var isOnline by mutableStateOf(true)
        private set

    /** Incremented whenever the connection comes back (observe to resync). */
    var reconnects by mutableIntStateOf(0)
        private set

    private val main = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(ConnectivityManager::class.java)
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            update(caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
        }

        override fun onLost(network: Network) = update(false)
        override fun onUnavailable() = update(false)
    }

    init {
        val caps = manager?.getNetworkCapabilities(manager.activeNetwork)
        isOnline = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ?: false
        runCatching { manager?.registerDefaultNetworkCallback(callback) }
    }

    private fun update(online: Boolean) {
        main.post {
            if (online && !isOnline) reconnects += 1
            isOnline = online
        }
    }
}
