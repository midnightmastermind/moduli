package com.viafluere.moduli.office

import com.meta.spatial.core.Entity
import com.meta.spatial.runtime.ButtonReleaseEventArgs
import com.meta.spatial.runtime.ControllerButton

/**
 * Pointing at a piece of furniture and tapping the trigger (or A / X) selects it — the control panel then shows its
 * menu (Turn, Delete, Settings), and the thumbstick turns it (OfficeActivity.InputSystem). Moving a piece is done with
 * its GrabHandle, so the piece itself is never grabbed and a tap on it is always a select.
 */
object SelectOnTrigger {
  private val SELECT = setOf(
      ControllerButton.RightTrigger, ControllerButton.LeftTrigger, ControllerButton.A, ControllerButton.X,
  )

  fun attach(entity: Entity, onSelect: () -> Unit) {
    entity.registerEventListener<ButtonReleaseEventArgs>(ButtonReleaseEventArgs.EVENT_NAME) { _, args ->
      if (args.button in SELECT) onSelect()
    }
  }
}
