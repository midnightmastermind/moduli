package com.viafluere.moduli.office

import com.meta.spatial.core.Entity
import com.meta.spatial.runtime.ButtonDownEventArgs
import com.meta.spatial.runtime.ButtonReleaseEventArgs
import com.meta.spatial.runtime.ControllerButton
import com.meta.spatial.toolkit.Transform

/**
 * Pointing at a piece of furniture:
 *  - trigger (or A / X) pressed and released WITHOUT moving it selects it — the control panel then shows its menu
 *    (Turn, Delete, Settings). A press that turns into a grab moves the piece and selects nothing.
 *  - the thumbstick pushed left or right turns it 45°.
 */
object SelectOnTrigger {
  private val SELECT = setOf(
      ControllerButton.RightTrigger, ControllerButton.LeftTrigger, ControllerButton.A, ControllerButton.X,
  )
  private const val MOVED_M = 0.03f

  fun attach(entity: Entity, onTurn: ((Float) -> Unit)? = null, onSelect: () -> Unit) {
    var downAt: FloatArray? = null
    entity.registerEventListener<ButtonDownEventArgs>(ButtonDownEventArgs.EVENT_NAME) { e, args ->
      when (args.button) {
        in SELECT -> downAt = e.tryGetComponent<Transform>()?.transform?.let { PoseMath.tOf(it) }
        ControllerButton.RightThumbLeft, ControllerButton.LeftThumbLeft -> onTurn?.invoke(45f)
        ControllerButton.RightThumbRight, ControllerButton.LeftThumbRight -> onTurn?.invoke(-45f)
        else -> {}
      }
    }
    entity.registerEventListener<ButtonReleaseEventArgs>(ButtonReleaseEventArgs.EVENT_NAME) { e, args ->
      if (args.button !in SELECT) return@registerEventListener
      val start = downAt ?: return@registerEventListener
      downAt = null
      val now = e.tryGetComponent<Transform>()?.transform?.let { PoseMath.tOf(it) } ?: return@registerEventListener
      if (PoseMath.near(start, now, MOVED_M)) onSelect()
    }
  }
}
