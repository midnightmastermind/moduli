package com.viafluere.moduli.office

import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.meta.spatial.compose.ComposeFeature
import com.meta.spatial.compose.ComposeViewPanelRegistration
import com.meta.spatial.runtime.ButtonBits
import com.meta.spatial.toolkit.Controller
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Query
import com.meta.spatial.core.SpatialFeature
import com.meta.spatial.core.SystemBase
import com.meta.spatial.core.Vector3
import com.meta.spatial.toolkit.AppSystemActivity
import com.meta.spatial.toolkit.DpPerMeterDisplayOptions
import com.meta.spatial.toolkit.Mesh
import com.meta.spatial.toolkit.MeshCollision
import com.meta.spatial.toolkit.Panel
import com.meta.spatial.toolkit.PanelRegistration
import com.meta.spatial.toolkit.PanelStyleOptions
import com.meta.spatial.toolkit.PlayerBodyAttachmentSystem
import com.meta.spatial.toolkit.QuadShapeOptions
import com.meta.spatial.toolkit.Scale
import com.meta.spatial.toolkit.Visible
import com.meta.spatial.toolkit.Transform
import com.meta.spatial.toolkit.TransformParent
import com.meta.spatial.toolkit.UIPanelSettings
import com.meta.spatial.vr.LocomotionSystem
import com.meta.spatial.vr.VRFeature
import org.json.JSONObject
import java.util.UUID
import kotlin.math.atan2

/**
 * The Moduli office on the Quest.
 *
 * The room itself is real (passthrough) and the furniture is anchored to it: every pose is saved relative to the
 * scanned room's floor (RoomAnchor), so it comes back where it was. What the furniture HOLDS comes from Moduli: a
 * floating Moduli panel opens `/?office`, which in this app is the office's control panel (client/src/vr/NativeOffice.jsx).
 * It answers each shelf's query and pictures each screen, sends them here as JSON, and holds every setting — so
 * nothing ever has to leave the headset.
 */
class OfficeActivity : AppSystemActivity() {
  companion object {
    private const val TAG = "ModuliOffice"
    private const val CONTROL_PANEL_ID = 7000
    /** The settings panel is a piece of the room like the furniture (move, turn, resize, push/pull). */
    private const val CONTROL = "control"
    private const val PERMISSION_USE_SCENE = "com.oculus.permission.USE_SCENE"
    private const val REQUEST_USE_SCENE = 1
    private const val CONTROL_W = 1.2f
    private const val CONTROL_H = 0.9f
    private const val READER_W = 1.6f
    private const val READER_H = 1.0f
    /** A piece's own settings window (its ⚙), and the ⚙ button itself. */
    private const val PIECE_W = 0.8f
    private const val PIECE_H = 0.75f
    private const val GEAR_M = 0.09f
    private const val TRASH_W = 0.15f
    /** A piece's menu (bar, ⚙, 🗑) stays up this long after you stop pointing at it, to reach the buttons. */
    private const val MENU_LINGER_MS = 1500L
    /** You are "in" a piece when your head is over its footprint (plus this margin) and lower than its top plus
     *  SEATED_HEAD_M — sitting in a chair or lying on the bed, not standing beside or over it. */
    private const val FOOTPRINT_MARGIN_M = 0.1f
    private const val SEATED_HEAD_M = 0.9f
    /** How far a handle floats above the top of a piece (or below a panel). */
    private const val HANDLE_GAP = 0.12f
    /** Held thumbstick: degrees turned per second, how many times bigger per second, metres pushed per second. */
    private const val TURN_DEG_PER_S = 90f
    private const val GROW_PER_S = 1.6f
    private const val REACH_M_PER_S = 1.5f
    private const val SCALE_MIN = 0.3f
    private const val SCALE_MAX = 3f
  }

  /** One thing in the room: its frame (a model you can grab) and, for shelves and screens, a web panel on its front. */
  class Thing(val key: String, val frame: Entity) {
    var handle: GrabHandle? = null
    /** The piece's height at scale 1 (the model, or its web panel when that stands taller). */
    var top = 1f
    /** A panel's handle hangs below it (its origin is its centre); furniture's floats above. */
    var handleBelow = false
    var scale = 1f
    var lastScale = 1f
    var panel: Entity? = null
    /** Where the panel sits on the piece at scale 1 (height, distance out front). */
    var panelAt = floatArrayOf(0f, 0f)
    /** The ⚙ beside the handle that opens this piece's own settings window. */
    var gear: Entity? = null
    /** The 🗑 beside the ⚙ (none on the fireplace). */
    var trash: Entity? = null
    /** When a controller last pointed at it (the piece or its menu). */
    var lastHover = 0L
    var menuShown = true
    /** The built-in model's name (null for an uploaded model, which has no see-through copy), and its footprint. */
    var model: String? = null
    var hx = 0f
    var hz = 0f
    var ghosted = false
    var web: WebView? = null
    var html: String = ""
    var lastT = FloatArray(3)
    var lastQ = floatArrayOf(1f, 0f, 0f, 0f)
  }

  private lateinit var store: PlacementStore
  private lateinit var room: RoomAnchor
  private val main = Handler(Looper.getMainLooper())
  private var nextPanelId = CONTROL_PANEL_ID + 1
  private var control: WebView? = null
  private var origin = BuildConfig.MODULI_URL
  private var state: JSONObject? = null
  private val things = LinkedHashMap<String, Thing>()
  private val readers = HashMap<Int, Entity>()
  private val readerHandles = HashMap<Int, GrabHandle>()
  /** Open settings windows, by piece key (one per piece; its ⚙ opens and closes it). */
  private val pieceWindows = HashMap<String, Int>()
  /** The piece the thumbstick turns when nothing is held: the last one grabbed, tapped or picked in the panel. */
  private var selected: String? = null
  /** Each model's height (tools/exportModels.mjs writes office/sizes.json), so its handle floats just above it. */
  private val sizes: JSONObject by lazy {
    try { JSONObject(assets.open("office/sizes.json").bufferedReader().readText()) } catch (e: Exception) { JSONObject() }
  }
  private val screenImages = HashMap<String, String>()
  private var sceneReady = false
  private var placed = false

  // ── Features and panels ──────────────────────────────────────────────────
  override fun registerFeatures(): List<SpatialFeature> {
    room = RoomAnchor(this, systemManager)
    return listOf(VRFeature(this), ComposeFeature(), room.feature)
  }

  override fun registerPanels(): List<PanelRegistration> =
      listOf(webPanel(CONTROL_PANEL_ID, CONTROL_W, CONTROL_H, toolbar = false) { web ->
        control = web
        web.loadUrl("$origin/?office")
      })

  /** A panel holding a WebView. `toolbar` adds a Close button above it (reader panels). */
  @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
  private fun webPanel(id: Int, w: Float, h: Float, toolbar: Boolean, onWeb: (WebView) -> Unit): PanelRegistration =
      ComposeViewPanelRegistration(
          id,
          composeViewCreator = { _, ctx ->
            ComposeView(ctx).apply {
              setContent {
                Column(Modifier.fillMaxSize()) {
                  if (toolbar) {
                    Row(Modifier.fillMaxWidth().background(androidx.compose.ui.graphics.Color(0xFF1D1D1D)).padding(6.dp)) {
                      Button(onClick = { closeReader(id) }) { Text("Close") }
                    }
                  }
                  AndroidView(
                      modifier = Modifier.fillMaxSize(),
                      factory = { c ->
                        WebView(c).apply {
                          settings.javaScriptEnabled = true
                          settings.domStorageEnabled = true
                          settings.databaseEnabled = true
                          settings.mediaPlaybackRequiresUserGesture = false
                          setBackgroundColor(Color.TRANSPARENT)
                          webViewClient = WebViewClient()
                          webChromeClient = WebChromeClient()
                          addJavascriptInterface(Bridge(), "ModuliNative")
                          onWeb(this)
                        }
                      },
                  )
                }
              }
            }
          },
          settingsCreator = {
            UIPanelSettings(
                shape = QuadShapeOptions(width = w, height = h),
                style = PanelStyleOptions(themeResourceId = R.style.PanelAppThemeTransparent),
                display = DpPerMeterDisplayOptions(),
            )
          },
      )

  /** Pages (the control panel, shelves, screens) talk to the app through `window.ModuliNative.postMessage`. */
  inner class Bridge {
    @JavascriptInterface
    fun postMessage(json: String) {
      main.post {
        try { onMessage(JSONObject(json)) } catch (e: Exception) { Log.w(TAG, "bad message: ${e.message}") }
      }
    }
  }

  // ── Start-up ─────────────────────────────────────────────────────────────
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    store = PlacementStore(this)
    WebView.setWebContentsDebuggingEnabled(true)
    room.onChange = { onRoomChanged() }
    if (checkSelfPermission(PERMISSION_USE_SCENE) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(PERMISSION_USE_SCENE), REQUEST_USE_SCENE)
    } else room.load()
    systemManager.registerSystem(SaveSystem())
    systemManager.registerSystem(InputSystem())
    // If the room never loads (no scan, permission refused) place things anyway, in the headset's own frame.
    main.postDelayed({ if (!placed) placeAll() }, 4000)
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == REQUEST_USE_SCENE && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) room.load()
  }

  override fun onSceneReady() {
    super.onSceneReady()
    sceneReady = true
    scene.setReferenceSpace(com.meta.spatial.runtime.ReferenceSpace.LOCAL_FLOOR)
    scene.setLightingEnvironment(
        ambientColor = Vector3(0.35f),
        sunColor = Vector3(3.0f, 2.8f, 2.6f),
        sunDirection = -Vector3(1.0f, 3.0f, -2.0f),
        environmentIntensity = 0.4f,
    )
    // The thumbsticks turn and resize furniture here, so the headset's own stick locomotion (snap-turning you, which
    // swung the whole room around) is off — you walk around your real room instead.
    systemManager.findSystem<LocomotionSystem>().enableLocomotion(false)
    applyMode(store.mode)
    // The control panel: where you left it, else floating to the left of where you are looking.
    val t = Thing(CONTROL, Entity.create(listOf(Panel(CONTROL_PANEL_ID), Transform(Pose()))))
    t.top = CONTROL_H / 2f
    t.handleBelow = true
    t.handle = GrabHandle(t.frame, -(t.top + HANDLE_GAP / 2f), facesHead = false, widthScale = 1.3f)
    things[CONTROL] = t
    // Not saved here: a spot saved relative to the room only resolves once the room loads (onRoomChanged restores it).
    if (!restore(t)) t.frame.setComponent(Transform(spawnPose(1.3f, 1.25f, -0.7f, panel = true)))
    t.handle?.follow()
  }

  private fun onRoomChanged() {
    // The room arrived (or changed): put everything back where it was in it.
    if (!placed) placeAll() else for (t in things.values) restore(t)
  }

  // ── Messages from the pages ──────────────────────────────────────────────
  private fun onMessage(m: JSONObject) {
    when (m.optString("type")) {
      "ready" -> { send(JSONObject().put("type", "mode").put("mode", store.mode)) }
      "state" -> onState(m)
      "screenImage" -> {
        val id = m.optString("id"); screenImages[id] = m.optString("image")
        things["screen:$id"]?.let { refreshPanel(it) }
      }
      "select" -> select(m.optString("key"))
      "refreshScreen" -> send(JSONObject().put("type", "refreshScreen").put("id", m.optString("id")))
      "open" -> openReader(m.optString("id"))
      "turn" -> things[m.optString("key")]?.let { turn(it, m.optDouble("deg", 45.0).toFloat()) }
      "delete" -> deleteThing(m.optString("key"))
      "closePiece" -> pieceWindows[m.optString("key")]?.let { closeReader(it) }
      "addDecor" -> addDecor(m)
      "spawn" -> things[m.optString("key")]?.let { putInFront(it) }
      "mode" -> { store.mode = m.optString("mode", "mr"); applyMode(store.mode); send(JSONObject().put("type", "mode").put("mode", store.mode)) }
      "resetLayout" -> { store.clearPoses(); for (t in things.values) putDefault(t) }
    }
  }

  private fun send(ev: JSONObject) {
    control?.evaluateJavascript("window.__moduliNative && window.__moduliNative.onEvent(${JSONObject.quote(ev.toString())})", null)
  }

  private fun onState(m: JSONObject) {
    val gridChanged = store.gridId != m.optString("gridId")
    state = m
    m.optString("origin").takeIf { it.isNotEmpty() }?.let { origin = it }
    if (gridChanged) {
      store.gridId = m.optString("gridId")
      for (k in things.keys.toList()) if (k != CONTROL) deleteEntity(k)
      placed = false
    }
    if (room.resolved || placed) placeAll()
  }

  // ── Building the room's contents ─────────────────────────────────────────
  /** Make every thing the state names, drop the ones it no longer names. */
  private fun placeAll() {
    if (!sceneReady) { main.postDelayed({ placeAll() }, 500); return }
    placed = true
    val st = state
    val wanted = LinkedHashMap<String, () -> Unit>()
    wanted[CONTROL] = {}
    wanted["fireplace"] = { ensureThing("fireplace", "fireplace") }
    if (st != null) {
      val shelves = st.optJSONArray("shelves")
      for (i in 0 until (shelves?.length() ?: 0)) {
        val s = shelves!!.getJSONObject(i)
        wanted["shelf:" + s.optString("id")] = { ensureShelf(s) }
      }
      val screens = st.optJSONArray("screens")
      for (i in 0 until (screens?.length() ?: 0)) {
        val s = screens!!.getJSONObject(i)
        wanted["screen:" + s.optString("id")] = { ensureScreen(s) }
      }
    }
    for (d in store.decor()) {
      val key = d.optString("key")
      wanted[key] = { ensureThing(key, d.optString("model"), d.optString("src").ifEmpty { null }) }
    }
    for (k in things.keys.toList()) if (k !in wanted) deleteEntity(k)
    for (make in wanted.values) make()
  }

  private fun modelUri(model: String, src: String? = null): Uri =
      if (src != null) Uri.parse(if (src.startsWith("http")) src else origin + src) else Uri.parse("apk:///office/$model.glb")

  private fun ensureThing(key: String, model: String, src: String? = null): Thing {
    things[key]?.let { return it }
    val frame = Entity.create(listOf(
        Mesh(modelUri(model, src), hittable = MeshCollision.LineTest),
        Transform(Pose()),
    ))
    val t = Thing(key, frame)
    things[key] = t
    val size = sizes.optJSONObject(if (src != null) "" else model)
    t.top = size?.optDouble("top", 1.0)?.toFloat() ?: 1.0f
    if (src == null && size != null) {
      t.model = model; t.hx = size.optDouble("hx").toFloat(); t.hz = size.optDouble("hz").toFloat()
    }
    t.handle = GrabHandle(frame, t.top + HANDLE_GAP, facesHead = false,
        minY = 0f)
    if (!restore(t)) putDefault(t)
    t.handle?.follow()
    Log.i(TAG, "placed $key (top ${t.top}m, handle ${t.handle?.dy}m up)")
    SelectOnTrigger.attach(frame) { select(key) }
    t.gear = gearButton(t)
    if (key != "fireplace") t.trash = trashButton(t)
    return t
  }

  private fun ensureShelf(s: JSONObject) {
    val asset = s.optString("asset", "book").let { if (it in OfficeSizes.SHELVES) it else "book" }
    val key = "shelf:" + s.optString("id")
    val existing = things[key]
    if (existing != null && existing.html.isNotEmpty() && !existing.html.contains("asset=${JSONObject.quote(asset)}")) deleteEntity(key)
    val t = ensureThing(key, "shelf-$asset")
    val size = OfficeSizes.SHELVES.getValue(asset)
    t.html = PanelHtml.shelf(s, size.rows, size.h)
    attachPanel(t, size.w - 0.06f, size.h + PanelHtml.HEADER_M, (size.h + PanelHtml.HEADER_M) / 2f, size.d / 2f + 0.01f)
  }

  private fun ensureScreen(s: JSONObject) {
    val t = ensureThing("screen:" + s.optString("id"), "screen")
    t.html = PanelHtml.screen(s, screenImages[s.optString("id")])
    attachPanel(t, OfficeSizes.SCREEN_W, OfficeSizes.SCREEN_H, OfficeSizes.SCREEN_Y, 0.025f)
  }

  /** A web panel on the front of `t`'s frame (made once; later only its page changes). */
  private fun attachPanel(t: Thing, w: Float, h: Float, y: Float, z: Float) {
    // The handle has to clear the panel, which can stand taller than the model (a shelf's header).
    t.top = maxOf(t.top, y + h / 2f)
    applyScale(t)
    if (t.panel != null) { refreshPanel(t); return }
    val id = nextPanelId++
    registerPanel(webPanel(id, w, h, toolbar = false) { web ->
      t.web = web
      web.loadDataWithBaseURL(origin, t.html, "text/html", "utf-8", null)
    })
    // A panel shows its face on -z; the furniture's front is +z, so the panel is turned to look out of it.
    t.panelAt = floatArrayOf(y, z)
    t.panel = Entity.create(listOf(
        Panel(id),
        Transform(PoseMath.pose(floatArrayOf(0f, y, z), PoseMath.yaw(180f))),
        TransformParent(t.frame),
    ))

    applyScale(t)
  }

  private fun refreshPanel(t: Thing) {
    if (t.key.startsWith("screen:")) {
      val id = t.key.removePrefix("screen:")
      val s = (0 until (state?.optJSONArray("screens")?.length() ?: 0))
          .map { state!!.getJSONArray("screens").getJSONObject(it) }.firstOrNull { it.optString("id") == id } ?: return
      t.html = PanelHtml.screen(s, screenImages[id])
    }
    t.web?.loadDataWithBaseURL(origin, t.html, "text/html", "utf-8", null)
  }

  private fun deleteEntity(key: String) {
    val t = things.remove(key) ?: return
    if (selected == key) selected = null
    t.handle?.destroy()
    t.panel?.destroy()
    t.gear?.destroy()
    t.trash?.destroy()
    pieceWindows[key]?.let { closeReader(it) }
    t.frame.destroy()
  }

  private fun deleteThing(key: String) {
    if (key == "fireplace" || key == CONTROL) return
    deleteEntity(key)
    store.remove(key)
    if (key.startsWith("decor:")) store.saveDecor(store.decor().filter { it.optString("key") != key })
  }

  private fun addDecor(m: JSONObject) {
    val key = "decor:" + UUID.randomUUID().toString().take(8)
    val model = m.optString("key")
    val entry = JSONObject().put("key", key).put("model", model).put("title", m.optString("title"))
    if (!m.isNull("src")) entry.put("src", m.optString("src"))
    store.saveDecor(store.decor() + entry)
    putInFront(ensureThing(key, model, entry.optString("src").ifEmpty { null }))
    select(key)
  }

  // ── Where things stand ───────────────────────────────────────────────────
  private fun headPose(): Pose? =
      systemManager.tryFindSystem<PlayerBodyAttachmentSystem>()?.tryGetLocalPlayerAvatarBody()?.head
          ?.tryGetComponent<Transform>()?.transform?.takeIf { it != Pose() }

  /**
   * A pose `dist` metres in front of you (at height `y`, shifted `side` metres to your right), turned to face you.
   * Furniture faces you with its front (+z); a panel shows its face on -z, so `panel` turns it the other way.
   */
  private fun spawnPose(dist: Float, y: Float, side: Float = 0f, panel: Boolean = false): Pose {
    val head = headPose() ?: return PoseMath.pose(floatArrayOf(side, y, -dist), PoseMath.yaw(if (panel) 180f else 0f))
    val f = PoseMath.rotate(PoseMath.qOf(head), floatArrayOf(0f, 0f, 1f))
    val len = kotlin.math.sqrt(f[0] * f[0] + f[2] * f[2]).takeIf { it > 1e-3f } ?: 1f
    val fx = f[0] / len; val fz = f[2] / len
    val p = floatArrayOf(head.t.x + fx * dist - fz * side, y, head.t.z + fz * dist + fx * side)
    val toHead = Math.toDegrees(atan2((head.t.x - p[0]).toDouble(), (head.t.z - p[2]).toDouble())).toFloat()
    return PoseMath.pose(p, PoseMath.yaw(if (panel) toHead + 180f else toHead))
  }

  private fun putInFront(t: Thing) {
    if (t.key == CONTROL) return putDefault(t)
    val dist = when {
      t.key == "fireplace" -> 2.6f
      t.key.startsWith("decor:") -> 1.2f
      else -> 1.8f
    }
    t.frame.setComponent(Transform(spawnPose(dist, 0f)))
    t.handle?.follow()
    remember(t, force = true)
  }

  /** Where a thing goes the first time: a spread in front of you, so new pieces do not pile up. */
  private fun putDefault(t: Thing) {
    if (t.key == CONTROL) {
      t.frame.setComponent(Transform(spawnPose(1.3f, 1.25f, -0.7f, panel = true)))
      t.handle?.follow()
      remember(t, force = true)
      return
    }
    val i = things.keys.indexOf(t.key)
    val side = if (t.key == "fireplace") 0f else ((i % 5) - 2) * 1.3f
    val dist = if (t.key == "fireplace") 2.8f else 2.2f
    t.frame.setComponent(Transform(spawnPose(dist, 0f, side)))
    t.handle?.follow()
    remember(t, force = true)
  }

  /** Put `t` where it was saved. False if nothing is saved for it. */
  private fun restore(t: Thing): Boolean {
    val s = store.get(t.key) ?: return false
    val pose = if (s.space == "room") {
      val o = room.originPose() ?: return false
      PoseMath.toWorld(o, s.t, s.q)
    } else PoseMath.pose(s.t, s.q)
    t.frame.setComponent(Transform(pose))
    t.lastT = PoseMath.tOf(pose); t.lastQ = PoseMath.qOf(pose)
    t.scale = s.scale; t.lastScale = s.scale
    applyScale(t)
    return true
  }

  /** Save `t`'s pose if it moved (relative to the room when there is one). */
  private fun remember(t: Thing, force: Boolean = false) {
    val pose = t.frame.tryGetComponent<Transform>()?.transform ?: return
    val tt = PoseMath.tOf(pose); val q = PoseMath.qOf(pose)
    if (!force && PoseMath.near(tt, t.lastT, 0.005f) && PoseMath.near(q, t.lastQ, 0.002f) &&
        kotlin.math.abs(t.scale - t.lastScale) < 0.005f) return
    t.lastT = tt; t.lastQ = q; t.lastScale = t.scale
    val o = room.originPose()
    if (o != null) {
      val (lt, lq) = PoseMath.toLocal(o, pose)
      store.put(t.key, PlacementStore.Stored("room", lt, lq, t.scale))
    } else store.put(t.key, PlacementStore.Stored("world", tt, q, t.scale))
  }

  private fun turn(t: Thing, deg: Float, save: Boolean = true) {
    val pose = t.frame.tryGetComponent<Transform>()?.transform ?: return
    val q = PoseMath.qMul(PoseMath.yaw(deg), PoseMath.upright(PoseMath.qOf(pose)))
    t.frame.setComponent(Transform(PoseMath.pose(PoseMath.tOf(pose), q)))
    t.handle?.follow()
    if (save) remember(t, force = true)
  }

  /** Grow (factor > 1) or shrink `t`, about its base, and save it. */
  private fun resize(t: Thing, factor: Float, save: Boolean = true) {
    t.scale = (t.scale * factor).coerceIn(SCALE_MIN, SCALE_MAX)
    applyScale(t)
    if (save) remember(t, force = true)
  }

  private fun applyScale(t: Thing) {
    t.frame.setComponent(Scale(Vector3(t.scale)))
    // A child does not take its parent's scale, so the web panel on a shelf or screen is scaled and re-seated with it
    // (it stayed full size, floating above a shrunken TV).
    t.panel?.let { p ->
      p.setComponent(Scale(Vector3(t.scale)))
      p.setComponent(Transform(PoseMath.pose(floatArrayOf(0f, t.panelAt[0] * t.scale, t.panelAt[1] * t.scale), PoseMath.yaw(180f))))
    }
    t.handle?.dy = if (t.handleBelow) -(t.top * t.scale + HANDLE_GAP / 2f) else t.top * t.scale + HANDLE_GAP
    t.handle?.follow()
  }

  /** Each controller's ray, as (origin, forward). Forward is +z of the controller's pose, as in Meta's samples. */
  private fun controllerRays(): List<Pair<FloatArray, FloatArray>> =
      Query.where { has(Controller.id) }.eval()
          .filter { it.isLocal() && it.tryGetComponent<Controller>()?.isActive == true }
          .mapNotNull { c ->
            val pose = c.tryGetComponent<Transform>()?.transform ?: return@mapNotNull null
            PoseMath.tOf(pose) to PoseMath.rotate(PoseMath.qOf(pose), floatArrayOf(0f, 0f, 1f))
          }.toList()

  /**
   * Is a ray pointing at `t` or the menu floating above it? Tested in the piece's own frame against one box: its
   * footprint (at least as wide as the menu), from the floor up past the handle. The SDK's hover events never fired
   * for these pieces, so the menu hid for good and the bar could not be grabbed.
   */
  private fun pointsAt(t: Thing, rays: List<Pair<FloatArray, FloatArray>>): Boolean {
    val pose = t.frame.tryGetComponent<Transform>()?.transform ?: return false
    val inv = PoseMath.qConj(PoseMath.qOf(pose)); val p = PoseMath.tOf(pose)
    val s = t.scale
    val hx = maxOf((if (t.hx > 0f) t.hx else 0.5f) * s, 0.5f) + 0.05f
    val hz = maxOf((if (t.hz > 0f) t.hz else 0.5f) * s, 0.08f) + 0.05f
    val top = (t.handle?.dy ?: (t.top * s)) + 0.1f
    val lo = floatArrayOf(-hx, -0.05f, -hz); val hi = floatArrayOf(hx, top, hz)
    for ((o, d) in rays) {
      val lo3 = PoseMath.rotate(inv, floatArrayOf(o[0] - p[0], o[1] - p[1], o[2] - p[2]))
      val ld = PoseMath.rotate(inv, d)
      var tMin = 0f; var tMax = 10f; var hit = true
      for (i in 0..2) {
        if (kotlin.math.abs(ld[i]) < 1e-6f) { if (lo3[i] < lo[i] || lo3[i] > hi[i]) { hit = false; break }; continue }
        var a = (lo[i] - lo3[i]) / ld[i]; var b = (hi[i] - lo3[i]) / ld[i]
        if (a > b) { val x = a; a = b; b = x }
        tMin = maxOf(tMin, a); tMax = minOf(tMax, b)
        if (tMin > tMax) { hit = false; break }
      }
      if (hit) return true
    }
    return false
  }

  /**
   * A piece's bar, ⚙ and 🗑 show only while you point at it (or just did), hold it, or have its settings open — shown
   * all the time they blocked the view of the room. Hidden, the bar cannot be grabbed by accident either.
   */
  private fun showMenus() {
    val now = System.currentTimeMillis()
    val rays = controllerRays()
    for (t in things.values) {
      if (t.key == CONTROL) continue
      // Sitting in a piece puts your controllers inside its box, which reads as pointing at it — no menu then.
      if (!t.ghosted && pointsAt(t, rays)) t.lastHover = now
      val want = !t.ghosted && now - t.lastHover < MENU_LINGER_MS || t.handle?.held == true || t.key in pieceWindows
      if (want == t.menuShown) continue
      t.menuShown = want
      for (e in listOfNotNull(t.handle?.entity, t.gear, t.trash)) e.setComponent(Visible(want))
    }
  }

  /**
   * While you sit (or lie) in a piece it shows its see-through copy, so your own legs show through it instead of
   * the chair being drawn over your lap. The headset's depth occlusion did not apply to these models.
   */
  private fun ghostSeats(head: Pose?) {
    if (head == null) return
    val h = PoseMath.tOf(head)
    for (t in things.values) {
      val model = t.model ?: continue
      val pose = t.frame.tryGetComponent<Transform>()?.transform ?: continue
      val (local, _) = PoseMath.toLocal(pose, head)
      val s = t.scale
      val inside = kotlin.math.abs(local[0]) < t.hx * s + FOOTPRINT_MARGIN_M &&
          kotlin.math.abs(local[2]) < t.hz * s + FOOTPRINT_MARGIN_M &&
          h[1] - pose.t.y < t.top * s + SEATED_HEAD_M
      if (inside == t.ghosted) continue
      t.ghosted = inside
      val name = if (inside) "$model-ghost" else model
      t.frame.setComponent(Mesh(Uri.parse("apk:///office/$name.glb"), hittable = MeshCollision.LineTest))
    }
  }

  private fun select(key: String) {
    selected = key
    if (key == CONTROL) return
    send(JSONObject().put("type", "select").put("key", key))
  }

  /**
   * Every frame: pieces follow their handles. RIGHT thumbstick, held: left / right turns the piece being held (else
   * the selected one); up / down, while carrying, pushes it further away / pulls it closer. LEFT thumbstick, held:
   * up / down grows / shrinks it — size on a stick of its own. All smooth, by how long the stick is held.
   * Read straight from the controllers — per-entity button events never carried the thumbstick on the headset. The
   * pose is saved by SaveSystem, which notices the change, rather than on every frame of a turn.
   */
  inner class InputSystem : SystemBase() {
    private var ran = false
    private var lastNs = 0L
    private var lastError = ""
    override fun execute() {
      if (!ran) { ran = true; Log.i(TAG, "InputSystem running") }
      try { step() } catch (e: Exception) {
        // Log each distinct failure once, so a broken frame shows up without flooding the log.
        val msg = e.toString()
        if (msg != lastError) { lastError = msg; Log.e(TAG, "InputSystem failed", e) }
      }
    }

    private fun step() {
      val head = headPose()
      var held: String? = null
      for (t in things.values) {
        val h = t.handle ?: continue
        if (h.update(head)) { select(t.key); Log.i(TAG, "grabbed ${t.key}") }
        if (h.held) held = t.key
      }
      for (h in readerHandles.values) h.update(head)
      showMenus()
      ghostSeats(head)

      val now = System.nanoTime()
      val dt = if (lastNs == 0L) 0f else ((now - lastNs) / 1e9f).coerceAtMost(0.1f)
      lastNs = now
      var turnDir = 0f
      var growDir = 0f
      var reachDir = 0f
      for (c in Query.where { has(Controller.id) }.eval()) {
        if (!c.isLocal()) continue
        val ctl = c.tryGetComponent<Controller>() ?: continue
        if (!ctl.isActive) continue
        val down = ctl.buttonState
        if (down and ButtonBits.ButtonThumbRL != 0) turnDir += 1f
        if (down and ButtonBits.ButtonThumbRR != 0) turnDir -= 1f
        if (down and ButtonBits.ButtonThumbRU != 0) reachDir += 1f
        if (down and ButtonBits.ButtonThumbRD != 0) reachDir -= 1f
        if (down and ButtonBits.ButtonThumbLU != 0) growDir += 1f
        if (down and ButtonBits.ButtonThumbLD != 0) growDir -= 1f
      }
      if (dt == 0f) return
      if (reachDir != 0f) held?.let { k -> things[k]?.handle?.let { it.reach += reachDir * REACH_M_PER_S * dt } }
      if (turnDir == 0f && growDir == 0f) return
      val target = (held ?: selected)?.let { things[it] } ?: return
      if (turnDir != 0f) turn(target, turnDir * TURN_DEG_PER_S * dt, save = false)
      if (growDir != 0f) resize(target, Math.pow(GROW_PER_S.toDouble(), (growDir * dt).toDouble()).toFloat(), save = false)
    }
  }

  /** Watches for moved furniture (grabbing moves it without telling anyone) and saves it, about twice a second. */
  inner class SaveSystem : SystemBase() {
    private var frames = 0
    override fun execute() {
      if (++frames % 36 != 0) return
      for (t in things.values) remember(t)
    }
  }

  // ── Readers: a page or a file opened from a shelf or a screen ────────────
  private fun openReader(occId: String) {
    val id = nextPanelId++
    val url = if (occId.isEmpty()) "$origin/?local=1" else "$origin/?open=${Uri.encode(occId)}&local=1"
    registerPanel(webPanel(id, READER_W, READER_H, toolbar = true) { web -> web.loadUrl(url) })
    val e = Entity.create(listOf(
        Panel(id),
        Transform(spawnPose(1.1f, 1.45f, 0.3f, panel = true)),
    ))
    readers[id] = e
    readerHandles[id] = GrabHandle(e, -(READER_H / 2f + HANDLE_GAP / 2f), facesHead = true, widthScale = 1.5f).also { it.follow() }
  }

  private fun closeReader(id: Int) {
    main.post {
      pieceWindows.entries.removeAll { it.value == id }
      readerHandles.remove(id)?.destroy(); readers.remove(id)?.destroy()
    }
  }

  // ── Each piece's own settings: a ⚙ beside its handle opens a window for that piece alone ─────────
  /** A small panel holding one ⚙ button, riding just right of `t`'s handle and facing out of the piece's front. */
  private fun gearButton(t: Thing): Entity? {
    val handle = t.handle ?: return null
    val id = nextPanelId++
    registerPanel(ComposeViewPanelRegistration(
        id,
        composeViewCreator = { _, ctx ->
          ComposeView(ctx).apply {
            setContent { Button(onClick = { main.post { togglePiece(t.key) } }, modifier = Modifier.fillMaxSize()) { Text("⚙") } }
          }
        },
        settingsCreator = {
          UIPanelSettings(
              shape = QuadShapeOptions(width = GEAR_M, height = GEAR_M),
              style = PanelStyleOptions(themeResourceId = R.style.PanelAppThemeTransparent),
              display = DpPerMeterDisplayOptions(),
          )
        },
    ))
    return Entity.create(listOf(
        Panel(id),
        Transform(PoseMath.pose(floatArrayOf(0.28f, 0f, 0f), PoseMath.yaw(180f))),
        TransformParent(handle.entity),
    ))
  }

  /**
   * A 🗑 just right of the ⚙. One tap arms it ("Sure?"), a second within 3s deletes the piece — a plain web confirm
   * never showed inside a headset panel, which is why deleting from the settings window did nothing.
   */
  private fun trashButton(t: Thing): Entity? {
    val handle = t.handle ?: return null
    val id = nextPanelId++
    registerPanel(ComposeViewPanelRegistration(
        id,
        composeViewCreator = { _, ctx ->
          ComposeView(ctx).apply {
            setContent {
              var armed by remember { mutableStateOf(false) }
              LaunchedEffect(armed) { if (armed) { kotlinx.coroutines.delay(3000); armed = false } }
              Button(
                  onClick = { if (armed) main.post { removePiece(t.key) } else armed = true },
                  modifier = Modifier.fillMaxSize(),
              ) { Text(if (armed) "Sure?" else "🗑") }
            }
          }
        },
        settingsCreator = {
          UIPanelSettings(
              shape = QuadShapeOptions(width = TRASH_W, height = GEAR_M),
              style = PanelStyleOptions(themeResourceId = R.style.PanelAppThemeTransparent),
              display = DpPerMeterDisplayOptions(),
          )
        },
    ))
    return Entity.create(listOf(
        Panel(id),
        Transform(PoseMath.pose(floatArrayOf(0.28f + GEAR_M / 2f + 0.015f + TRASH_W / 2f, 0f, 0f), PoseMath.yaw(180f))),
        TransformParent(handle.entity),
    ))
  }

  /**
   * Take a piece out of the room. Decor lives on this headset, so it goes here; a shelf or screen is part of the
   * grid's office, so the control panel removes it from there too (else the next state would bring it back).
   */
  private fun removePiece(key: String) {
    if (key.startsWith("shelf:") || key.startsWith("screen:")) send(JSONObject().put("type", "remove").put("key", key))
    deleteThing(key)
  }

  /** Open `key`'s own settings window in front of you, or close it if it is open. */
  private fun togglePiece(key: String) {
    pieceWindows[key]?.let { closeReader(it); return }
    val id = nextPanelId++
    registerPanel(webPanel(id, PIECE_W, PIECE_H, toolbar = true) { web ->
      web.loadUrl("$origin/?office&piece=${Uri.encode(key)}")
    })
    val e = Entity.create(listOf(Panel(id), Transform(spawnPose(1.0f, 1.35f, 0.35f, panel = true))))
    readers[id] = e
    readerHandles[id] = GrabHandle(e, -(PIECE_H / 2f + HANDLE_GAP / 2f), facesHead = true).also { it.follow() }
    pieceWindows[key] = id
    select(key)
  }

  // ── Mixed reality or a VR room built from your room's walls ──────────────
  private fun applyDepth(on: Boolean) {
    if (on) scene.setEnvironmentDepthMode(com.meta.spatial.runtime.EnvironmentDepthMode.OCCLUSION)
    scene.enableEnvironmentDepth(on)
    Log.i(TAG, "environment depth ${if (on) "on (occlusion)" else "off"}")
  }

  private fun applyMode(mode: String) {
    if (!sceneReady) return
    val vr = mode == "vr"
    scene.enablePassthrough(!vr)
    // VR is a log cabin: warm, firelit light. Mixed reality keeps neutral light to match your real room.
    if (vr) scene.setLightingEnvironment(
        ambientColor = Vector3(0.42f, 0.30f, 0.20f),
        sunColor = Vector3(2.2f, 1.6f, 1.1f),
        sunDirection = -Vector3(1.0f, 3.0f, -2.0f),
        environmentIntensity = 0.3f,
    ) else scene.setLightingEnvironment(
        ambientColor = Vector3(0.35f),
        sunColor = Vector3(3.0f, 2.8f, 2.6f),
        sunDirection = -Vector3(1.0f, 3.0f, -2.0f),
        environmentIntensity = 0.4f,
    )
    // Mixed reality: real things nearer than a piece hide it (environment depth), so sitting on a chair shows your
    // own legs in front of it rather than the chair drawn through you. Off in VR — there is no camera view of you.
    // The MODE has to be set before depth is switched on: enabled first, the system logged "not requested mode" and
    // nothing was occluded. Re-applied once the scene has settled, in case the first call came too early.
    applyDepth(!vr)
    main.postDelayed({ if (store.mode == mode) applyDepth(!vr) }, 3000)
    room.showWalls(vr)
  }
}

/** The furniture's sizes, as client/src/vr/decorMakers.js draws them. */
object OfficeSizes {
  data class Shelf(val w: Float, val h: Float, val d: Float, val rows: Int)
  val SHELVES = mapOf(
      "book" to Shelf(1.1f, 1.8f, 0.3f, 5),
      "record" to Shelf(1.15f, 1.15f, 0.36f, 3),
      "vhs" to Shelf(1.0f, 1.3f, 0.24f, 4),
  )
  const val SCREEN_W = 1.6f
  const val SCREEN_H = 0.9f
  const val SCREEN_Y = 1.5f
}
