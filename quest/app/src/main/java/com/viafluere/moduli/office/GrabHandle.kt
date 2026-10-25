package com.viafluere.moduli.office

import android.net.Uri
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Vector3
import com.meta.spatial.toolkit.Grabbable
import com.meta.spatial.toolkit.GrabbableType
import com.meta.spatial.toolkit.Mesh
import com.meta.spatial.toolkit.MeshCollision
import com.meta.spatial.toolkit.Scale
import com.meta.spatial.toolkit.Transform

/**
 * A bar you grab to move a piece of furniture (floating above it) or a panel (just below it).
 *
 * The pieces themselves are not grabbable, for two reasons found on the headset: a shelf's or a screen's web panel
 * covers its front and takes the pointer, so only the thin sides could be grabbed; and the SDK's grab turns a held
 * object to face you, which flipped every piece. Here the target only follows the handle's POSITION. Furniture keeps
 * its own turn (the thumbstick changes it); a panel faces you while you carry it.
 *
 * `dy` is how far above the target's origin the handle sits (negative = below, for a panel centred on its origin).
 * `minY`: the lowest the piece's ORIGIN may go, so its lowest visible part stays on or above the floor (carrying
 * pieces below it left them stuck in the floor); null for panels. Above that, anything goes, even mid-air.
 * `reach` pushes the piece further out (or pulls it in) along your line of sight, from the left thumbstick.
 */
class GrabHandle(
    val target: Entity,
    var dy: Float,
    private val facesHead: Boolean,
    widthScale: Float = 1f,
    var minY: Float? = null,
) {
  // The bar is one of the app's own models (tools/exportModels.mjs), drawn the way the furniture is — the SDK's
  // built-in "mesh://box" did not show on the headset. `widthScale` stretches it for the wider panels.
  val entity: Entity = Entity.create(listOf(
      Mesh(Uri.parse("apk:///office/handle.glb"), hittable = MeshCollision.LineTest),
      Scale(Vector3(widthScale, 1f, 1f)),
      Transform(Pose()),
      Grabbable(true, GrabbableType.PIVOT_Y),
  ))

  /** True from the frame a grab is noticed until the frame it ends. */
  var held = false
    private set

  /** Degrees a panel carried facing you is tilted about its side axis (left stick left / right). */
  var tilt = 0f

  /** Metres the piece is pushed beyond (positive) or pulled in from (negative) the handle while held. */
  var reach = 0f

  private val grabbed get() = entity.tryGetComponent<Grabbable>()?.isGrabbed == true

  /**
   * Once a frame. While held, the target is moved under the handle; otherwise the handle is put back over the target
   * (which may have been restored, turned or placed). Returns true on the frame a grab starts.
   */
  fun update(head: Pose?): Boolean {
    val tp = target.tryGetComponent<Transform>()?.transform ?: return false
    if (grabbed) {
      val started = !held
      held = true
      if (started) reach = 0f
      val h = entity.tryGetComponent<Transform>()?.transform ?: return started
      val ht = PoseMath.tOf(h)
      // The bar sits along the piece's own up (a piece on the ceiling has its bar below it, within reach).
      val off = PoseMath.rotate(PoseMath.qOf(tp), floatArrayOf(0f, dy, 0f))
      val y = ht[1] - off[1]
      val t = floatArrayOf(ht[0] - off[0], minY?.let { y.coerceAtLeast(it) } ?: y, ht[2] - off[2])
      if (head != null && reach != 0f) {
        val ex = ht[0] - head.t.x; val ez = ht[2] - head.t.z
        val len = kotlin.math.sqrt(ex * ex + ez * ez)
        if (len > 1e-3f) {
          // Never closer than 40cm to you.
          val r = reach.coerceAtLeast(0.4f - len).also { reach = it }
          t[0] += ex / len * r; t[2] += ez / len * r
        }
      }
      // Furniture keeps its own turn AND tilt (it may hang on the ceiling); a panel faces you, at its own tilt.
      val q = if (facesHead && head != null) PoseMath.qMul(PoseMath.yaw(PoseMath.yawToward(t, PoseMath.tOf(head)) + 180f), PoseMath.pitch(tilt))
              else PoseMath.qOf(tp)
      target.setComponent(Transform(PoseMath.sane(PoseMath.pose(t, q), "GrabHandle:77")))
      return started
    }
    held = false
    follow()
    return false
  }

  /** Put the handle over (or under) the target. Called whenever the target is placed, and every frame it is not held. */
  fun follow() {
    val tp = target.tryGetComponent<Transform>()?.transform ?: return
    val off = PoseMath.rotate(PoseMath.qOf(tp), floatArrayOf(0f, dy, 0f))
    val want = PoseMath.pose(
        PoseMath.tOf(tp).let { floatArrayOf(it[0] + off[0], it[1] + off[1], it[2] + off[2]) },
        PoseMath.upright(PoseMath.qOf(tp)),
    )
    val cur = entity.tryGetComponent<Transform>()?.transform
    if (cur == null || !PoseMath.near(PoseMath.tOf(cur), PoseMath.tOf(want), 0.002f) ||
        !PoseMath.near(PoseMath.qOf(cur), PoseMath.qOf(want), 0.002f)) {
      entity.setComponent(Transform(PoseMath.sane(want, "GrabHandle:95")))
    }
  }

  fun destroy() = entity.destroy()
}
