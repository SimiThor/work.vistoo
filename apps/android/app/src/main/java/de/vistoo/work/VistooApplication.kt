package de.vistoo.work

import android.app.Application
import de.vistoo.work.core.support.TemporaryFiles

class VistooApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        TemporaryFiles.init(this)
    }
}
