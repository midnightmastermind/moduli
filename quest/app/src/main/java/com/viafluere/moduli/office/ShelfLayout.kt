package com.viafluere.moduli.office

/**
 * Where each item sits on a shelf — the ONE layout both halves use: the shelf's web panel draws each spine (cover +
 * title) at a slot (PanelHtml.shelf, as percentages of the panel), and the app lays a grabbable 3D book over the same
 * slot (OfficeActivity shelf books, in the shelf's own frame). Two copies of this math would drift, and a book you
 * grab would no longer be the one you were looking at.
 */
object ShelfLayout {
  /**
   * One slot. `x`, `y` are the centre in the shelf's frame (metres, +y up, +z out of its front), `w`, `h` its size;
   * the percentages place the same rectangle on the panel's book area (left/width of the panel's width, bottom/height
   * of the book area's height).
   */
  data class Slot(
      val x: Float, val y: Float, val w: Float, val h: Float,
      val leftPct: Float, val bottomPct: Float, val wPct: Float, val hPct: Float,
  )

  fun perRow(asset: String) = when (asset) { "record" -> 3; "vhs" -> 9; else -> 8 }

  /** The shelf's slots, top row first, left to right. The panel is the shelf's width less its sides (6cm). */
  fun slots(asset: String, size: OfficeSizes.Shelf): List<Slot> {
    val panelW = size.w - 0.06f
    val areaH = size.h
    val per = perRow(asset)
    val pad = 0.03f * panelW
    val slotW = (panelW - 2 * pad) / per
    val rowH = areaH / size.rows
    val tall = rowH * 0.85f
    val (bw, bh) = if (asset == "record") minOf(tall, slotW * 0.9f).let { it to it } else (slotW * 0.8f) to tall
    val out = ArrayList<Slot>()
    for (r in 0 until size.rows) {
      val bottom = areaH - rowH * (r + 1) + rowH * 0.04f
      for (c in 0 until per) {
        val cx = -panelW / 2f + pad + slotW * (c + 0.5f)
        out += Slot(
            cx, bottom + bh / 2f, bw, bh,
            leftPct = (cx - bw / 2f + panelW / 2f) / panelW * 100f,
            bottomPct = bottom / areaH * 100f,
            wPct = bw / panelW * 100f,
            hPct = bh / areaH * 100f,
        )
      }
    }
    return out
  }
}
