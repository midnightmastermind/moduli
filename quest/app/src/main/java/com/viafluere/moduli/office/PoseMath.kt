package com.viafluere.moduli.office

import com.meta.spatial.core.Pose
import com.meta.spatial.core.Quaternion
import com.meta.spatial.core.Vector3
import kotlin.math.cos
import kotlin.math.sin

/**
 * Pose arithmetic done here on plain numbers (w, x, y, z quaternions), so the "relative to the room" math does not
 * depend on which helpers an SDK version happens to ship.
 */
object PoseMath {
  fun qMul(a: FloatArray, b: FloatArray) = floatArrayOf(
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  )

  fun qConj(q: FloatArray) = floatArrayOf(q[0], -q[1], -q[2], -q[3])

  fun rotate(q: FloatArray, v: FloatArray): FloatArray {
    val r = qMul(qMul(q, floatArrayOf(0f, v[0], v[1], v[2])), qConj(q))
    return floatArrayOf(r[1], r[2], r[3])
  }

  /** A turn of `deg` degrees about the vertical axis. */
  fun yaw(deg: Float): FloatArray {
    val h = Math.toRadians(deg.toDouble()) / 2
    return floatArrayOf(cos(h).toFloat(), 0f, sin(h).toFloat(), 0f)
  }

  fun tOf(p: Pose) = floatArrayOf(p.t.x, p.t.y, p.t.z)
  fun qOf(p: Pose) = floatArrayOf(p.q.w, p.q.x, p.q.y, p.q.z)
  fun pose(t: FloatArray, q: FloatArray) = Pose(Vector3(t[0], t[1], t[2]), Quaternion(q[0], q[1], q[2], q[3]))

  /**
   * A pose the compositor will accept. OpenXR rejects a panel layer whose position is not finite or whose rotation is
   * not a unit quaternion (within ~1%) — and it rejects the WHOLE FRAME (XR_ERROR_POSE_INVALID), which shows as a
   * black screen until the bad pose goes away (2026-10-25: every frame discarded from the moment the room was placed).
   * Non-finite → the origin / no turn; any rotation is normalised. The first bad pose per `what` is logged.
   */
  fun sane(p: Pose, what: String): Pose {
    val t = tOf(p); val q = qOf(p)
    val tOk = t.all { it.isFinite() }
    val n = kotlin.math.sqrt(q.fold(0f) { a, x -> a + x * x })
    val qOk = q.all { it.isFinite() } && n > 1e-6f
    if (tOk && qOk && kotlin.math.abs(n - 1f) < 1e-4f) return p
    if (!tOk || !qOk || kotlin.math.abs(n - 1f) > 0.005f) {
      if (reported.add(what)) android.util.Log.w("ModuliOffice", "bad pose for $what: t=${t.toList()} q=${q.toList()} |q|=$n — fixed")
    }
    return pose(if (tOk) t else floatArrayOf(0f, 0f, 0f), if (qOk) floatArrayOf(q[0] / n, q[1] / n, q[2] / n, q[3] / n) else floatArrayOf(1f, 0f, 0f, 0f))
  }
  private val reported = java.util.Collections.synchronizedSet(HashSet<String>())

  /** `world` expressed in the frame `origin`. */
  fun toLocal(origin: Pose, world: Pose): Pair<FloatArray, FloatArray> {
    val oq = qOf(origin); val inv = qConj(oq)
    val d = tOf(world).let { w -> val o = tOf(origin); floatArrayOf(w[0] - o[0], w[1] - o[1], w[2] - o[2]) }
    return rotate(inv, d) to qMul(inv, qOf(world))
  }

  /** A pose kept in the frame `origin`, back in the world. */
  fun toWorld(origin: Pose, t: FloatArray, q: FloatArray): Pose {
    val oq = qOf(origin); val r = rotate(oq, t); val o = tOf(origin)
    return pose(floatArrayOf(o[0] + r[0], o[1] + r[1], o[2] + r[2]), qMul(oq, q))
  }

  /** Only the turn about the vertical axis of `q` (furniture stands upright). */
  /**
   * The level heading of `q`: its turn about the vertical, tilt dropped. Read off the SIDE axis, not the front: a
   * piece tilted to face down (on the ceiling) has a front pointing at the floor, which has no heading at all, while
   * its side axis stays level under any tilt about it.
   */
  fun upright(q: FloatArray): FloatArray {
    val r = rotate(q, floatArrayOf(1f, 0f, 0f))
    val ang = Math.toDegrees(kotlin.math.atan2(-r[2].toDouble(), r[0].toDouble())).toFloat()
    return yaw(ang)
  }

  /** A tilt of `deg` degrees about the piece's own side-to-side axis (its front goes down for positive `deg`). */
  fun pitch(deg: Float): FloatArray {
    val h = Math.toRadians(deg.toDouble()) / 2
    return floatArrayOf(cos(h).toFloat(), sin(h).toFloat(), 0f, 0f)
  }

  /** The turn (degrees about the vertical) that points +z from `from` toward `to`. */
  fun yawToward(from: FloatArray, to: FloatArray): Float =
      Math.toDegrees(kotlin.math.atan2((to[0] - from[0]).toDouble(), (to[2] - from[2]).toDouble())).toFloat()

  /**
   * Where the ray (o, d) first meets a box — `lo`..`hi` in the frame of `pose` (its position and turn) — as a distance
   * along d, or null when it misses (or the box is more than 10m away). The menus and the shelf books both use it.
   */
  fun rayBox(o: FloatArray, d: FloatArray, pose: Pose, lo: FloatArray, hi: FloatArray): Float? {
    val inv = qConj(qOf(pose)); val p = tOf(pose)
    val lo3 = rotate(inv, floatArrayOf(o[0] - p[0], o[1] - p[1], o[2] - p[2]))
    val ld = rotate(inv, d)
    var tMin = 0f; var tMax = 10f
    for (i in 0..2) {
      if (kotlin.math.abs(ld[i]) < 1e-6f) { if (lo3[i] < lo[i] || lo3[i] > hi[i]) return null; continue }
      var a = (lo[i] - lo3[i]) / ld[i]; var b = (hi[i] - lo3[i]) / ld[i]
      if (a > b) { val x = a; a = b; b = x }
      tMin = maxOf(tMin, a); tMax = minOf(tMax, b)
      if (tMin > tMax) return null
    }
    return tMin
  }

  fun near(a: FloatArray, b: FloatArray, eps: Float) = a.indices.all { kotlin.math.abs(a[it] - b[it]) < eps }
}
