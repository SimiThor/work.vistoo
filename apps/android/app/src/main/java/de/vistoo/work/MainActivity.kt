package de.vistoo.work

import android.app.Application
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewModelScope
import de.vistoo.work.core.stores.AppModel
import de.vistoo.work.core.support.AppConfiguration
import de.vistoo.work.ui.app.RootScreen
import de.vistoo.work.ui.theme.VistooTheme
import kotlinx.coroutines.launch

/** Owns the app model across configuration changes (rotation, window resizes). */
class AppViewModel(application: Application) : AndroidViewModel(application) {
    val app = AppModel(application, AppConfiguration.fromBuildConfig(), viewModelScope)

    init {
        viewModelScope.launch { app.start() }
    }
}

/**
 * Single activity. Lifecycle wiring like the iOS RootView: foreground/background
 * (realtime only in the foreground, resync on return), App Links, connectivity.
 */
class MainActivity : ComponentActivity() {
    private val model: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handle(intent)
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                lifecycleScope.launch { model.app.foregroundChanged(true) }
            }

            override fun onStop(owner: LifecycleOwner) {
                lifecycleScope.launch { model.app.foregroundChanged(false) }
            }
        })
        setContent {
            VistooTheme {
                RootScreen(model.app)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        val uri = intent?.data ?: return
        if (intent.action != Intent.ACTION_VIEW) return
        lifecycleScope.launch { model.app.open(uri) }
    }
}
