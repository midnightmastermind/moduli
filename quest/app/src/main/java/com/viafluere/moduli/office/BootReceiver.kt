package com.viafluere.moduli.office

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Opens the office when the Quest has started (user, 2026-10-27: "open it up immediately when quest turns on").
 *
 * Android blocks an app from opening a screen from the background; holding "display over other apps"
 * (SYSTEM_ALERT_WINDOW) is the exception. It is granted once from the PC:
 *   adb shell appops set com.viafluere.moduli.office SYSTEM_ALERT_WINDOW allow
 *
 * Fires on a full start (BOOT_COMPLETED), not when the headset wakes from sleep — waking returns to whatever app was
 * open. TEST_BOOT runs the same path from adb, since the shell may not send BOOT_COMPLETED itself:
 *   adb shell am broadcast -f 0x20 -a com.viafluere.moduli.office.TEST_BOOT -n com.viafluere.moduli.office/.BootReceiver
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    Log.i(TAG, "boot receiver: ${intent.action}")
    val app = context.applicationContext
    val pending = goAsync()
    // Give the headset's home a moment to come up first, or the launch can land under it.
    Handler(Looper.getMainLooper()).postDelayed({
      try {
        app.startActivity(Intent(app, OfficeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        Log.i(TAG, "boot receiver: office started")
      } catch (e: Throwable) {
        Log.e(TAG, "boot receiver: could not start the office", e)
      } finally {
        pending.finish()
      }
    }, DELAY_MS)
  }

  companion object {
    private const val TAG = "ModuliOffice"
    private const val DELAY_MS = 8000L
  }
}
