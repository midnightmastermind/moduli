package com.viafluere.moduli.office

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Where each thing stands, on this headset. A pose is kept RELATIVE TO THE ROOM (the scanned room's floor anchor)
 * when the room is known, so the furniture is in the same place next time however the headset's tracking origin
 * moved — the browser office kept world poses, which is why everything wandered between visits.
 *
 * Keyed per grid: { "<key>": { "space": "room"|"world", "t": [x,y,z], "q": [w,x,y,z], "s": scale } }.
 * Decor (which the grid does not know about) is kept here too: [{ "key": "decor:<id>", "model": "...", "src", "title" }].
 */
class PlacementStore(context: Context) {
  private val prefs = context.getSharedPreferences("moduli-office", Context.MODE_PRIVATE)
  var gridId: String = ""

  data class Stored(val space: String, val t: FloatArray, val q: FloatArray, val scale: Float = 1f)

  companion object {
    /** Keys kept for the headset, not per grid: the settings panel is where you left it whichever grid is open. */
    val GLOBAL = setOf("control")
    /** The only frame poses are saved in: the boundary-tied STAGE space (OfficeActivity.onSceneReady). */
    const val STAGE = "stage"
  }

  init {
    // Poses saved before STAGE ("room" / "world") were in frames that no longer line up; clear them once.
    if (prefs.getString("frame", null) != STAGE) {
      val e = prefs.edit()
      prefs.all.keys.filter { it.startsWith("poses:") }.forEach { e.remove(it) }
      e.putString("frame", STAGE).apply()
    }
  }

  private fun scope(key: String) = if (key in GLOBAL) "" else gridId
  private fun posesJson(key: String = ""): JSONObject =
      JSONObject(prefs.getString("poses:${scope(key)}", "{}") ?: "{}")

  fun get(key: String): Stored? {
    val o = posesJson(key).optJSONObject(key) ?: return null
    val t = o.optJSONArray("t") ?: return null
    val q = o.optJSONArray("q") ?: return null
    return Stored(
        o.optString("space", "world"),
        FloatArray(3) { t.optDouble(it).toFloat() },
        FloatArray(4) { q.optDouble(it).toFloat() },
        o.optDouble("s", 1.0).toFloat(),
    )
  }

  fun put(key: String, s: Stored) {
    val all = posesJson(key)
    all.put(key, JSONObject()
        .put("space", s.space)
        .put("t", JSONArray(s.t.map { it.toDouble() }))
        .put("q", JSONArray(s.q.map { it.toDouble() }))
        .put("s", s.scale.toDouble()))
    prefs.edit().putString("poses:${scope(key)}", all.toString()).apply()
  }

  fun remove(key: String) {
    val all = posesJson(key); all.remove(key)
    prefs.edit().putString("poses:${scope(key)}", all.toString()).apply()
  }

  /** This grid's placements and decor, as one object — what the app backs up on the grid (meta.vrLayout). */
  fun exportLayout(): JSONObject = JSONObject().put("poses", posesJson()).put("decor", JSONArray(decor()))

  /** True when this headset already holds placements or decor for the grid (then a backup is never restored over it). */
  fun hasLayout(): Boolean = posesJson().length() > 0 || decor().isNotEmpty()

  /** Take a backup's placements and decor as this grid's own. Only poses in the current frame (STAGE) are kept. */
  fun importLayout(layout: JSONObject) {
    val poses = layout.optJSONObject("poses") ?: JSONObject()
    val kept = JSONObject()
    for (k in poses.keys()) poses.optJSONObject(k)?.takeIf { it.optString("space") == STAGE }?.let { kept.put(k, it) }
    prefs.edit()
        .putString("poses:$gridId", kept.toString())
        .putString("decor:$gridId", (layout.optJSONArray("decor") ?: JSONArray()).toString())
        .apply()
  }

  fun clearPoses() { prefs.edit().remove("poses:$gridId").apply() }

  /** True the first time it is asked for `flag` on this grid, false ever after (one-time changes to saved data). */
  fun once(flag: String): Boolean {
    val k = "once:$flag:$gridId"
    if (gridId.isEmpty() || prefs.getBoolean(k, false)) return false
    prefs.edit().putBoolean(k, true).apply()
    return true
  }

  fun decor(): List<JSONObject> {
    val a = JSONArray(prefs.getString("decor:$gridId", "[]") ?: "[]")
    return (0 until a.length()).map { a.getJSONObject(it) }
  }

  fun saveDecor(list: List<JSONObject>) {
    prefs.edit().putString("decor:$gridId", JSONArray(list).toString()).apply()
  }

  /** The pages and books left open, and where: [{ "occ": id, "t": [x,y,z], "q": [w,x,y,z] }] (stage space). */
  fun readers(): List<JSONObject> {
    val a = JSONArray(prefs.getString("readers:$gridId", "[]") ?: "[]")
    return (0 until a.length()).map { a.getJSONObject(it) }
  }

  fun saveReaders(list: List<JSONObject>) {
    if (gridId.isEmpty()) return
    prefs.edit().putString("readers:$gridId", JSONArray(list).toString()).apply()
  }

  var mode: String
    get() = prefs.getString("mode", "mr") ?: "mr"
    set(v) { prefs.edit().putString("mode", v).apply() }
}
