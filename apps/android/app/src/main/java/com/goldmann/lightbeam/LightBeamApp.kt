package com.goldmann.lightbeam

import android.app.Application
import com.goldmann.lightbeam.data.RecoveredFileStore

class LightBeamApp : Application() {
    lateinit var recoveredFileStore: RecoveredFileStore
        private set

    override fun onCreate() {
        super.onCreate()
        recoveredFileStore = RecoveredFileStore(this)
    }
}
