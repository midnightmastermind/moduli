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
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.ui.unit.sp
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
import com.meta.spatial.toolkit.Grabbable
import com.meta.spatial.toolkit.GrabbableType
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
    private const val GHOST_W = 0.30f
    private const val SPOTIFY_W = 0.56f
    private const val SPOTIFY_H = 0.26f
    private const val GHOST_H = 0.075f
    /** A piece's own settings window (its ⚙), and the ⚙ button itself. */
    private const val PIECE_W = 0.8f
    private const val PIECE_H = 0.75f
    private const val GEAR_M = 0.09f
    private const val TRASH_W = 0.15f
    /** A shelf book: its grab block's depth, the depth of the book in your hand, how far off the shelf counts as
     *  taking it (then letting go opens it), and how short a grab counts as a tap (which opens it too). */
    private const val BOOK_PROXY_DEPTH = 0.03f
    private const val BOOK_DEPTH = 0.16f
    private const val BOOK_PULL_M = 0.12f
    private const val BOOK_TAP_MS = 350L
    /** The cover-and-title card over a held item, and how many (one per hand). */
    private const val CARD_W = 0.16f
    private const val CARD_H = 0.22f
    private const val CARD_COUNT = 2
    private const val LAYOUT_BACKUP_MS = 5000L
    /** How near a record player / VHS player you must let go of a record / tape for it to play there. */
    private const val PLAYER_DROP_M = 0.5f
    /** A piece's menu (bar, ⚙, 🗑) stays up this long after you point at nothing. The menu is inside the pointing
     *  box, so reaching the buttons needs no linger; 1.5s felt far too slow to go away. */
    private const val MENU_LINGER_MS = 300L
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
    /** A shelf's grabbable books (the current page), its slots, what it holds and which page it shows. */
    val books = ArrayList<Book>()
    var slots: List<ShelfLayout.Slot> = emptyList()
    var shelfItems: org.json.JSONArray = org.json.JSONArray()
    var page = 0
    var shelfSize: OfficeSizes.Shelf? = null
    /** "book" | "record" | "vhs": what you hold when you take something off this shelf. */
    var shelfAsset = "book"
    /** Select mode on a shelf (its Select button): a tap picks a book for Delete instead of opening it. */
    var selecting = false
    /** The book a controller is pointing at on this shelf (its spine lights up), or null. */
    var hoverBook: String? = null
    /** A decor piece's own entry (model, and a VHS player's screenId), and the base its panel page loads against
     *  (null = the Moduli origin; the window's view is an app asset). */
    var decorEntry: JSONObject? = null
    var panelBase: String? = null
    /** A panel that is a live web page (the grid screen) rather than HTML the app writes. */
    var panelUrl: String? = null
    /** A browser screen: its panel has an address bar and back / forward / reload. */
    var browser = false
    /** A screen running a tape (its picture is not put back until ⏹). */
    var videoPlaying = false
    /** The 🗑 beside the ⚙ (none on the fireplace). */
    var trash: Entity? = null
    /** When a controller last pointed at it (the piece or its menu). */
    var lastHover = 0L
    var menuShown = true
    /** The built-in model's name (null for an uploaded model, which has no see-through copy), and its footprint. */
    var model: String? = null
    var hx = 0f
    var hz = 0f
    /** The model's lowest visible point above its origin (the TV's frame starts ~1m up). */
    var bottom = 0f
    var ghosted = false
    var web: WebView? = null
    var html: String = ""
    var lastT = FloatArray(3)
    var lastQ = floatArrayOf(1f, 0f, 0f, 0f)
  }

  /**
   * One book you can take off a shelf: an invisible block over its spine, which becomes a solid book while held.
   * `slot` is where it rests, in the shelf's frame.
   */
  class Book(val itemId: String, val title: String, val cover: String, val slot: ShelfLayout.Slot, val color: Int, val entity: Entity) {
    /** A folder book opens the folder on the shelf; a bookmark opens its page in a browser window. */
    var folder = false
    var url = ""
    var held = false
    /** The card (cover + title) floating over it while held: an index into `cards`, or -1. */
    var card = -1
    var grabbedAt = 0L
    var placedScale = -1f
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
  /** Each reader window's page (a drag carried into it asks the page where it landed). */
  private val readerWebs = HashMap<Int, WebView>()
  /** What each open reader shows (books and pages, not settings windows) — saved, so they are there next time. */
  private val readerOcc = HashMap<Int, String>()
  private var lastReadersSaved = ""
  /** The grid whose open readers have been put back (once per grid, after the room is built). */
  private var readersRestoredFor = ""
  private val readerHandles = HashMap<Int, GrabHandle>()
  /** The web window last pressed: a physical keyboard's keys reach the activity's own window, never a panel's. */
  private var keyTarget: WebView? = null
  /** Open settings windows, by piece key (one per piece; its ⚙ opens and closes it). */
  private val pieceWindows = HashMap<String, Int>()
  /**
   * Furniture moves only in "Move furniture" mode (the main panel's switch; off at every start). Off, no piece shows
   * its bar, ⚙ or 🗑 and none can be grabbed — so reaching for a book never moves the shelf.
   */
  private var moveMode = false
  /** Each model's height (tools/exportModels.mjs writes office/sizes.json), so its handle floats just above it. */
  private val sizes: JSONObject by lazy {
    try { JSONObject(assets.open("office/sizes.json").bufferedReader().readText()) } catch (e: Exception) { JSONObject() }
  }
  private val screenImages = HashMap<String, String>()
  /** The bookmarks bar every browser screen shows: the Bookmarks board's first ones, (title, url). */
  private val bookmarkBar = androidx.compose.runtime.mutableStateListOf<Pair<String, String>>()
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

  /** A panel holding a WebView. `toolbar` adds Close and Reload above it (reader panels). */
  @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
  private fun webPanel(id: Int, w: Float, h: Float, toolbar: Boolean, onWeb: (WebView) -> Unit): PanelRegistration =
      ComposeViewPanelRegistration(
          id,
          composeViewCreator = { _, ctx ->
            var made: WebView? = null
            ComposeView(ctx).apply {
              setContent {
                Column(Modifier.fillMaxSize()) {
                  if (toolbar) {
                    Row(Modifier.fillMaxWidth().background(androidx.compose.ui.graphics.Color(0xFF1D1D1D)).padding(6.dp)) {
                      Button(onClick = { closeReader(id) }) { Text("Close") }
                      Button(onClick = { made?.reload() }, modifier = Modifier.padding(start = 6.dp)) { Text("⟳ Reload") }
                    }
                  }
                  AndroidView(
                      modifier = Modifier.fillMaxSize(),
                      factory = { c ->
                        WebView(c).apply {
                          // MATCH_PARENT, not the default WRAP_CONTENT: with wrap-content the page's viewport is 0px
                          // tall, so every vh size (heights, fonts, spines) was 0 and the shelves looked empty.
                          layoutParams = android.view.ViewGroup.LayoutParams(
                              android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                              android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                          )
                          settings.javaScriptEnabled = true
                          // Let spine titles go below the 8px default floor (they are meant to be tiny).
                          settings.minimumFontSize = 1
                          settings.minimumLogicalFontSize = 1
                          settings.domStorageEnabled = true
                          settings.databaseEnabled = true
                          settings.mediaPlaybackRequiresUserGesture = false
                          setBackgroundColor(Color.TRANSPARENT)
                          // A held trigger is a long press: it opened the page's menu and cancelled every drag.
                          isLongClickable = false; isHapticFeedbackEnabled = false; setOnLongClickListener { true }
                          // Typing: Android ignored the keyboard for these windows ("showSoftInput … WebView is not
                          // served") — a label editor opened and took no keys. A press asks for focus first.
                          isFocusable = true; isFocusableInTouchMode = true
                          setOnTouchListener { v, ev ->
                            if (ev.actionMasked == android.view.MotionEvent.ACTION_DOWN) { keyTarget = v as? WebView; if (!v.hasFocus()) v.requestFocus() }
                            false
                          }
                          webViewClient = WebViewClient()
                          // Spotify's embedded player (a record with no audio file of its own): it runs in an iframe, needs
                          // the spotify.com sign-in cookie (a third-party cookie here) and protected media for full tracks.
                          android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                          webChromeClient = object : WebChromeClient() {
                            override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                              val ok = request.resources.filter { it == android.webkit.PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }
                              if (ok.isNotEmpty()) request.grant(ok.toTypedArray()) else request.deny()
                            }
                          }
                          addJavascriptInterface(Bridge(id), "ModuliNative")
                          made = this
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

  /** What a typed address means: a url as it is (https added when missing), anything else a web search. */
  private fun addressToUrl(text: String): String {
    val a = text.trim()
    if (a.isEmpty()) return "https://www.google.com"
    if (Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE).containsMatchIn(a)) return a
    if (!a.contains(' ') && a.contains('.')) return "https://$a"
    return "https://www.google.com/search?q=" + Uri.encode(a)
  }

  /** A browser screen's panel: back / forward / reload and an address bar over a real WebView (no frame — most sites
   *  refuse to be shown in one). The page it is on is kept on the decor entry, so it reopens there. */
  @SuppressLint("SetJavaScriptEnabled")
  private fun browserPanel(id: Int, w: Float, h: Float, t: Thing, onClose: (() -> Unit)? = null): PanelRegistration =
      ComposeViewPanelRegistration(
          id,
          composeViewCreator = { _, ctx ->
            ComposeView(ctx).apply {
              setContent {
                var address by remember { mutableStateOf(t.panelUrl ?: "") }
                var web by remember { mutableStateOf<WebView?>(null) }
                Column(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0xFF1D1D1D))) {
                  Row(Modifier.fillMaxWidth().padding(6.dp)) {
                    if (onClose != null) Button(onClick = onClose) { Text("Close") }
                    Button(onClick = { web?.let { if (it.canGoBack()) it.goBack() } }) { Text("◀") }
                    Button(onClick = { web?.let { if (it.canGoForward()) it.goForward() } }) { Text("▶") }
                    Button(onClick = { web?.reload() }) { Text("⟳") }
                    androidx.compose.material3.OutlinedTextField(
                        value = address,
                        onValueChange = { address = it },
                        singleLine = true,
                        modifier = Modifier.weight(1f).padding(horizontal = 6.dp),
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Go),
                        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onGo = { web?.loadUrl(addressToUrl(address)) }),
                    )
                    Button(onClick = { web?.loadUrl(addressToUrl(address)) }) { Text("Go") }
                    // ☆ saves this page to the Bookmarks board (the control panel writes it), ★ when it is there.
                    val saved = bookmarkBar.any { it.second == address }
                    Button(onClick = {
                      val w = web ?: return@Button
                      if (!saved) send(JSONObject().put("type", "saveBookmark").put("url", w.url ?: address).put("title", w.title ?: ""))
                    }) { Text(if (saved) "★" else "☆") }
                  }
                  // The bookmarks bar, under the address bar like any browser's.
                  Row(Modifier.fillMaxWidth().horizontalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 6.dp)) {
                    for ((title, url) in bookmarkBar) {
                      androidx.compose.material3.TextButton(onClick = { web?.loadUrl(url) }) {
                        Text(title.ifEmpty { url }.take(24), maxLines = 1)
                      }
                    }
                  }
                  AndroidView(
                      modifier = Modifier.fillMaxSize(),
                      factory = { c ->
                        WebView(c).apply {
                          layoutParams = android.view.ViewGroup.LayoutParams(
                              android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                              android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                          )
                          settings.javaScriptEnabled = true
                          settings.domStorageEnabled = true
                          settings.databaseEnabled = true
                          settings.mediaPlaybackRequiresUserGesture = false
                          settings.loadWithOverviewMode = true
                          settings.useWideViewPort = true
                          // Present as ordinary Chrome: Google (and sites signing in through it) refuse an embedded
                          // WebView by its "; wv" marker. Cookies persist, so a sign-in lasts between visits.
                          settings.userAgentString = settings.userAgentString.replace("; wv", "")
                          android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                          webChromeClient = WebChromeClient()
                          webViewClient = object : WebViewClient() {
                            override fun onPageFinished(view: WebView, url: String) {
                              address = url
                              main.post { rememberBrowserUrl(t, url) }
                            }
                          }
                          t.web = this
                          web = this
                          loadUrl(t.panelUrl ?: "https://www.google.com")
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

  /** Keep a browser screen's page on its decor entry (so it reopens there). */
  private fun rememberBrowserUrl(t: Thing, url: String) {
    if (url.isEmpty() || url.startsWith("about:")) return
    t.panelUrl = url
    // A bookmark's browser window reopens on the page it is on.
    if (t.key.startsWith("reader:")) {
      t.key.removePrefix("reader:").toIntOrNull()?.let { id -> if (readerOcc.containsKey(id)) { readerOcc[id] = "url:$url"; saveReaders() } }
      return
    }
    if (!t.key.startsWith("decor:")) return
    store.saveDecor(store.decor().map { e -> if (e.optString("key") == t.key) JSONObject(e.toString()).put("url", url) else e })
  }

  /** Pages (the control panel, shelves, screens) talk to the app through `window.ModuliNative.postMessage`. */
  inner class Bridge(private val panelId: Int) {
    @JavascriptInterface
    fun postMessage(json: String) {
      main.post {
        // Each message says which panel sent it (a drag started in one reader window is dropped in another).
        try { onMessage(JSONObject(json).put("_panel", panelId)) } catch (e: Exception) { Log.w(TAG, "bad message: ${e.message}") }
      }
    }
  }

  // ── Start-up ─────────────────────────────────────────────────────────────
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    store = PlacementStore(this)
    WebView.setWebContentsDebuggingEnabled(true)
    // The room scan is only for the VR cabin's walls; placement does not wait for it (see onSceneReady: STAGE).
    if (checkSelfPermission(PERMISSION_USE_SCENE) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(PERMISSION_USE_SCENE), REQUEST_USE_SCENE)
    } else room.load()
    systemManager.registerSystem(SaveSystem())
    systemManager.registerSystem(InputSystem())
    systemManager.registerSystem(PoseCheck(::describeEntity))
    FrameBisect(main, ::describeEntity).start()
    main.postDelayed({ if (!placed) placeAll() }, 1500)
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == REQUEST_USE_SCENE && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) room.load()
  }

  override fun onSceneReady() {
    super.onSceneReady()
    sceneReady = true
    // STAGE: coordinates tied to the headset's boundary, the same every session (until the boundary is redrawn),
    // so a saved pose comes back where it was. LOCAL_FLOOR starts wherever the app was opened, which moved the whole
    // room on every start; the room scan that was meant to anchor it was found on one start and missing on the next.
    scene.setReferenceSpace(com.meta.spatial.runtime.ReferenceSpace.STAGE)
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
    if (!restore(t)) putDefault(t)
    t.handle?.follow()
    makeCards()
  }

  // ── Messages from the pages ──────────────────────────────────────────────
  private fun onMessage(m: JSONObject) {
    when (m.optString("type")) {
      "ready" -> {
        send(JSONObject().put("type", "mode").put("mode", store.mode))
        send(JSONObject().put("type", "moveMode").put("on", moveMode))
        sendDecorList()
      }
      "moveMode" -> { moveMode = m.optBoolean("on"); send(JSONObject().put("type", "moveMode").put("on", moveMode)) }
      "state" -> onState(m)
      "screenImage" -> {
        val id = m.optString("id"); screenImages[id] = m.optString("image")
        things["screen:$id"]?.let { refreshPanel(it) }
      }
      "refreshScreen" -> send(JSONObject().put("type", "refreshScreen").put("id", m.optString("id")))
      "open" -> openReader(m.optString("id"))
      "turn" -> things[m.optString("key")]?.let { turn(it, m.optDouble("deg", 45.0).toFloat()) }
      "delete" -> deleteThing(m.optString("key"))
      "closePiece" -> pieceWindows[m.optString("key")]?.let { closeReader(it) }
      "piece" -> togglePiece(m.optString("key"))
      "stopPlayer" -> things[m.optString("key")]?.let { stopPlayer(it) }
      "stopVideo" -> things[m.optString("key")]?.let { t -> t.videoPlaying = false; refreshPanel(t) }
      "decorSetting" -> setDecorScreen(m.optString("key"), m.optString("screenId").takeIf { !m.isNull("screenId") && it.isNotEmpty() })
      "shelfPage" -> things[m.optString("key")]?.let { t -> t.page = m.optInt("page"); t.shelfSize?.let { buildBooks(t, it) } }
      "addDecor" -> addDecor(m)
      // Folder shelves are trees and shelves can delete: the control panel (signed in, holds the grid) does both.
      "openFolder", "shelfUp" -> send(m)
      "deleteItems" -> {
        send(m)
        // A book's reader may show its FILE rather than the row being deleted: close those too.
        m.optJSONArray("items")?.let { a ->
          val ids = (0 until a.length()).map { a.optString(it) }.toSet()
          for ((id, occ) in readerOcc.toList()) if (occ in ids) closeReader(id)
        }
      }
      "shelfSelect" -> things[m.optString("key")]?.selecting = m.optBoolean("on")
      // Something was deleted (a page from its menu, a book from a shelf): the reader windows showing it close.
      "gone" -> m.optJSONArray("ids")?.let { a ->
        val ids = (0 until a.length()).map { a.optString(it) }.toSet()
        for ((id, occ) in readerOcc.toList()) if (occ in ids) closeReader(id)
      }
      "dragStart" -> onDragStart(m)
      "dragEnd" -> pendingDrag?.let { if (it.fromPanel == m.optInt("_panel", -1)) { it.ended = true; it.dropped = m.optBoolean("dropped"); Log.i(TAG, "drag end in window ${it.fromPanel}, taken there: ${it.dropped}") } }
      "placed" -> m.optJSONArray("panels")?.let { a -> for (i in 0 until a.length()) readerWebs[a.optInt(i)]?.reload() }
      // The new-note screen's button: the control panel (signed in, holds the grid) makes the page, then says "openNote".
      "newNote" -> send(JSONObject().put("type", "newNote").put("key", m.optString("key")))
      "openNote" -> {
        val at = things[m.optString("key")]?.frame?.tryGetComponent<Transform>()?.transform
        openReader(m.optString("id"), near = at?.let { val p = PoseMath.tOf(it); floatArrayOf(p[0], 1.4f, p[2]) })
      }
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
    m.optJSONArray("bookmarks")?.let { a ->
      val next = (0 until a.length()).mapNotNull { i -> a.optJSONObject(i)?.let { it.optString("title") to it.optString("url") } }
      if (next != bookmarkBar.toList()) { bookmarkBar.clear(); bookmarkBar.addAll(next) }
    }
    m.optString("origin").takeIf { it.isNotEmpty() }?.let { origin = it }
    if (gridChanged) {
      // Another grid's open books close (without saving: that would write this grid's empty list over them).
      for (id in readerOcc.keys.toList()) { readerHandles.remove(id)?.destroy(); readers.remove(id)?.destroy() }
      readerOcc.clear(); lastReadersSaved = ""
      store.gridId = m.optString("gridId")
      for (k in things.keys.toList()) if (k != CONTROL) deleteEntity(k)
      placed = false
      // This headset has nothing for the grid (wiped, reinstalled, a new headset): put back the layout backed up on
      // the grid. Its own copy, when there is one, always wins.
      m.optJSONObject("layout")?.let { backup ->
        if (!store.hasLayout()) {
          store.importLayout(backup)
          Log.i(TAG, "restored the layout from the grid backup (${backup.optString("savedAt")})")
        }
      }
      lastLayoutSent = store.exportLayout().toString()
    }
    placeAll()
  }

  // ── Building the room's contents ─────────────────────────────────────────
  /** Make every thing the state names, drop the ones it no longer names. */
  private fun placeAll() {
    if (!sceneReady) { main.postDelayed({ placeAll() }, 500); return }
    placed = true
    if (store.gridId.isNotEmpty() && readersRestoredFor != store.gridId) {
      readersRestoredFor = store.gridId
      for (r in store.readers()) {
        val t = r.optJSONArray("t") ?: continue; val q = r.optJSONArray("q") ?: continue
        openReader(r.optString("occ"), pose = PoseMath.pose(FloatArray(3) { t.optDouble(it).toFloat() }, FloatArray(4) { q.optDouble(it).toFloat() }),
            scale = r.optDouble("s", 1.0).toFloat())
      }
    }
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
      wanted[key] = { decorPanel(ensureThing(key, d.optString("model"), d.optString("src").ifEmpty { null }), d) }
    }
    for (k in things.keys.toList()) if (k !in wanted) deleteEntity(k)
    for (make in wanted.values) make()
  }

  private fun modelUri(model: String, src: String? = null): Uri =
      if (src != null) Uri.parse(if (src.startsWith("http")) src else origin + src) else Uri.parse("apk:///office/${modelFile(model)}.glb")

  /** Pieces drawn with another piece's model: the grid screen and the new-note screen are screens. */
  private fun modelFile(model: String) = when (model) { "gridscreen", "notepad", "browser", "claude" -> "screen"; else -> model }

  private fun ensureThing(key: String, model: String, src: String? = null): Thing {
    things[key]?.let { return it }
    val frame = Entity.create(listOf(
        Mesh(modelUri(model, src), hittable = MeshCollision.LineTest),
        Transform(Pose()),
    ))
    val t = Thing(key, frame)
    things[key] = t
    val size = sizes.optJSONObject(if (src != null) "" else modelFile(model))
    t.top = size?.optDouble("top", 1.0)?.toFloat() ?: 1.0f
    if (src == null && size != null) {
      t.model = model; t.hx = size.optDouble("hx").toFloat(); t.hz = size.optDouble("hz").toFloat()
      t.bottom = size.optDouble("bottom", 0.0).toFloat()
    }
    t.handle = GrabHandle(frame, t.top + HANDLE_GAP, facesHead = false,
        minY = 0f)
    if (!restore(t)) putDefault(t)
    t.handle?.follow()
    Log.i(TAG, "placed $key (top ${t.top}m, handle ${t.handle?.dy}m up)")
    // The ⚙ and 🗑 are made the first time the piece's menu shows (showMenus), not up front: each is a panel, and a
    // room full of pieces holding two idle panels each is part of what ran the headset out of memory.
    return t
  }

  private fun ensureShelf(s: JSONObject) {
    val asset = s.optString("asset", "book").let { if (it in OfficeSizes.SHELVES) it else "book" }
    val key = "shelf:" + s.optString("id")
    val existing = things[key]
    if (existing != null && existing.html.isNotEmpty() && !existing.html.contains("asset=${JSONObject.quote(asset)}")) deleteEntity(key)
    val t = ensureThing(key, "shelf-$asset")
    val size = OfficeSizes.SHELVES.getValue(asset)
    t.shelfSize = size
    t.shelfAsset = asset
    t.slots = ShelfLayout.slots(asset, size)
    t.shelfItems = s.optJSONArray("items") ?: org.json.JSONArray()
    val pages = maxOf(1, (t.shelfItems.length() + t.slots.size - 1) / t.slots.size)
    t.page = t.page.coerceIn(0, pages - 1)
    val html = PanelHtml.shelf(s, t.slots, size.h, t.page)
    // The control panel resends its state on every change anywhere in the grid; a shelf whose contents did not
    // change keeps its page (reloading it repainted every cover and rebuilt every book — part of the lag).
    if (t.panel != null && html == t.html) return
    t.html = html
    t.selecting = false
    attachPanel(t, size.w - 0.06f, size.h + PanelHtml.HEADER_M, (size.h + PanelHtml.HEADER_M) / 2f, size.d / 2f + 0.01f)
    buildBooks(t, size)
  }

  // ── Books you can take off a shelf ───────────────────────────────────────
  /** Lay a grabbable book over each spine on the shelf's current page (the old ones go). */
  private fun buildBooks(t: Thing, size: OfficeSizes.Shelf) {
    for (b in t.books) b.entity.destroy()
    t.books.clear()
    val start = t.page * t.slots.size
    for (i in t.slots.indices) {
      val item = t.shelfItems.optJSONObject(start + i) ?: break
      val title = item.optString("title")
      val e = Entity.create(listOf(
          Mesh(Uri.parse("apk:///office/bookproxy.glb"), hittable = MeshCollision.LineTest),
          Scale(Vector3(1f)),
          Transform(Pose()),
          Grabbable(true, GrabbableType.PIVOT_Y),
      ))
      t.books += Book(item.optString("id"), title, (if (item.isNull("cover")) "" else item.optString("cover")), t.slots[i], PanelHtml.spineColor(title), e).apply {
        folder = item.optBoolean("folder"); url = item.optString("url").takeIf { !item.isNull("url") } ?: ""
      }
    }
    bookFront[t.key] = size.d / 2f + 0.01f + BOOK_PROXY_DEPTH / 2f
  }

  // ── The card over something in your hand ─────────────────────────────────
  /** Two cards (one per hand), made once: a panel each, hidden until something is picked up. */
  private val cards = ArrayList<Entity>()
  private val cardInUse = BooleanArray(CARD_COUNT)
  private val cardWebs = arrayOfNulls<WebView>(CARD_COUNT)

  private fun makeCards() {
    for (i in 0 until CARD_COUNT) {
      val id = nextPanelId++
      registerPanel(webPanel(id, CARD_W, CARD_H, toolbar = false) { web -> cardWebs[i] = web })
      cards += Entity.create(listOf(Panel(id), Transform(Pose()), Visible(false)))
    }
  }

  private fun showCard(b: Book): Int {
    val i = cardInUse.indexOfFirst { !it }
    if (i < 0 || i >= cards.size) return -1
    cardInUse[i] = true
    cardWebs[i]?.loadDataWithBaseURL(origin, PanelHtml.heldCard(b.title, b.cover), "text/html", "utf-8", null)
    cards[i].setComponent(Visible(true))
    return i
  }

  private fun hideCard(b: Book) {
    val i = b.card
    if (i < 0) return
    b.card = -1
    cardInUse[i] = false
    cards[i].setComponent(Visible(false))
  }

  /** The card floats just above the held thing, turned to face you. */
  private fun placeCard(t: Thing, b: Book) {
    val i = b.card
    if (i < 0) return
    val at = b.entity.tryGetComponent<Transform>()?.transform ?: return
    val head = headPose() ?: return
    val p = floatArrayOf(at.t.x, at.t.y + b.slot.h * t.scale / 2f + CARD_H / 2f + 0.04f, at.t.z)
    cards[i].setComponent(Transform(PoseMath.sane(PoseMath.pose(p, PoseMath.yaw(PoseMath.yawToward(p, PoseMath.tOf(head)) + 180f)), "OfficeActivity:690")))
  }

  /**
   * Light up the spine each controller points at (the nearest book its ray meets), so you see which book you are
   * about to take — not its neighbour.
   */
  private fun hoverBooks() {
    val want = HashMap<String, String>()
    for ((o, d) in controllerRays()) {
      var best: Pair<Thing, Book>? = null; var bestD = Float.MAX_VALUE
      for (t in things.values) for (b in t.books) {
        if (b.held) continue
        val rest = bookRestPose(t, b) ?: continue
        val s = t.scale
        val hw = b.slot.w * s / 2f; val hh = b.slot.h * s / 2f; val hd = BOOK_PROXY_DEPTH * s / 2f
        val dist = PoseMath.rayBox(o, d, rest, floatArrayOf(-hw, -hh, -hd), floatArrayOf(hw, hh, hd)) ?: continue
        if (dist < bestD) { bestD = dist; best = t to b }
      }
      best?.let { (t, b) -> want[t.key] = b.itemId }
    }
    for (t in things.values) {
      if (t.books.isEmpty() && t.hoverBook == null) continue
      val id = want[t.key]
      if (id == t.hoverBook) continue
      t.hoverBook = id
      t.web?.evaluateJavascript("hover(${if (id == null) "null" else JSONObject.quote(id)})", null)
    }
  }

  /** How far out from a shelf's centre its books' grab blocks sit (just in front of the spines on the panel). */
  private val bookFront = HashMap<String, Float>()

  /** Where a book rests: its slot, in the world, following the shelf as it moves, turns and is resized. */
  private fun bookRestPose(t: Thing, b: Book): Pose? {
    val pose = t.frame.tryGetComponent<Transform>()?.transform ?: return null
    val s = t.scale
    val local = floatArrayOf(b.slot.x * s, b.slot.y * s, (bookFront[t.key] ?: 0.2f) * s)
    val w = PoseMath.rotate(PoseMath.qOf(pose), local)
    return PoseMath.pose(floatArrayOf(pose.t.x + w[0], pose.t.y + w[1], pose.t.z + w[2]), PoseMath.qOf(pose))
  }

  /**
   * Every frame: a resting book stays on its slot; take one off the shelf and it turns into a solid book in your
   * hand (its spine hides); let go of it away from the shelf — or just tap it — and it opens to read, then goes back.
   */
  private fun updateBooks() {
    val now = System.currentTimeMillis()
    hoverBooks()
    for (t in things.values) {
      if (t.books.isEmpty()) continue
      val s = t.scale
      for (b in t.books) {
        val grabbed = b.entity.tryGetComponent<Grabbable>()?.isGrabbed == true
        if (grabbed && !b.held) {
          b.held = true; b.grabbedAt = now
          // A book fills its slot (spine width = its thickness); a record sleeve and a tape are drawn at real size.
          val held = when (t.shelfAsset) { "record" -> "record"; "vhs" -> "vhs"; else -> "book" }
          b.entity.setComponent(Mesh(Uri.parse("apk:///office/$held-${b.color}.glb"), hittable = MeshCollision.LineTest))
          b.entity.setComponent(Scale(if (held == "book") Vector3(BOOK_DEPTH * s, b.slot.h * s, b.slot.w * s) else Vector3(s)))
          t.web?.evaluateJavascript("hold(${JSONObject.quote(b.itemId)}, true)", null)
          b.card = showCard(b)
          Log.i(TAG, "took ${b.title} off ${t.key}")
          continue
        }
        if (grabbed) { placeCard(t, b); continue }
        val rest = bookRestPose(t, b) ?: continue
        if (b.held) {
          b.held = false
          val at = b.entity.tryGetComponent<Transform>()?.transform
          val moved = at?.let { !PoseMath.near(PoseMath.tOf(it), PoseMath.tOf(rest), BOOK_PULL_M) } ?: false
          if (moved) {
            val p = at?.let { PoseMath.tOf(it) }
            val player = p?.let { when (t.shelfAsset) {
              "record" -> playerNear("recordplayer", it)
              "vhs" -> playerNear("vhsplayer", it)
              else -> null
            } }
            when {
              t.selecting -> selectBook(t, b)
              player != null && t.shelfAsset == "record" -> playRecord(player, b.title, itemSrc(t, b.itemId), itemField(t, b.itemId, "spotify"))
              player != null -> playTape(player, b.title, b.itemId, itemSrc(t, b.itemId))
              else -> activateBook(t, b, near = p)
            }
          } else if (now - b.grabbedAt < BOOK_TAP_MS) { if (t.selecting) selectBook(t, b) else activateBook(t, b) }
          b.entity.setComponent(Mesh(Uri.parse("apk:///office/bookproxy.glb"), hittable = MeshCollision.LineTest))
          t.web?.evaluateJavascript("hold(${JSONObject.quote(b.itemId)}, false)", null)
          hideCard(b)
          b.placedScale = -1f
        }
        if (b.placedScale != s) {
          b.entity.setComponent(Scale(Vector3(b.slot.w * s, b.slot.h * s, BOOK_PROXY_DEPTH * s)))
          b.placedScale = s
        }
        val cur = b.entity.tryGetComponent<Transform>()?.transform
        if (cur == null || !PoseMath.near(PoseMath.tOf(cur), PoseMath.tOf(rest), 0.002f) ||
            !PoseMath.near(PoseMath.qOf(cur), PoseMath.qOf(rest), 0.002f)) b.entity.setComponent(Transform(PoseMath.sane(rest, "OfficeActivity:786")))
      }
    }
  }

  /** A book taken off (or tapped on) a shelf: a folder opens on the shelf, a bookmark in a browser, else a reader. */
  private fun activateBook(t: Thing, b: Book, near: FloatArray? = null) {
    when {
      b.folder -> send(JSONObject().put("type", "openFolder").put("key", t.key).put("folderId", b.itemId))
      b.url.isNotEmpty() -> openReader("url:" + b.url, near = near)
      else -> openReader(b.itemId, near = near)
    }
  }

  /** In select mode a tap picks (or unpicks) the book on the shelf's page, which keeps the selection and the Delete. */
  private fun selectBook(t: Thing, b: Book) {
    t.web?.evaluateJavascript("tapItem(${JSONObject.quote(b.itemId)})", null)
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
    if (t.browser) registerPanel(browserPanel(id, w, h, t))
    else registerPanel(webPanel(id, w, h, toolbar = false) { web ->
      t.web = web
      val url = t.panelUrl
      if (url != null) web.loadUrl(url) else web.loadDataWithBaseURL(t.panelBase ?: origin, t.html, "text/html", "utf-8", null)
    })
    // A panel shows its face on -z; the furniture's front is +z, so the panel is turned to look out of it.
    t.panelAt = floatArrayOf(y, z)
    t.panel = Entity.create(listOf(
        Panel(id),
        Transform(PoseMath.sane(PoseMath.pose(floatArrayOf(0f, y, z), PoseMath.yaw(180f)), "OfficeActivity:828")),
        TransformParent(t.frame),
    ))

    applyScale(t)
  }

  private fun refreshPanel(t: Thing) {
    if (t.videoPlaying || t.panelUrl != null) return
    if (t.key.startsWith("screen:")) {
      val id = t.key.removePrefix("screen:")
      val s = (0 until (state?.optJSONArray("screens")?.length() ?: 0))
          .map { state!!.getJSONArray("screens").getJSONObject(it) }.firstOrNull { it.optString("id") == id } ?: return
      t.html = PanelHtml.screen(s, screenImages[id])
    }
    t.web?.loadDataWithBaseURL(t.panelBase ?: origin, t.html, "text/html", "utf-8", null)
  }

  private fun deleteEntity(key: String) {
    val t = things.remove(key) ?: return
    t.handle?.destroy()
    t.panel?.destroy()
    t.gear?.destroy()
    t.trash?.destroy()
    for (b in t.books) b.entity.destroy()
    t.books.clear()
    pieceWindows[key]?.let { closeReader(it) }
    t.frame.destroy()
  }

  private fun deleteThing(key: String) {
    if (key == "fireplace" || key == CONTROL) return
    deleteEntity(key)
    store.remove(key)
    if (key.startsWith("decor:")) { store.saveDecor(store.decor().filter { it.optString("key") != key }); sendDecorList() }
  }

  /** The decor in the room, for the control panel's "In the room" list (remove a piece you cannot reach). */
  private fun sendDecorList() {
    val list = org.json.JSONArray()
    for (e in store.decor()) list.put(JSONObject().put("key", e.optString("key")).put("title", e.optString("title").ifEmpty { e.optString("model") }))
    send(JSONObject().put("type", "decorList").put("list", list))
  }

  private fun addDecor(m: JSONObject) {
    val key = "decor:" + UUID.randomUUID().toString().take(8)
    val model = m.optString("key")
    val entry = JSONObject().put("key", key).put("model", model).put("title", m.optString("title"))
    if (!m.isNull("src")) entry.put("src", m.optString("src"))
    store.saveDecor(store.decor() + entry)
    val t = ensureThing(key, model, entry.optString("src").ifEmpty { null })
    decorPanel(t, entry)
    putInFront(t)
    sendDecorList()
  }

  // ── Decor that does something: clock, window, record player, VHS player ──
  /** Give a decor piece its live face, when its model has one (once; later calls only keep the entry current). */
  private fun decorPanel(t: Thing, entry: JSONObject) {
    t.decorEntry = entry
    if (t.panel != null) return
    when (entry.optString("model")) {
      "clock" -> { t.html = PanelHtml.clock(); attachPanel(t, 0.34f, 0.34f, 0.2f, 0.026f) }
      "window" -> {
        t.panelBase = "file:///android_asset/"
        t.html = PanelHtml.windowView()
        attachPanel(t, 1.0f, 0.75f, 0.435f, -0.01f)
      }
      // Players get their (web) panel only while something plays — a room of idle players each holding a page
      // ran the headset out of memory and crashed the app.
      "recordplayer", "vhsplayer" -> {}
      // The whole grid, live: the app itself (its own panels and date — `local`), on a screen you place.
      "gridscreen" -> { t.panelUrl = "$origin/?local=1"; attachPanel(t, OfficeSizes.SCREEN_W, OfficeSizes.SCREEN_H, OfficeSizes.SCREEN_Y, 0.025f) }
      // One button: a new note in Notes, opened beside it to write in (and on the Documents shelf).
      "notepad" -> { t.html = PanelHtml.notepad(t.key); attachPanel(t, OfficeSizes.SCREEN_W, OfficeSizes.SCREEN_H, OfficeSizes.SCREEN_Y, 0.025f) }
      // A plain web browser on a screen: an address bar, back / forward / reload; it remembers its last page.
      "browser", "claude" -> {
        t.browser = true
        // A Claude screen is a browser that starts at claude.ai (the native app cannot be put in a panel).
        val home = if (entry.optString("model") == "claude") "https://claude.ai/new" else "https://www.google.com"
        t.panelUrl = entry.optString("url").ifEmpty { home }
        attachPanel(t, OfficeSizes.SCREEN_W, OfficeSizes.SCREEN_H + 0.16f, OfficeSizes.SCREEN_Y, 0.025f)
      }
    }
  }

  /** The nearest piece of `model` within PLAYER_DROP_M of `p`, or null. */
  private fun playerNear(model: String, p: FloatArray): Thing? =
      things.values
          .filter { it.decorEntry?.optString("model") == model }
          .mapNotNull { t -> t.frame.tryGetComponent<Transform>()?.transform?.let { pose ->
            val d = PoseMath.tOf(pose).let { o -> kotlin.math.sqrt((o[0] - p[0]) * (o[0] - p[0]) + (o[2] - p[2]) * (o[2] - p[2])) }
            if (d <= PLAYER_DROP_M * maxOf(1f, t.scale)) t to d else null } }
          .minByOrNull { it.second }?.first

  /** A string the shelf's item carries (a JSON null is "", not the word "null"). */
  private fun itemField(t: Thing, itemId: String, key: String): String {
    for (i in 0 until t.shelfItems.length()) {
      val it = t.shelfItems.optJSONObject(i) ?: continue
      if (it.optString("id") == itemId) return if (it.isNull(key)) "" else it.optString(key)
    }
    return ""
  }

  private fun itemSrc(t: Thing, itemId: String): String {
    for (i in 0 until t.shelfItems.length()) {
      val it = t.shelfItems.optJSONObject(i) ?: continue
      // optString turns a JSON null into the word "null": a record with no audio file "played" a file called null.
      if (it.optString("id") == itemId) return if (it.isNull("src")) "" else it.optString("src")
    }
    return ""
  }

  private fun showOnPanel(t: Thing, html: String) {
    t.html = html
    if (t.panel == null) when (t.decorEntry?.optString("model")) {
      "recordplayer" -> { attachPanel(t, 0.34f, 0.12f, 0.24f, 0f); return }
      "vhsplayer" -> { attachPanel(t, 0.34f, 0.12f, 0.2f, 0f); return }
    }
    t.web?.loadDataWithBaseURL(t.panelBase ?: origin, t.html, "text/html", "utf-8", null)
  }

  /** A player stops: its panel (and the web page in it) goes, until something plays again. */
  private fun stopPlayer(t: Thing) {
    t.panel?.destroy(); t.panel = null; t.web = null; t.html = ""
  }

  /** A record dropped on a record player plays there: its audio file, else Spotify's player for it. */
  private fun playRecord(player: Thing, title: String, src: String, spotify: String = "") {
    if (src.isEmpty() && spotify.isNotEmpty()) {
      // Spotify's player needs more room than a now-playing card, so the player's window is made at that size.
      stopPlayer(player)
      player.html = PanelHtml.spotifyCard(title, spotify, player.key)
      attachPanel(player, SPOTIFY_W, SPOTIFY_H, 0.24f + SPOTIFY_H / 2f, 0f)
      Log.i(TAG, "playing $title on ${player.key} through Spotify")
      return
    }
    if (src.isEmpty()) { showOnPanel(player, PanelHtml.playerCard(title, "", player.key, "No audio file for this record")); return }
    showOnPanel(player, PanelHtml.playerCard(title, src, player.key, "Now playing"))
    Log.i(TAG, "playing $title on ${player.key}")
  }

  /** A tape dropped on a VHS player runs on its chosen screen (else the first screen; with none, in a window). */
  private fun playTape(player: Thing, title: String, itemId: String, src: String) {
    if (src.isEmpty()) { showOnPanel(player, PanelHtml.playerCard(title, "", player.key, "No video file for this tape")); return }
    val chosen = player.decorEntry?.optString("screenId")?.takeIf { it.isNotEmpty() }
    val screen = chosen?.let { things["screen:$it"] } ?: things.values.firstOrNull { it.key.startsWith("screen:") }
    if (screen == null) {
      showOnPanel(player, PanelHtml.playerCard(title, "", player.key, "No screen in the room, so it opened in a window"))
      openReader(itemId)
      return
    }
    screen.videoPlaying = true
    showOnPanel(screen, PanelHtml.video(title, src, screen.key))
    showOnPanel(player, PanelHtml.playerCard(title, "", player.key, "Playing on the screen"))
    Log.i(TAG, "playing $title on ${screen.key}")
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
    t.frame.setComponent(Transform(PoseMath.sane(spawnPose(dist, 0f), "OfficeActivity:994")))
    t.handle?.follow()
    remember(t, force = true)
  }

  /** Where a thing goes the first time: a spread in front of you, so new pieces do not pile up. */
  private fun putDefault(t: Thing) {
    // Until the headset reports where your head is, "in front of you" is a guess from the boundary's centre, which
    // put the fireplace out of sight. Wait for the head instead (nothing is saved meanwhile).
    if (headPose() == null) {
      main.postDelayed({ if (things[t.key] === t && store.get(t.key) == null) putDefault(t) }, 300)
      return
    }
    if (t.key == CONTROL) {
      t.frame.setComponent(Transform(PoseMath.sane(spawnPose(1.3f, 1.25f, -0.7f, panel = true), "OfficeActivity:1008")))
      t.handle?.follow()
      remember(t, force = true)
      return
    }
    val i = things.keys.indexOf(t.key)
    val side = if (t.key == "fireplace") 0f else ((i % 5) - 2) * 1.3f
    val dist = if (t.key == "fireplace") 2.8f else 2.2f
    t.frame.setComponent(Transform(PoseMath.sane(spawnPose(dist, 0f, side), "OfficeActivity:1016")))
    t.handle?.follow()
    remember(t, force = true)
  }

  /** Put `t` where it was saved. False if nothing is saved for it. */
  private fun restore(t: Thing): Boolean {
    val s = store.get(t.key)?.takeIf { it.space == PlacementStore.STAGE } ?: return false
    val pose = PoseMath.pose(s.t, s.q)
    t.frame.setComponent(Transform(PoseMath.sane(pose, "OfficeActivity:1025")))
    t.lastT = PoseMath.tOf(pose); t.lastQ = PoseMath.qOf(pose)
    t.scale = s.scale; t.lastScale = s.scale
    applyScale(t)
    return true
  }

  /** Save `t`'s pose (stage space) if it moved. */
  private fun remember(t: Thing, force: Boolean = false) {
    val pose = t.frame.tryGetComponent<Transform>()?.transform ?: return
    val tt = PoseMath.tOf(pose); val q = PoseMath.qOf(pose)
    if (!force && PoseMath.near(tt, t.lastT, 0.005f) && PoseMath.near(q, t.lastQ, 0.002f) &&
        kotlin.math.abs(t.scale - t.lastScale) < 0.005f) return
    t.lastT = tt; t.lastQ = q; t.lastScale = t.scale
    store.put(t.key, PlacementStore.Stored(PlacementStore.STAGE, tt, q, t.scale))
  }

  private fun turn(t: Thing, deg: Float, save: Boolean = true) {
    val pose = t.frame.tryGetComponent<Transform>()?.transform ?: return
    // About the room's vertical, keeping any tilt.
    val q = PoseMath.qMul(PoseMath.yaw(deg), PoseMath.qOf(pose))
    t.frame.setComponent(Transform(PoseMath.sane(PoseMath.pose(PoseMath.tOf(pose), q), "OfficeActivity:1045")))
    t.handle?.follow()
    if (save) remember(t, force = true)
  }

  /** Tilt `t` about its own side axis — all the way over puts it on the ceiling, facing down at you. */
  private fun tilt(t: Thing, deg: Float, save: Boolean = true) {
    val pose = t.frame.tryGetComponent<Transform>()?.transform ?: return
    val q = PoseMath.qMul(PoseMath.qOf(pose), PoseMath.pitch(deg))
    t.frame.setComponent(Transform(PoseMath.sane(PoseMath.pose(PoseMath.tOf(pose), q), "tilt")))
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
      p.setComponent(Transform(PoseMath.sane(PoseMath.pose(floatArrayOf(0f, t.panelAt[0] * t.scale, t.panelAt[1] * t.scale), PoseMath.yaw(180f)), "OfficeActivity:1063")))
    }
    t.handle?.dy = if (t.handleBelow) -(t.top * t.scale + HANDLE_GAP / 2f) else t.top * t.scale + HANDLE_GAP
    if (!t.handleBelow) t.handle?.minY = -t.bottom * t.scale
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
  /** How far along the ray (o, d) it meets `t`'s box, or null when it misses. */
  private fun hitDistance(t: Thing, o: FloatArray, d: FloatArray): Float? {
    val pose = t.frame.tryGetComponent<Transform>()?.transform ?: return null
    val s = t.scale
    val hx = maxOf((if (t.hx > 0f) t.hx else 0.5f) * s, 0.5f) + 0.05f
    val hz = maxOf((if (t.hz > 0f) t.hz else 0.5f) * s, 0.08f) + 0.05f
    val top = (t.handle?.dy ?: (t.top * s)) + 0.1f
    return PoseMath.rayBox(o, d, pose, floatArrayOf(-hx, -0.05f, -hz), floatArrayOf(hx, top, hz))
  }

  /** Does `inner`'s origin lie inside `outer`'s pointing box? */
  private fun standsInside(inner: Thing, outer: Thing): Boolean {
    val ip = inner.frame.tryGetComponent<Transform>()?.transform ?: return false
    val op = outer.frame.tryGetComponent<Transform>()?.transform ?: return false
    val (l, _) = PoseMath.toLocal(op, ip)
    val s = outer.scale
    val hx = maxOf((if (outer.hx > 0f) outer.hx else 0.5f) * s, 0.5f) + 0.05f
    val hz = maxOf((if (outer.hz > 0f) outer.hz else 0.5f) * s, 0.08f) + 0.05f
    val top = (outer.handle?.dy ?: (outer.top * s)) + 0.1f
    return kotlin.math.abs(l[0]) <= hx && kotlin.math.abs(l[2]) <= hz && l[1] >= -0.05f && l[1] <= top
  }

  private fun footprint(t: Thing): Float = maxOf(t.hx, 0.05f) * maxOf(t.hz, 0.05f) * t.scale * t.scale

  /**
   * A piece's bar, ⚙ and 🗑 show only while you point at it (or just did), hold it, or have its settings open — shown
   * all the time they blocked the view of the room. Hidden, the bar cannot be grabbed by accident either.
   */
  private fun showMenus() {
    val now = System.currentTimeMillis()
    // Each controller points at ONE piece: the nearest its ray meets. A ray across the room passes through several
    // pieces' boxes, and lighting them all up let a grab land on the wrong piece.
    val pointed = HashSet<String>()
    for ((o, d) in if (moveMode) controllerRays() else emptyList()) {
      var best: Thing? = null; var bestD = Float.MAX_VALUE
      val hits = ArrayList<Thing>()
      for (t in things.values) {
        // Sitting in a piece puts your controllers inside its box, which reads as pointing at it — skip it then.
        if (t.key == CONTROL || t.ghosted) continue
        val dist = hitDistance(t, o, d) ?: continue
        hits += t
        if (dist < bestD) { bestD = dist; best = t }
      }
      // A small piece standing on or in a bigger one (a record player on a desk) is inside the big one's pointing
      // box, which reaches up to the big one's bar — so the ray met the desk first and the player's bar never showed.
      // Of the pieces hit, one standing inside another's box wins over that box.
      best?.let { outer -> hits.filter { it !== outer && standsInside(it, outer) }.minByOrNull { footprint(it) }?.let { best = it } }
      best?.let { it.lastHover = now; pointed += it.key }
    }
    // Pointing at another piece hides the last one at once; the linger is only for pointing at nothing.
    if (pointed.isNotEmpty()) for (t in things.values) if (t.key !in pointed) t.lastHover = 0L
    for (t in things.values) {
      if (t.key == CONTROL) continue
      val want = moveMode && (!t.ghosted && now - t.lastHover < MENU_LINGER_MS || t.handle?.held == true || t.key in pieceWindows)
      if (want == t.menuShown) continue
      t.menuShown = want
      if (want && t.gear == null) {
        t.gear = gearButton(t)
        if (t.key != "fireplace") t.trash = trashButton(t)
      }
      for (e in listOfNotNull(t.handle?.entity, t.gear, t.trash)) e.setComponent(Visible(want))
      // A bar you cannot see cannot be grabbed either, so a grab only ever lands on the piece whose menu is showing.
      t.handle?.entity?.setComponent(Grabbable(want, GrabbableType.PIVOT_Y))
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

  /**
   * Every frame: pieces follow their handles. The sticks act ONLY on the piece whose bar you are holding (user: "it
   * shouldnt select any furniture without grabbing the handle"): RIGHT thumbstick left / right turns it, up / down
   * pushes it further away / pulls it closer; LEFT thumbstick up / down grows / shrinks it. Smooth, by how long the
   * stick is held.
   * Read straight from the controllers — per-entity button events never carried the thumbstick on the headset. The
   * pose is saved by SaveSystem, which notices the change, rather than on every frame of a turn.
   */
  /** Names an entity for the pose check: the piece (and which part of it), else its panel or model. */
  private fun describeEntity(e: Entity): String {
    for (t in things.values) {
      val part = when (e) { t.frame -> "frame"; t.panel -> "panel"; t.handle?.entity -> "handle"; t.gear -> "gear"; else -> t.books.firstOrNull { it.entity == e }?.let { "book '${it.title}'" } }
      if (part != null) return "${t.key} ($part, scale ${t.scale})"
    }
    readers.entries.firstOrNull { it.value == e }?.let { return "reader window ${it.key}" }
    readerHandles.entries.firstOrNull { it.value.entity == e }?.let { return "reader handle ${it.key}" }
    if (e == ghost) return "drag label"
    cards.indexOf(e).takeIf { it >= 0 }?.let { return "card $it" }
    return "entity ${e.id} panel=${PoseCheck.panelId(e)} mesh=${PoseCheck.meshName(e)}"
  }

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
        if (h.update(head)) Log.i(TAG, "grabbed ${t.key}")
        if (h.held) held = t.key
      }
      var heldReader: Int? = null
      for ((id, h) in readerHandles) { h.update(head); if (h.held) heldReader = id }
      showMenus()
      ghostSeats(head)
      updateBooks()

      val now = System.nanoTime()
      val dt = if (lastNs == 0L) 0f else ((now - lastNs) / 1e9f).coerceAtMost(0.1f)
      lastNs = now
      var turnDir = 0f
      var growDir = 0f
      var reachDir = 0f
      var tiltDir = 0f
      var triggerDown = false
      for (c in Query.where { has(Controller.id) }.eval()) {
        if (!c.isLocal()) continue
        val ctl = c.tryGetComponent<Controller>() ?: continue
        if (!ctl.isActive) continue
        val down = ctl.buttonState
        if (down and (ButtonBits.ButtonTriggerR or ButtonBits.ButtonTriggerL) != 0) {
          triggerDown = true
          // The ray of the hand holding the trigger: a drag follows THAT controller, not whichever comes first.
          c.tryGetComponent<Transform>()?.transform?.let { pose ->
            dragRay = PoseMath.tOf(pose) to PoseMath.rotate(PoseMath.qOf(pose), floatArrayOf(0f, 0f, 1f))
          }
        }
        if (down and ButtonBits.ButtonThumbRL != 0) turnDir += 1f
        if (down and ButtonBits.ButtonThumbRR != 0) turnDir -= 1f
        if (down and ButtonBits.ButtonThumbRU != 0) reachDir += 1f
        if (down and ButtonBits.ButtonThumbRD != 0) reachDir -= 1f
        if (down and ButtonBits.ButtonThumbLU != 0) growDir += 1f
        if (down and ButtonBits.ButtonThumbLD != 0) growDir -= 1f
        if (down and ButtonBits.ButtonThumbLL != 0) tiltDir += 1f
        if (down and ButtonBits.ButtonThumbLR != 0) tiltDir -= 1f
      }
      // A drag started in a reader window ends when the trigger is let go; give the page a moment to say whether it
      // took the drop itself, then try the window the controller points at.
      if (triggerWasDown && !triggerDown) pendingDrag?.takeIf { !it.released }?.let { d ->
        d.released = true
        val rays = dragRay?.let { listOf(it) } ?: controllerRays()
        main.postDelayed({ if (pendingDrag === d) finishCrossDrag(rays) }, 250)
      }
      triggerWasDown = triggerDown
      updateGhost()
      if (dt == 0f) return
      if (reachDir != 0f) held?.let { k -> things[k]?.handle?.let { it.reach += reachDir * REACH_M_PER_S * dt } }
      // A reader window you hold moves out / in and grows / shrinks with the same sticks as furniture.
      heldReader?.let { id ->
        if (reachDir != 0f) readerHandles[id]?.let { it.reach += reachDir * REACH_M_PER_S * dt }
        if (growDir != 0f) scaleReader(id, Math.pow(GROW_PER_S.toDouble(), (growDir * dt).toDouble()).toFloat())
        if (tiltDir != 0f) readerHandles[id]?.let { it.tilt = (it.tilt + tiltDir * TURN_DEG_PER_S * dt).coerceIn(-90f, 90f) }
      }
      if (turnDir == 0f && growDir == 0f && tiltDir == 0f) return
      val target = held?.let { things[it] } ?: return
      if (turnDir != 0f) turn(target, turnDir * TURN_DEG_PER_S * dt, save = false)
      if (tiltDir != 0f) tilt(target, tiltDir * TURN_DEG_PER_S * dt, save = false)
      if (growDir != 0f) resize(target, Math.pow(GROW_PER_S.toDouble(), (growDir * dt).toDouble()).toFloat(), save = false)
    }
  }

  /** Watches for moved furniture (grabbing moves it without telling anyone) and saves it, about twice a second. */
  inner class SaveSystem : SystemBase() {
    private var frames = 0
    override fun execute() {
      if (++frames % 36 != 0) return
      for (t in things.values) remember(t)
      saveReaders()
      if (frames % 180 == 0) sweepStrayModels()
      backUpLayout()
    }
  }

  /**
   * A model in the room that no piece, book or grab bar owns cannot be grabbed or deleted (user, 2026-10-25: "one
   * of the record players is stuck … wont let me drag or delete it"). The app makes models in exactly three places —
   * a piece's frame, a shelf's books, a grab bar — so any other office model is a leftover: it is logged and removed.
   */
  private fun sweepStrayModels() {
    val owned = HashSet<Long>()
    for (t in things.values) {
      owned += t.frame.id
      t.handle?.entity?.id?.let { owned += it }
      for (b in t.books) owned += b.entity.id
    }
    for (h in readerHandles.values) owned += h.entity.id
    for (e in Query.where { has(Mesh.id) }.eval()) {
      val uri = e.tryGetComponent<Mesh>()?.mesh?.toString() ?: continue
      if (!uri.startsWith("apk:///office/") || e.id in owned) continue
      Log.w(TAG, "stray model removed: ${uri.removePrefix("apk:///office/")} (entity ${e.id})")
      e.destroy()
    }
  }

  /** The layout last handed to the control panel to back up on the grid, and when (at most every LAYOUT_BACKUP_MS). */
  private var lastLayoutSent = ""
  private var lastLayoutAt = 0L

  /** Back the layout up on the grid (through the control panel, which is signed in) when it has changed. */
  private fun backUpLayout() {
    if (store.gridId.isEmpty() || control == null) return
    val now = System.currentTimeMillis()
    if (now - lastLayoutAt < LAYOUT_BACKUP_MS) return
    val layout = store.exportLayout()
    val json = layout.toString()
    if (json == lastLayoutSent || !store.hasLayout()) return
    lastLayoutSent = json; lastLayoutAt = now
    send(JSONObject().put("type", "layout").put("layout", layout))
  }

  // ── Dragging from one reader window to another ───────────────────────────
  /** A drag a reader window reported starting (its page cannot see past its own edges). */
  // ── The drag ghost: what you carry between reader windows ─────────────────
  // A drag's pill is part of its window's page, so it stops at that window's edge. Between windows this floats the
  // same pill in the room (its words and colours), at the distance of the window it left; over another reader window
  // that window runs the drag itself (its own pill, highlight and drop — ReaderApp's __moduliRemoteDrag).
  private val ghostTitle = mutableStateOf("")
  private val ghostAction = mutableStateOf("")
  private var ghost: Entity? = null
  /** Origin and direction of the controller whose trigger is down (the one carrying a drag). */
  private var dragRay: Pair<FloatArray, FloatArray>? = null

  private fun ensureGhost(): Entity {
    ghost?.let { return it }
    val id = nextPanelId++
    registerPanel(ComposeViewPanelRegistration(
        id,
        composeViewCreator = { _, ctx ->
          ComposeView(ctx).apply {
            setContent {
              // dragSystem._createDragPill: rgba(30,60,90,.92), a 1px rgba(100,160,255,.4) border, rounded, the item's
              // name in white monospace over the action (Move / Copy / Copy-link) at 70%.
              Column(
                  Modifier.fillMaxSize()
                      .background(androidx.compose.ui.graphics.Color(0xEB1E3C5A.toInt()), androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
                      .border(1.dp, androidx.compose.ui.graphics.Color(0x6664A0FF), androidx.compose.foundation.shape.RoundedCornerShape(6.dp))
                      .padding(horizontal = 10.dp, vertical = 4.dp),
              ) {
                Text(ghostTitle.value, color = androidx.compose.ui.graphics.Color.White, fontSize = 15.sp,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace, maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Text(ghostAction.value, color = androidx.compose.ui.graphics.Color(0xB3FFFFFF.toInt()), fontSize = 11.sp,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
              }
            }
          }
        },
        settingsCreator = {
          UIPanelSettings(
              shape = QuadShapeOptions(width = GHOST_W, height = GHOST_H),
              style = PanelStyleOptions(themeResourceId = R.style.PanelAppThemeTransparent),
              display = DpPerMeterDisplayOptions(),
          )
        },
    ))
    return Entity.create(listOf(Panel(id), Transform(Pose()), Visible(false))).also { ghost = it }
  }

  /** Where `ray` meets a reader window other than `except`: (window, distance, u across, v down the panel). */
  private fun readerUnder(ray: Pair<FloatArray, FloatArray>, except: Int?): Pair<Int, FloatArray>? {
    val (o, d) = ray
    var best: Pair<Int, FloatArray>? = null
    for ((id, e) in readers) {
      if (id == except || !readerWebs.containsKey(id)) continue
      val pose = e.tryGetComponent<Transform>()?.transform ?: continue
      val s = e.tryGetComponent<com.meta.spatial.toolkit.Scale>()?.scale?.x ?: 1f
      val dist = PoseMath.rayBox(o, d, pose, floatArrayOf(-READER_W * s / 2f, -READER_H * s / 2f, -0.03f), floatArrayOf(READER_W * s / 2f, READER_H * s / 2f, 0.03f)) ?: continue
      if (best != null && dist >= best.second[0]) continue
      val hit = floatArrayOf(o[0] + d[0] * dist, o[1] + d[1] * dist, o[2] + d[2] * dist)
      val local = PoseMath.toLocal(pose, PoseMath.pose(hit, floatArrayOf(1f, 0f, 0f, 0f))).first
      // Measured on the headset: with the old "+x is on your left" reading a drag in the target window ran backwards
      // (user, 2026-10-25: "dragging right moved it left"), so +x is the panel's right as you face it.
      val u = (0.5f + local[0] / (READER_W * s)).coerceIn(0f, 1f)
      val v = (0.5f - local[1] / (READER_H * s)).coerceIn(0f, 1f)
      best = id to floatArrayOf(dist, u, v)
    }
    return best
  }

  private fun remote(panel: Int, call: String) = readerWebs[panel]?.evaluateJavascript("window.__moduliRemoteDrag && window.__moduliRemoteDrag.$call", null)

  /** Each frame of a drag: which window the controller points at; out of its own window the drag goes with it. */
  private fun updateGhost() {
    val d = pendingDrag
    val g = ghost ?: return
    if (d == null || d.released) { g.setComponent(Visible(false)); return }
    val ray = dragRay ?: controllerRays().firstOrNull() ?: run { g.setComponent(Visible(false)); return }
    val (o, dir) = ray
    val srcPose = readers[d.fromPanel]?.tryGetComponent<Transform>()?.transform
    val srcScale = readers[d.fromPanel]?.tryGetComponent<com.meta.spatial.toolkit.Scale>()?.scale?.x ?: 1f
    val inside = srcPose != null && PoseMath.rayBox(o, dir, srcPose,
        floatArrayOf(-READER_W * srcScale / 2f, -READER_H * srcScale / 2f, -0.03f), floatArrayOf(READER_W * srcScale / 2f, READER_H * srcScale / 2f, 0.03f)) != null
    // The page keeps the last point it saw inside, so on release it would drop there: tell it the pointer has left.
    if (d.outside != !inside) {
      d.outside = !inside
      Log.i(TAG, "drag ${d.occId}: pointer ${if (inside) "back in" else "left"} window ${d.fromPanel}")
      readerWebs[d.fromPanel]?.evaluateJavascript("window.__moduliOutside=${!inside}", null)
    }
    val over = if (inside) null else readerUnder(ray, d.fromPanel)
    // Over another window: that window draws the drag. Entering a new one ends it in the last.
    if (over?.first != d.overPanel) {
      d.overPanel?.let { remote(it, "leave()") }
      d.overPanel = over?.first
      over?.let { (id, h) ->
        Log.i(TAG, "drag ${d.occId}: over window $id")
        remote(id, "enter(${JSONObject.quote(d.label)}, ${h[1]}, ${h[2]}, $READER_W, $READER_H)")
      }
    } else over?.let { (id, h) -> remote(id, "move(${h[1]}, ${h[2]}, $READER_W, $READER_H)") }
    if (inside || over != null) { g.setComponent(Visible(false)); return }
    // Between windows: the pill floats where the window you left is (not in your face), facing you.
    val dist = srcPose?.let { p -> val c = PoseMath.tOf(p); kotlin.math.sqrt((c[0] - o[0]).let { it * it } + (c[1] - o[1]).let { it * it } + (c[2] - o[2]).let { it * it }) } ?: 1.2f
    val at = floatArrayOf(o[0] + dir[0] * dist, o[1] + dir[1] * dist, o[2] + dir[2] * dist)
    val head = headPose()?.let { PoseMath.tOf(it) }
    val q = if (head != null) PoseMath.yaw(PoseMath.yawToward(at, head) + 180f) else PoseMath.yaw(180f)
    if (ghostTitle.value != d.label) ghostTitle.value = d.label
    if (ghostAction.value != d.action) ghostAction.value = d.action
    g.setComponent(Transform(PoseMath.sane(PoseMath.pose(at, q), "ghost")))
    g.setComponent(Visible(true))
  }

  /** A drag a reader window reported starting (its page cannot see past its own edges). */
  private class PendingDrag(val fromPanel: Int, val occId: String, val mode: String, val label: String, val action: String) {
    var ended = false
    var dropped = false
    var released = false
    var outside = false
    /** The other reader window the controller points at (it is running the drag), or null. */
    var overPanel: Int? = null
  }
  private var pendingDrag: PendingDrag? = null
  private var triggerWasDown = false

  private fun onDragStart(m: JSONObject) {
    val occ = m.optString("occId")
    if (occ.isEmpty()) return
    val from = m.optInt("_panel", -1)
    pendingDrag = PendingDrag(from, occ, m.optString("mode", "move"), m.optString("label").ifEmpty { "item" },
        m.optString("action").ifEmpty { "Move" })
    readerWebs[from]?.evaluateJavascript("window.__moduliOutside=false", null)
    // Every other reader window gets ready to take it (loads the row and its parent) while you are still here.
    m.optString("payload").takeIf { it.isNotEmpty() }?.let { p ->
      for (id in readerWebs.keys) if (id != from) remote(id, "prepare(${JSONObject.quote(p)})")
    }
    ensureGhost()
    Log.i(TAG, "drag start $occ in window $from")
  }

  /** The trigger was let go: the window under the controller (running the drag) drops it there. */
  private fun finishCrossDrag(@Suppress("UNUSED_PARAMETER") rays: List<Pair<FloatArray, FloatArray>>) {
    val drag = pendingDrag ?: return
    pendingDrag = null
    ghost?.setComponent(Visible(false))
    val over = drag.overPanel
    for (id in readerWebs.keys) if (id != drag.fromPanel && id != over) remote(id, "cancel()")
    if (drag.dropped) { over?.let { remote(it, "cancel()") }; return }
    if (over == null) { Log.i(TAG, "drag ${drag.occId}: let go over no other window"); return }
    val h = dragRay?.let { readerUnder(it, drag.fromPanel) }?.takeIf { it.first == over }?.second
    remote(over, if (h != null) "drop(${h[1]}, ${h[2]}, $READER_W, $READER_H)" else "cancel()")
    // The drop waits for the rows the window loaded; read its answer, then show both windows as they are now.
    main.postDelayed({
      readerWebs[over]?.evaluateJavascript("window.__moduliRemoteDropped") { r ->
        Log.i(TAG, "drag ${drag.occId} from window ${drag.fromPanel} into window $over: dropped=$r")
        remote(over, "cancel()")
        // A move: the window it left takes its own copy out (a doc there only lets go of an embed it holds itself).
        if (r == "true" && drag.mode == "move")
          readerWebs[drag.fromPanel]?.evaluateJavascript("window.__moduliMovedOut && window.__moduliMovedOut(${JSONObject.quote(drag.occId)})", null)
      }
    }, 2500)
  }

  /** A keyboard paired with the headset types into the window you last pointed at and pressed. */
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
    val web = keyTarget
    if (web != null && web.isAttachedToWindow && event.keyCode != android.view.KeyEvent.KEYCODE_BACK) {
      if (web.dispatchKeyEvent(event)) return true
    }
    return super.dispatchKeyEvent(event)
  }

  // ── Readers: a page or a file opened from a shelf or a screen ────────────
  /**
   * Open a page or file to read. `near`: where you let go of a book — the reader opens there (at reading height),
   * facing you; otherwise in front of you.
   */
  private fun openReader(occId: String, near: FloatArray? = null, pose: Pose? = null, scale: Float = 1f) {
    val id = nextPanelId++
    // `read`: just that page or book, read on its own (ReaderApp) — not the whole grid. Each window keeps its own
    // page: as full app tabs they shared storage, and opening a second book turned the first into it too.
    if (occId.startsWith("url:")) {
      // A bookmark opens as a browser window (its page), not as the bookmark's row drawn as a board.
      val holder = Thing("reader:$id", Entity.create(listOf(Transform(Pose())))).apply { browser = true; panelUrl = occId.removePrefix("url:") }
      registerPanel(browserPanel(id, READER_W, READER_H + 0.16f, holder, onClose = { closeReader(id) }))
    } else {
      val url = if (occId.isEmpty()) "$origin/?local=1" else "$origin/?read=${Uri.encode(occId)}"
      registerPanel(webPanel(id, READER_W, READER_H, toolbar = true) { web -> readerWebs[id] = web; web.loadUrl(url) })
    }
    val e = Entity.create(listOf(
        Panel(id),
        Transform(PoseMath.sane(pose ?: near?.let { readerPoseAt(it) } ?: spawnPose(1.1f, 1.45f, 0.3f, panel = true), "OfficeActivity:1344")),
    ))
    readers[id] = e
    if (occId.isNotEmpty()) { readerOcc[id] = occId; saveReaders() }
    readerHandles[id] = GrabHandle(e, -(READER_H / 2f + HANDLE_GAP / 2f), facesHead = true, widthScale = 1.5f).also { it.follow() }
    readerHandleDy[id] = -(READER_H / 2f + HANDLE_GAP / 2f)
    if (scale != 1f) scaleReader(id, scale)
  }

  /** How big each reader window is (1 = as made); kept with the open readers. */
  private val readerScale = HashMap<Int, Float>()
  /** Its handle's offset below the window's centre at scale 1. */
  private val readerHandleDy = HashMap<Int, Float>()

  private fun scaleReader(id: Int, factor: Float) {
    val e = readers[id] ?: return
    val s = ((readerScale[id] ?: 1f) * factor).coerceIn(SCALE_MIN, SCALE_MAX)
    readerScale[id] = s
    e.setComponent(Scale(Vector3(s)))
    readerHandles[id]?.let { h -> readerHandleDy[id]?.let { h.dy = it * s }; h.follow() }
  }

  /** A reader at `p` — raised or lowered to reading height — turned to face you. */
  private fun readerPoseAt(p: FloatArray): Pose {
    val at = floatArrayOf(p[0], p[1].coerceIn(1.0f, 1.7f), p[2])
    val head = headPose()?.let { PoseMath.tOf(it) } ?: return PoseMath.pose(at, PoseMath.yaw(180f))
    return PoseMath.pose(at, PoseMath.yaw(PoseMath.yawToward(at, head) + 180f))
  }

  private fun closeReader(id: Int) {
    main.post {
      pieceWindows.entries.removeAll { it.value == id }
      readerHandles.remove(id)?.destroy(); readers.remove(id)?.destroy(); readerWebs.remove(id)
      readerScale.remove(id); readerHandleDy.remove(id)
      if (readerOcc.remove(id) != null) saveReaders()
    }
  }

  /** Keep the open books and pages (and where they float) so they are there when you come back. */
  private fun saveReaders() {
    if (store.gridId.isEmpty() || readersRestoredFor != store.gridId) return
    val list = readerOcc.mapNotNull { (id, occ) ->
      val p = readers[id]?.tryGetComponent<Transform>()?.transform ?: return@mapNotNull null
      val t = PoseMath.tOf(p); val q = PoseMath.qOf(p)
      JSONObject().put("occ", occ).put("s", Math.round((readerScale[id] ?: 1f) * 1000) / 1000.0)
          .put("t", org.json.JSONArray(t.map { Math.round(it * 1000) / 1000.0 }))
          .put("q", org.json.JSONArray(q.map { Math.round(it * 1000) / 1000.0 }))
    }
    val json = org.json.JSONArray(list).toString()
    if (json == lastReadersSaved) return
    lastReadersSaved = json
    store.saveReaders(list)
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
        Transform(PoseMath.sane(PoseMath.pose(floatArrayOf(0.28f, 0f, 0f), PoseMath.yaw(180f)), "OfficeActivity:1404")),
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
        Transform(PoseMath.sane(PoseMath.pose(floatArrayOf(0.28f + GEAR_M / 2f + 0.015f + TRASH_W / 2f, 0f, 0f), PoseMath.yaw(180f)), "OfficeActivity:1440")),
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

  /** A VHS player's screen: kept in its decor entry on the headset (and so in the layout backup). */
  private fun setDecorScreen(key: String, screenId: String?) {
    val list = store.decor().map { if (it.optString("key") == key) JSONObject(it.toString()).apply {
      if (screenId == null) remove("screenId") else put("screenId", screenId)
    } else it }
    store.saveDecor(list)
    things[key]?.decorEntry = list.firstOrNull { it.optString("key") == key }
  }

  /** Open `key`'s own settings window in front of you, or close it if it is open. */
  private fun togglePiece(key: String) {
    pieceWindows[key]?.let { closeReader(it); return }
    val id = nextPanelId++
    registerPanel(webPanel(id, PIECE_W, PIECE_H, toolbar = true) { web ->
      // A decor piece's window is told its model (and a VHS player its screen), which only the headset knows.
      val extra = things[key]?.decorEntry?.let { e ->
        "&model=" + Uri.encode(e.optString("model")) + (e.optString("screenId").takeIf { it.isNotEmpty() }?.let { "&screen=" + Uri.encode(it) } ?: "")
      } ?: ""
      web.loadUrl("$origin/?office&piece=${Uri.encode(key)}$extra")
    })
    val e = Entity.create(listOf(Panel(id), Transform(PoseMath.sane(spawnPose(1.0f, 1.35f, 0.35f, panel = true), "OfficeActivity:1474"))))
    readers[id] = e
    readerHandles[id] = GrabHandle(e, -(PIECE_H / 2f + HANDLE_GAP / 2f), facesHead = true).also { it.follow() }
    pieceWindows[key] = id
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
