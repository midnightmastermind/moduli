package com.viafluere.moduli.office

import android.os.Handler
import android.util.Log
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Query
import com.meta.spatial.toolkit.Mesh
import com.meta.spatial.toolkit.Panel
import com.meta.spatial.toolkit.Visible
import java.util.concurrent.atomic.AtomicLong

/**
 * Finds what makes the headset reject every frame (XR_ERROR_POSE_INVALID → a black room), on the headset itself.
 *
 * It reads this app's own log for the rejections, and once they start it hides things in halves — panels first, then
 * models — until hiding one thing stops them. That thing stays hidden (so the room shows) and is logged by name.
 */
class FrameBisect(private val main: Handler, private val describe: (Entity) -> String) {
  private val rejected = AtomicLong(0)
  private val hidden = HashMap<Entity, Boolean>()
  private var done = false

  fun start() {
    Thread {
      try {
        Runtime.getRuntime().exec(arrayOf("logcat", "-v", "brief", "-T", "1", "HorizonStandalone:E", "*:S")).inputStream
            .bufferedReader().forEachLine { if ("POSE_INVALID" in it) rejected.incrementAndGet() }
      } catch (e: Exception) { Log.e(TAG, "frame bisect: cannot read the log", e) }
    }.apply { isDaemon = true }.start()
    waitForFailure()
  }

  private fun waitForFailure() {
    measure { failing ->
      if (done) return@measure
      if (failing) { Log.w(TAG, "frame bisect: frames are being rejected — searching"); phase(panels(), "panel", fallback = { phase(meshes(), "model", fallback = { finish(null) }) }) }
      else main.postDelayed({ waitForFailure() }, 500)
    }
  }

  private fun panels() = Query.where { has(Panel.id) }.eval().toList()
  private fun meshes() = Query.where { has(Mesh.id) }.eval().toList()

  /** Hide every candidate; if the rejections stop, the culprit is one of them, so halve until one is left. */
  private fun phase(all: List<Entity>, kind: String, fallback: () -> Unit) {
    Log.i(TAG, "frame bisect: hiding all ${all.size} ${kind}s")
    setHidden(all, true)
    measure { failing ->
      if (failing) { Log.i(TAG, "frame bisect: still rejected with every $kind hidden"); setHidden(all, false); fallback(); return@measure }
      halve(all, kind)
    }
  }

  private fun halve(cands: List<Entity>, kind: String) {
    if (cands.size == 1) { finish(cands[0]); return }
    val a = cands.subList(0, cands.size / 2); val b = cands.subList(cands.size / 2, cands.size)
    setHidden(b, false) // only `a` hidden now
    measure { failing ->
      Log.i(TAG, "frame bisect: ${cands.size} ${kind}s left, ${if (failing) "culprit in the shown half" else "culprit in the hidden half"}")
      if (failing) { setHidden(b, true); setHidden(a, false); halve(b.toList(), kind) } else halve(a.toList(), kind)
    }
  }

  private fun finish(culprit: Entity?) {
    done = true
    // Show everything again except the culprit, which stays hidden so the room is visible.
    for ((e, was) in hidden) if (e != culprit) e.setComponent(Visible(was))
    if (culprit == null) Log.w(TAG, "frame bisect: NOT a panel or a model — hiding them all did not stop the rejections")
    else Log.w(TAG, "frame bisect: CULPRIT ${describe(culprit)} (kept hidden)")
  }

  private fun setHidden(es: List<Entity>, hide: Boolean) {
    for (e in es) {
      if (e !in hidden) hidden[e] = e.tryGetComponent<Visible>()?.isVisible ?: true
      e.setComponent(Visible(if (hide) false else hidden[e]!!))
    }
  }

  /** Let 700ms settle, then count rejections over 600ms. */
  private fun measure(then: (Boolean) -> Unit) {
    main.postDelayed({
      val before = rejected.get()
      main.postDelayed({ try { then(rejected.get() - before > 5) } catch (e: Exception) { Log.e(TAG, "frame bisect failed", e) } }, 600)
    }, 700)
  }

  companion object { private const val TAG = "ModuliOffice" }
}
