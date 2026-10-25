package com.viafluere.moduli.office

import android.util.Log
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Query
import com.meta.spatial.core.SystemBase
import com.meta.spatial.toolkit.Mesh
import com.meta.spatial.toolkit.Panel
import com.meta.spatial.toolkit.Scale
import com.meta.spatial.toolkit.Transform
import com.meta.spatial.toolkit.TransformParent

/**
 * Finds what makes the headset throw every frame away (XR_ERROR_POSE_INVALID, a black room).
 *
 * Every pose the app SETS already goes through PoseMath.sane and none was bad, so this looks at what the SDK ends up
 * with: each entity's own pose and scale, and its pose in the room once its parents are applied. A zero or non-finite
 * scale, or a parent stretched unevenly under a turned child, gives a rotation that is not a rotation. The first
 * problem per entity is logged once, named by `describe` (the piece's key, its panel, its model).
 */
class PoseCheck(private val describe: (Entity) -> String) : SystemBase() {
  private val reported = HashSet<Long>()
  private var frames = 0
  private var lastSummaryMs = 0L

  override fun execute() {
    frames++
    // Every frame for the first minute (the black screen starts within seconds), then every 30th.
    if (frames > 5400 && frames % 30 != 0) return
    try { scan() } catch (e: Exception) { if (reported.add(-1L)) Log.e(TAG, "pose check failed", e) }
  }

  private fun scan() {
    var checked = 0
    for (e in Query.where { has(Transform.id) }.eval()) {
      checked++
      if (e.id in reported) continue
      val problem = problemOf(e) ?: continue
      reported.add(e.id)
      Log.w(TAG, "pose check: ${describe(e)} — $problem")
    }
    val now = System.currentTimeMillis()
    if (now - lastSummaryMs > 10_000) { lastSummaryMs = now; Log.i(TAG, "pose check: $checked entities, ${reported.size} reported") }
  }

  /** What is wrong with `e` as the SDK will draw it, or null. */
  private fun problemOf(e: Entity): String? {
    val m = world(e, 0) ?: return "parent chain deeper than 16"
    for (v in m) if (!v.isFinite()) return "world transform not finite: own ${own(e)}"
    val cols = (0 until 3).map { c -> floatArrayOf(m[c], m[3 + c], m[6 + c]) }
    val lens = cols.map { kotlin.math.sqrt(it[0] * it[0] + it[1] * it[1] + it[2] * it[2]) }
    if (lens.any { it < 1e-5f }) return "world scale is zero (${lens}): own ${own(e)}"
    val isPanel = e.tryGetComponent<Panel>() != null
    for (i in 0 until 3) for (j in i + 1 until 3) {
      val d = (cols[i][0] * cols[j][0] + cols[i][1] * cols[j][1] + cols[i][2] * cols[j][2]) / (lens[i] * lens[j])
      if (kotlin.math.abs(d) > 0.01f) return "world rotation skewed (axes $i/$j at ${"%.3f".format(d)})${if (isPanel) " on a PANEL" else ""}: own ${own(e)}"
    }
    return null
  }

  private fun own(e: Entity): String {
    val p = e.tryGetComponent<Transform>()?.transform
    val s = e.tryGetComponent<Scale>()?.scale
    return "t=${p?.let { PoseMath.tOf(it).toList() }} q=${p?.let { PoseMath.qOf(it).toList() }} s=${s?.let { listOf(it.x, it.y, it.z) }}"
  }

  /** Row-major 3x4 [R*S | t] of `e` in the room. */
  private fun world(e: Entity, depth: Int): FloatArray? {
    if (depth > 16) return null
    val local = local(e)
    val parent = e.tryGetComponent<TransformParent>()?.entity ?: return local
    if (parent.id == 0L || parent.id == e.id) return local
    val pm = world(parent, depth + 1) ?: return null
    return mul(pm, local)
  }

  private fun local(e: Entity): FloatArray {
    val p = e.tryGetComponent<Transform>()?.transform
    val q = p?.let { PoseMath.qOf(it) } ?: floatArrayOf(1f, 0f, 0f, 0f)
    val t = p?.let { PoseMath.tOf(it) } ?: floatArrayOf(0f, 0f, 0f)
    val s = e.tryGetComponent<Scale>()?.scale
    val sx = s?.x ?: 1f; val sy = s?.y ?: 1f; val sz = s?.z ?: 1f
    val (w, x, y, z) = q.toList()
    val r = floatArrayOf(
        1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
        2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
        2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
    )
    return floatArrayOf(
        r[0] * sx, r[1] * sy, r[2] * sz, t[0],
        r[3] * sx, r[4] * sy, r[5] * sz, t[1],
        r[6] * sx, r[7] * sy, r[8] * sz, t[2],
    ).let { arrayOf3x3(it) }
  }

  // Stored as 12 floats: 9 of the 3x3 (row-major) then the 3 of the translation.
  private fun arrayOf3x3(m: FloatArray) = floatArrayOf(m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10], m[3], m[7], m[11])

  private fun mul(a: FloatArray, b: FloatArray): FloatArray {
    val out = FloatArray(12)
    for (i in 0 until 3) for (j in 0 until 3) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
    for (i in 0 until 3) out[9 + i] = a[i * 3] * b[9] + a[i * 3 + 1] * b[10] + a[i * 3 + 2] * b[11] + a[9 + i]
    return out
  }

  companion object {
    private const val TAG = "ModuliOffice"
    fun meshName(e: Entity): String? = e.tryGetComponent<Mesh>()?.mesh?.lastPathSegment
    fun panelId(e: Entity): Int? = e.tryGetComponent<Panel>()?.panelRegistrationId
  }
}
