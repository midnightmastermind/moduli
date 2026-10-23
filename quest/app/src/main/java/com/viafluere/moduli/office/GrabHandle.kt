package com.viafluere.moduli.office

import android.net.Uri
import com.meta.spatial.core.Color4
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Vector3
import com.meta.spatial.toolkit.Box
import com.meta.spatial.toolkit.Grabbable
import com.meta.spatial.toolkit.GrabbableType
import com.meta.spatial.toolkit.Material
import com.meta.spatial.toolkit.Mesh
import com.meta.spatial.toolkit.MeshCollision
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
 */
class GrabHandle(val target: Entity, var dy: Float, private val facesHead: Boolean, halfW: Float = 0.16f) {
  val entity: Entity = Entity.create(listOf(
      Mesh(Uri.parse("mesh://box"), hittable = MeshCollision.LineTest),
      Box(Vector3(-halfW, -0.018f, -0.018f), Vector3(halfW, 0.018f, 0.018f)),
      Material().apply { baseColor = Color4(0.93f, 0.93f, 0.97f, 1f); unlit = true },
      Transform(Pose()),
      Grabbable(true, GrabbableType.PIVOT_Y),
  ))

  /** True from the frame a grab is noticed until the frame it ends. */
  var held = false
    private set

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
      val h = entity.tryGetComponent<Transform>()?.transform ?: return started
      val ht = PoseMath.tOf(h)
      val t = floatArrayOf(ht[0], ht[1] - dy, ht[2])
      val q = if (facesHead && head != null) PoseMath.yaw(PoseMath.yawToward(t, PoseMath.tOf(head)) + 180f)
              else PoseMath.upright(PoseMath.qOf(tp))
      target.setComponent(Transform(PoseMath.pose(t, q)))
      return started
    }
    held = false
    val want = PoseMath.pose(
        PoseMath.tOf(tp).let { floatArrayOf(it[0], it[1] + dy, it[2]) },
        PoseMath.upright(PoseMath.qOf(tp)),
    )
    val cur = entity.tryGetComponent<Transform>()?.transform
    if (cur == null || !PoseMath.near(PoseMath.tOf(cur), PoseMath.tOf(want), 0.002f) ||
        !PoseMath.near(PoseMath.qOf(cur), PoseMath.qOf(want), 0.002f)) {
      entity.setComponent(Transform(want))
    }
    return false
  }

  fun destroy() = entity.destroy()
}
