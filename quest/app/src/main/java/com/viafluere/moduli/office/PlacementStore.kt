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

  private fun posesJson(): JSONObject = JSONObject(prefs.getString("poses:$gridId", "{}") ?: "{}")

  fun get(key: String): Stored? {
    val o = posesJson().optJSONObject(key) ?: return null
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
    val all = posesJson()
    all.put(key, JSONObject()
        .put("space", s.space)
        .put("t", JSONArray(s.t.map { it.toDouble() }))
        .put("q", JSONArray(s.q.map { it.toDouble() }))
        .put("s", s.scale.toDouble()))
    prefs.edit().putString("poses:$gridId", all.toString()).apply()
  }

  fun remove(key: String) {
    val all = posesJson(); all.remove(key)
    prefs.edit().putString("poses:$gridId", all.toString()).apply()
  }

  fun clearPoses() { prefs.edit().remove("poses:$gridId").apply() }

  fun decor(): List<JSONObject> {
    val a = JSONArray(prefs.getString("decor:$gridId", "[]") ?: "[]")
    return (0 until a.length()).map { a.getJSONObject(it) }
  }

  fun saveDecor(list: List<JSONObject>) {
    prefs.edit().putString("decor:$gridId", JSONArray(list).toString()).apply()
  }

  var mode: String
    get() = prefs.getString("mode", "mr") ?: "mr"
    set(v) { prefs.edit().putString("mode", v).apply() }
}
