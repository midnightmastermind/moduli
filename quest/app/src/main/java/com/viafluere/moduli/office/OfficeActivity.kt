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
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.foundation.layout.widthIn
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
import com.meta.spatial.toolkit.UIPanelRenderOptions
import com.meta.spatial.toolkit.PanelRenderMode
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
    /** The record player's Spotify card: tall enough for Spotify's full player (its track list and controls) — at 0.26m
     *  the embed was cut off (user, 2026-10-25). */
    private const val SPOTIFY_W = 0.62f
    /** A song's record, opened out of its album, is this much of an album's. */
    private const val MINI_RECORD = 0.62f
    private const val SPOTIFY_H = 0.56f
    /** Holding a carried book over a folder book (or ⬆) this long opens it. */
    private const val DRAG_OPEN_MS = 900L
    /** Held on the ⬆ this long, the shelf goes up a level (user: 0.9s was too quick, 2s too slow — 1s). */
    private const val DRAG_UP_MS = 1000L
    /** Fewer page pixels a metre than a browser screen, so Spotify's controls draw big enough to hit (user). */
    private const val SPOTIFY_DP_PER_M = 720f
    /**
     * Every panel is drawn as a surface in the room, not as its own compositor layer. The headset takes at most 16
     * layers a frame; with 17 panels showing it threw the WHOLE frame away (XR_ERROR_LAYER_LIMIT_EXCEEDED — the room
     * went black), and as menus, cards and players came and went the count crossed 16 back and forth: the flicker.
     */
    private val PANEL_RENDER = UIPanelRenderOptions(PanelRenderMode.Mesh())
    private const val BROWSER_DP_PER_M = 1000f
    /** The PC screen (Chrome Remote Desktop) draws the PC's desktop at full size, 1920 x 1080 plus a 22px bar, and its
     *  "Scale to fit" does not shrink it in this engine: at 1000 dp a metre the page was 1608 x 948 and the right and
     *  bottom fell off, and the remote cursor was placed as if scaled (measured 2026-10-27). 1200 dp a metre gives the
     *  page ~1920 x 1160. Only that screen: the others keep their text size. */
    private const val REMOTE_DP_PER_M = 1200f
    /** A browser screen's texture at 0.7 of its page size: the page keeps its desktop width (1000 dp a metre) but each
     *  screen holds half the graphics memory — at full size the room ran the headset out of memory and went black. */
    private const val BROWSER_RES = 0.7f
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
    /** The 🗑 reads "Sure?" while armed; a second press within 3s deletes (pressTrash). */
    var trashArmed = false
    var trashArmedAt = 0L
    /** The piece's height at scale 1 (the model, or its web panel when that stands taller). */
    var top = 1f
    /** A panel's handle hangs below it (its origin is its centre); furniture's floats above. */
    var handleBelow = false
    var scale = 1f
    var lastScale = 1f
    var panel: Entity? = null
    /** The panel's size at scale 1 (metres). */
    var panelW = 0f
    var panelH = 0f
    /** Where the panel sits on the piece at scale 1 (height, distance out front). */
    var panelAt = floatArrayOf(0f, 0f)
    /** The ⚙ beside the handle that opens this piece's own settings window. */
    var gear: Entity? = null
    /** A shelf's grabbable books (the current page), its slots, what it holds and which page it shows. */
    val books = ArrayList<Book>()
    var slots: List<ShelfLayout.Slot> = emptyList()
    var shelfItems: org.json.JSONArray = org.json.JSONArray()
    /** Books still in a hand while the shelf went to another folder (released, they are let go of there). */
    val carried = ArrayList<Book>()
    /** The shelf as the control panel last sent it (a delete takes books off it at once, before the next one). */
    var shelfJson: JSONObject? = null
    /** The shelf stands in a folder below its top (its ⬆ shows). */
    var canUp = false
    /** The shelf's search: the ids it matched, in order (null = no search, every item). */
    var filterIds: List<String>? = null
    var page = 0
    var shelfSize: OfficeSizes.Shelf? = null
    /** "book" | "record" | "vhs": what you hold when you take something off this shelf. */
    var shelfAsset = "book"
    /** Select mode on a shelf (its Select button): a tap picks a book for Delete instead of opening it. */
    var selecting = false
    /** Items picked with Select → Move, kept while you go to where they should go (folder ids keep their folder: prefix). */
    var moving: List<String> = emptyList()
    /** The book a controller is pointing at on this shelf (its spine lights up), or null. */
    var hoverBook: String? = null
    /** What the shelf page lights as the drop target of a carried book ('up', an item id, or null). */
    var dropShown: String? = null
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
    /** A record player playing through Spotify: the page its Firefox-engine panel shows, and that panel's session. */
    var spotifyUrl: String? = null
    var spotifyTitle = ""
    var gecko: GeckoBrowser? = null
    /** An album playing as its songs (it has no Spotify album link): the songs (title, url) and which one is on. */
    var queue: List<Pair<String, String>> = emptyList()
    var queueAt = 0
    /** What the Spotify window's header shows (it changes as the queue moves). */
    val nowPlaying = androidx.compose.runtime.mutableStateOf("")
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
    /** An album on a record shelf (dropped anywhere but a player it opens into its songs); a song in it is a mini record. */
    var album = false
    var mini = false
    var held = false
    /** The card (cover + title) floating over it while held: an index into `cards`, or -1. */
    var card = -1
    var grabbedAt = 0L
    var placedScale = -1f
    /** While held: what you see (the grabbed block stays in your hand; this is pushed out / pulled in along your
     *  line of sight by the right thumbstick, like furniture), and how far. */
    var shown: Entity? = null
    var reach = 0f
    /** Pressed in Select mode: it was selected on the press and is not carried. */
    var selectGrab = false
    /** While carried over its shelf: what it is over ("up", "folder:<id>") and since when (a held dwell opens it). */
    var overWhat: String? = null
    /** The drop target the controller aims at this frame ('up' / 'folder:<id>'), or null. */
    var aimWhat: String? = null
    var aimLogAt = 0L
    var overSince = 0L
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
  /** A piece's web panel by its panel id (screens, the grid screen, shelves): what a drag that starts there needs. */
  private val panelThings = HashMap<Int, Thing>()
  /** Each reader window's page (a drag carried into it asks the page where it landed). */
  private val readerWebs = HashMap<Int, WebView>()
  /** What each open reader shows (books and pages, not settings windows) — saved, so they are there next time. */
  private val readerOcc = HashMap<Int, String>()
  private var lastReadersSaved = ""
  /** The grid whose open readers have been put back (once per grid, after the room is built). */
  private var readersRestoredFor = ""
  private val readerHandles = HashMap<Int, GrabHandle>()
  /** A bookmark window's browser (closed with its window). */
  private val readerGecko = HashMap<Int, GeckoBrowser>()
  /** The web window last pressed: a physical keyboard's keys reach the activity's own window, never a panel's. */
  private var keyTarget: android.view.View? = null
  /** Open settings windows, by piece key (one per piece; its ⚙ opens and closes it). */
  private val pieceWindows = HashMap<String, Int>()
  /**
   * Furniture moves only in "Move furniture" mode (the main panel's switch; off at every start). Off, no piece shows
   * its bar, ⚙ or 🗑 and none can be grabbed — so reaching for a book never moves the shelf.
   */
  private var moveMode = false
  /** The book / record / tape in your hand, if any (the right thumbstick pushes it out or pulls it in). */
  private var heldBook: Book? = null
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

  /**
   * Present a WebView to sites as a desktop Chrome in every way they check: the user agent, no `X-Requested-With`
   * header naming this app, and client-hint brands without "Android WebView". Google's sign-in refused it as "not
   * secure" while any of those said embedded (user, 2026-10-25), which Chrome Remote Desktop needs.
   */
  private var chromeSupportLogged = false
  private fun presentAsChrome(web: WebView) {
    web.settings.userAgentString = desktopUserAgent(web.settings.userAgentString)
    if (!chromeSupportLogged) {
      chromeSupportLogged = true
      Log.i(TAG, "web view as Chrome: no X-Requested-With " +
          androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST) +
          ", client-hint brands " + androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.USER_AGENT_METADATA))
    }
    try {
      if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST))
        androidx.webkit.WebSettingsCompat.setRequestedWithHeaderOriginAllowList(web.settings, emptySet())
      if (androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.USER_AGENT_METADATA)) {
        val full = Regex("Chrome/([0-9.]+)").find(web.settings.userAgentString)?.groupValues?.get(1) ?: "130.0.0.0"
        val major = full.substringBefore('.')
        fun brand(name: String, v: String) = androidx.webkit.UserAgentMetadata.BrandVersion.Builder()
            .setBrand(name).setMajorVersion(v).setFullVersion(if (v == major) full else "$v.0.0.0").build()
        androidx.webkit.WebSettingsCompat.setUserAgentMetadata(web.settings, androidx.webkit.UserAgentMetadata.Builder()
            .setBrandVersionList(listOf(brand("Google Chrome", major), brand("Chromium", major), brand("Not_A Brand", "24")))
            .setFullVersion(full).setPlatform("Linux").setPlatformVersion("6.0.0").setArchitecture("x86")
            .setModel("").setMobile(false).setBitness(64).build())
      }
    } catch (e: Throwable) { Log.w(TAG, "could not present the web view as Chrome", e) }
  }

  /** This WebView's Chrome presented as desktop Chrome (same version): sites gate their web apps on it. */
  private fun desktopUserAgent(current: String): String {
    val ver = Regex("Chrome/([0-9.]+)").find(current)?.groupValues?.get(1) ?: "130.0.0.0"
    return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$ver Safari/537.36"
  }

  /** Grants protected media (Spotify's full tracks need DRM); every other permission a page asks for is refused. */
  private fun protectedMediaChrome() = object : WebChromeClient() {
    override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
      val ok = request.resources.filter { it == android.webkit.PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }
      if (ok.isNotEmpty()) request.grant(ok.toTypedArray()) else request.deny()
    }
  }

  /** A panel holding a WebView. `toolbar` adds Close and Reload above it (reader panels). */
  @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
  private fun webPanel(id: Int, w: Float, h: Float, toolbar: Boolean, dpPerMeter: Float = 500f, onWeb: (WebView) -> Unit): PanelRegistration =
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
                            if (ev.actionMasked == android.view.MotionEvent.ACTION_DOWN) { keyTarget = v; if (!v.hasFocus()) v.requestFocus() }
                            false
                          }
                          webViewClient = WebViewClient()
                          // Spotify's embedded player (a record with no audio file of its own): it runs in an iframe, needs
                          // the spotify.com sign-in cookie (a third-party cookie here) and protected media for full tracks.
                          android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                          presentAsChrome(this)
                          webChromeClient = protectedMediaChrome()
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
                rendering = PANEL_RENDER,
                shape = QuadShapeOptions(width = w, height = h),
                style = PanelStyleOptions(themeResourceId = R.style.PanelAppThemeTransparent),
                display = if (dpPerMeter == 500f) DpPerMeterDisplayOptions() else DpPerMeterDisplayOptions(dpPerMeter = dpPerMeter, resolutionScale = BROWSER_RES),
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

  /** A browser screen's panel: back / forward / reload and an address bar over Firefox's engine (GeckoBrowser — the
   *  system WebView names this app in a header, and Google refuses to sign it in). No frame: most sites refuse to be
   *  shown in one. The page it is on is kept on the decor entry, so it reopens there. */
  private fun browserPanel(id: Int, w: Float, h: Float, t: Thing, onClose: (() -> Unit)? = null): PanelRegistration =
      ComposeViewPanelRegistration(
          id,
          composeViewCreator = { _, ctx ->
            ComposeView(ctx).apply {
              setContent {
                var address by remember { mutableStateOf(t.panelUrl ?: "") }
                var web by remember { mutableStateOf<GeckoBrowser?>(null) }
                Column(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0xFF1D1D1D))) {
                  Row(Modifier.fillMaxWidth().padding(6.dp)) {
                    if (onClose != null) Button(onClick = onClose) { Text("Close") }
                    Button(onClick = { web?.back() }) { Text("◀") }
                    Button(onClick = { web?.forward() }) { Text("▶") }
                    Button(onClick = { web?.reload() }) { Text("⟳") }
                    // White on the dark bar (the default ink is dark and the address read as empty), and a press
                    // on it takes a paired keyboard back from the page.
                    androidx.compose.material3.OutlinedTextField(
                        value = address,
                        onValueChange = { address = it },
                        singleLine = true,
                        textStyle = androidx.compose.ui.text.TextStyle(color = androidx.compose.ui.graphics.Color.White, fontSize = 16.sp),
                        colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                            focusedTextColor = androidx.compose.ui.graphics.Color.White,
                            unfocusedTextColor = androidx.compose.ui.graphics.Color.White,
                            cursorColor = androidx.compose.ui.graphics.Color.White,
                            focusedBorderColor = androidx.compose.ui.graphics.Color(0xFF64A0FF),
                            unfocusedBorderColor = androidx.compose.ui.graphics.Color(0xFF888888),
                        ),
                        modifier = Modifier.weight(1f).widthIn(min = 240.dp).padding(horizontal = 6.dp)
                            .onFocusChanged { if (it.isFocused) keyTarget = null },
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Go),
                        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onGo = { web?.load(addressToUrl(address)) }),
                    )
                    Button(onClick = { web?.load(addressToUrl(address)) }) { Text("Go") }
                    // ☆ saves this page to the Bookmarks board (the control panel writes it), ★ when it is there.
                    val saved = bookmarkBar.any { it.second == address }
                    Button(onClick = {
                      val g = web ?: return@Button
                      if (!saved) send(JSONObject().put("type", "saveBookmark").put("url", g.url).put("title", g.title))
                    }) { Text(if (saved) "★" else "☆") }
                  }
                  // The bookmarks bar, under the address bar like any browser's. FIXED height, empty or not: it used to
                  // start empty and grow when the bookmarks arrived, which shrank the page under it after it had laid
                  // out — Remote Desktop then drew your PC's cursor ~100px above where it was (user, 2026-10-27:
                  // "it works for a bit then drifts").
                  Row(Modifier.fillMaxWidth().height(48.dp).horizontalScroll(androidx.compose.foundation.rememberScrollState()).padding(horizontal = 6.dp),
                      verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    for ((title, url) in bookmarkBar) {
                      androidx.compose.material3.TextButton(onClick = { web?.load(url) }) {
                        Text(title.ifEmpty { url }.take(24), maxLines = 1)
                      }
                    }
                  }
                  AndroidView(
                      modifier = Modifier.fillMaxSize(),
                      factory = { c ->
                        val g = GeckoBrowser(c, t.panelUrl ?: "https://www.google.com", onUrl = { u ->
                          address = u
                          main.post { rememberBrowserUrl(t, u) }
                        }, onPressed = { v -> keyTarget = v })
                        web = g
                        // Kept where closing the screen or window can shut it (and its sound) down.
                        t.gecko = g
                        t.key.removePrefix("reader:").takeIf { t.key.startsWith("reader:") }?.toIntOrNull()?.let { readerGecko[it] = g }
                        g.view
                      },
                      onRelease = { web?.close() },
                  )
                }
              }
            }
          },
          settingsCreator = {
            UIPanelSettings(
                rendering = PANEL_RENDER,
                shape = QuadShapeOptions(width = w, height = h),
                style = PanelStyleOptions(themeResourceId = R.style.PanelAppThemeTransparent),
                // 1000 dp a metre (the default is 500): a 1.6m screen is 1,600 page pixels wide, like a desktop monitor — at
                // 800 a PC's desktop over Remote Desktop and most sites read zoomed in.
                display = DpPerMeterDisplayOptions(
                    dpPerMeter = if (t.decorEntry?.optString("model") == "remotedesktop") REMOTE_DP_PER_M else BROWSER_DP_PER_M,
                    resolutionScale = BROWSER_RES),
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
      "playQueue" -> things[m.optString("key")]?.let { p ->
        val a = m.optJSONArray("items") ?: org.json.JSONArray()
        val items = (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let { o -> o.optString("title") to o.optString("url") } }
        val fallback = m.optString("fallback")
        if (items.isEmpty() && fallback.isNotEmpty()) playRecord(p, m.optString("title"), "", fallback)
        else playQueue(p, m.optString("title"), items)
      }
      "shelfPage" -> things[m.optString("key")]?.let { t -> t.page = m.optInt("page"); t.shelfSize?.let { buildBooks(t, it) } }
      // The shelf's search box: the books follow the matches it shows.
      "shelfFilter" -> things[m.optString("key")]?.let { t ->
        t.filterIds = m.optJSONArray("ids")?.let { a -> (0 until a.length()).map { a.optString(it) } }
        t.page = m.optInt("page"); t.shelfSize?.let { buildBooks(t, it) }
      }
      "addDecor" -> addDecor(m)
      // Folder shelves are trees and shelves can delete: the control panel (signed in, holds the grid) does both.
      "openFolder", "shelfUp", "newFolder" -> send(m)
      "deleteItems" -> {
        send(m)
        // Off the shelf at once: the control panel's next state (every shelf rebuilt) took seconds to arrive.
        m.optJSONArray("items")?.let { a -> dropFromShelves((0 until a.length()).map { a.optString(it) }.toSet()) }
        m.optJSONArray("ids")?.let { a -> dropFromShelves((0 until a.length()).map { a.optString(it) }.toSet()) }
        // A book's reader may show its FILE rather than the row being deleted: close those too.
        m.optJSONArray("items")?.let { a ->
          val ids = (0 until a.length()).map { a.optString(it) }.toSet()
          for ((id, occ) in readerOcc.toList()) if (occ in ids) closeReader(id)
        }
      }
      "shelfSelect" -> things[m.optString("key")]?.selecting = m.optBoolean("on")
      // Select → Move: keep the picked set; the shelf shows "Move N here" until it is used or cancelled.
      "moveStart" -> things[m.optString("key")]?.let { t ->
        t.moving = m.optJSONArray("ids")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
        t.shelfJson?.let { ensureShelf(it) }
      }
      "moveHere" -> things[m.optString("key")]?.let { t ->
        if (t.moving.isNotEmpty()) send(JSONObject().put("type", "moveItems").put("key", t.key).put("ids", org.json.JSONArray(t.moving)))
        Log.i(TAG, "move ${t.moving.size} into where ${t.key} stands")
        t.moving = emptyList(); t.shelfJson?.let { ensureShelf(it) }
      }
      "moveCancel" -> things[m.optString("key")]?.let { t -> t.moving = emptyList(); t.shelfJson?.let { ensureShelf(it) } }
      // Select → Open: each picked book in its own window, side by side in front of you.
      "openItems" -> things[m.optString("key")]?.let { t ->
        val ids = m.optJSONArray("items")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
        ids.forEachIndexed { i, id ->
          val side = (i - (ids.size - 1) / 2f) * 0.8f
          val url = bookUrl(t, id)
          openReader(if (url.isNotEmpty()) "url:$url" else id, pose = spawnPose(1.1f, 1.4f, side, panel = true))
        }
        Log.i(TAG, "opened ${ids.size} from ${t.key}")
      }
      // Something was deleted (a page from its menu, a book from a shelf): the reader windows showing it close.
      "gone" -> m.optJSONArray("ids")?.let { a ->
        val ids = (0 until a.length()).map { a.optString(it) }.toSet()
        dropFromShelves(ids)
        for ((id, occ) in readerOcc.toList()) if (occ in ids) closeReader(id)
      }
      "dragStart" -> onDragStart(m)
      "dragEnd" -> pendingDrag?.let { if (it.fromPanel == m.optInt("_panel", -1)) { it.ended = true; it.dropped = m.optBoolean("dropped"); Log.i(TAG, "drag end in window ${it.fromPanel}, taken there: ${it.dropped}") } }
      "placed" -> m.optJSONArray("panels")?.let { a -> for (i in 0 until a.length()) readerWebs[a.optInt(i)]?.reload() }
      // The new-note screen's button: the control panel (signed in, holds the grid) makes the page, then says "openNote".
      "newNote" -> send(JSONObject().put("type", "newNote").put("key", m.optString("key")))
      "openNote" -> {
        val at = things[m.optString("key")]?.frame?.tryGetComponent<Transform>()?.transform
        // In front of you, a little to the side of the screen: opened AT the screen it stood behind it, out of sight
        // ("nothing happens when i click new note").
        openReader(m.optString("id"), near = at?.let { pose ->
          val p = PoseMath.tOf(pose); val h = headPose()?.let { PoseMath.tOf(it) } ?: return@let null
          floatArrayOf(p[0] + (h[0] - p[0]) * 0.45f, 1.4f, p[2] + (h[2] - p[2]) * 0.45f)
        })
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
    // Once: the windows already placed become open windows, where they stand (user, 2026-10-27: "replace the
    // window i have placed with that"). The key stays, so each keeps its place; new painted windows stay possible.
    if (store.once("openwindow-swap")) store.saveDecor(store.decor().map { e ->
      if (e.optString("model") == "window") JSONObject(e.toString()).put("model", "openwindow").put("title", "Open window") else e
    })
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
  private fun modelFile(model: String) = when (model) { "gridscreen", "notepad", "browser", "claude", "remotedesktop" -> "screen"; else -> model }

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
      // The model FILE (a PC or Claude screen draws screen.glb): its see-through copy is "<file>-ghost", and
      // "remotedesktop-ghost.glb" does not exist (it crashed the app).
      t.model = modelFile(model); t.hx = size.optDouble("hx").toFloat(); t.hz = size.optDouble("hz").toFloat()
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

  /** Take these rows (or files) off every shelf showing them, now. */
  private fun dropFromShelves(ids: Set<String>) {
    if (ids.isEmpty()) return
    for (t in things.values.toList()) {
      val sj = t.shelfJson ?: continue
      val items = sj.optJSONArray("items") ?: continue
      val keep = org.json.JSONArray()
      for (i in 0 until items.length()) items.optJSONObject(i)?.let { it ->
        if (it.optString("id") !in ids && (it.isNull("rowId") || it.optString("rowId") !in ids)) keep.put(it)
      }
      if (keep.length() != items.length()) ensureShelf(JSONObject(sj.toString()).put("items", keep))
    }
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
    t.canUp = s.optBoolean("canUp")
    t.shelfJson = s
    val pages = maxOf(1, (t.shelfItems.length() + t.slots.size - 1) / t.slots.size)
    t.page = t.page.coerceIn(0, pages - 1)
    val html = PanelHtml.shelf(s, t.slots, size.h, t.page, t.moving.size)
    // The control panel resends its state on every change anywhere in the grid; a shelf whose contents did not
    // change keeps its page (reloading it repainted every cover and rebuilt every book — part of the lag).
    if (t.panel != null && html == t.html) return
    t.html = html
    t.selecting = false
    t.filterIds = null
    attachPanel(t, size.w - 0.06f, size.h + PanelHtml.HEADER_M, (size.h + PanelHtml.HEADER_M) / 2f, size.d / 2f + 0.01f)
    buildBooks(t, size)
  }

  // ── Books you can take off a shelf ───────────────────────────────────────
  /** Lay a grabbable book over each spine on the shelf's current page (the old ones go). */
  private fun buildBooks(t: Thing, size: OfficeSizes.Shelf) {
    // A book in your hand stays there (the shelf may have opened a folder under it); the rest go.
    for (b in t.books) if (b.held) t.carried += b else b.entity.destroy()
    t.books.clear()
    val start = t.page * t.slots.size
    // Searching, the books are the matches (the shelf page draws the same list).
    val list: List<JSONObject> = t.filterIds?.let { ids ->
      val byId = HashMap<String, JSONObject>()
      for (k in 0 until t.shelfItems.length()) t.shelfItems.optJSONObject(k)?.let { byId[it.optString("id")] = it }
      ids.mapNotNull { byId[it] }
    } ?: (0 until t.shelfItems.length()).mapNotNull { t.shelfItems.optJSONObject(it) }
    for (i in t.slots.indices) {
      val item = list.getOrNull(start + i) ?: break
      val title = item.optString("title")
      val e = Entity.create(listOf(
          Mesh(Uri.parse("apk:///office/bookproxy.glb"), hittable = MeshCollision.LineTest),
          Scale(Vector3(1f)),
          Transform(Pose()),
          Grabbable(true, GrabbableType.PIVOT_Y),
      ))
      t.books += Book(item.optString("id"), title, (if (item.isNull("cover")) "" else item.optString("cover")), t.slots[i], PanelHtml.spineColor(title), e).apply {
        folder = item.optBoolean("folder"); url = item.optString("url").takeIf { !item.isNull("url") } ?: ""
        album = item.optBoolean("album"); mini = item.optBoolean("mini")
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

  /** The held thing as you see it: the grabbed block's pose, moved `reach` metres along the line from your head
   *  through it (never nearer than 0.2m). */
  private fun placeShown(b: Book) {
    val e = b.shown ?: return
    val at = b.entity.tryGetComponent<Transform>()?.transform ?: return
    val head = headPose()
    var p = PoseMath.tOf(at)
    if (head != null && b.reach != 0f) {
      val h = PoseMath.tOf(head)
      val d = floatArrayOf(p[0] - h[0], p[1] - h[1], p[2] - h[2])
      val len = kotlin.math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).takeIf { it > 1e-3f } ?: 1f
      b.reach = b.reach.coerceIn(0.2f - len, 6f)
      p = floatArrayOf(p[0] + d[0] / len * b.reach, p[1] + d[1] / len * b.reach, p[2] + d[2] / len * b.reach)
    }
    e.setComponent(Transform(PoseMath.sane(PoseMath.pose(p, PoseMath.qOf(at)), "OfficeActivity:placeShown")))
  }

  /** The card floats just above the held thing, turned to face you. */
  private fun placeCard(t: Thing, b: Book) {
    val i = b.card
    if (i < 0) return
    val at = (b.shown ?: b.entity).tryGetComponent<Transform>()?.transform ?: return
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
        val k = if (b.mini) MINI_RECORD else 1f
        val hw = b.slot.w * s * k / 2f; val hh = b.slot.h * s * k / 2f; val hd = BOOK_PROXY_DEPTH * s / 2f
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

  /** Where `p` is in the shelf's own frame, unscaled (the slots' frame). */
  private fun shelfLocal(t: Thing, p: FloatArray): FloatArray? {
    val pose = t.frame.tryGetComponent<Transform>()?.transform ?: return null
    val (l, _) = PoseMath.toLocal(pose, PoseMath.pose(p, floatArrayOf(1f, 0f, 0f, 0f)))
    val s = t.scale.takeIf { it > 0f } ?: 1f
    return floatArrayOf(l[0] / s, l[1] / s, l[2] / s)
  }

  /** Is a point (shelf frame) over the header's ⬆ (the shelf is inside a folder)? */
  private fun overUp(t: Thing, l: FloatArray): Boolean {
    val size = t.shelfSize ?: return false
    // The panel's LEFT is the shelf frame's +x (ShelfLayout: column 0 sits at panelW/2), and the ⬆ is the header's first
    // button — so it is at the +x end. Tested at the -x end it lit over the Select button (user, 2026-10-27).
    return t.canUp && l[1] >= size.h && l[0] >= (size.w - 0.06f) / 2f - 0.14f
  }

  /** Is a point (shelf frame) at the front of the shelf, over its books or its header? */
  private fun overShelf(t: Thing, l: FloatArray): Boolean {
    val size = t.shelfSize ?: return false
    return kotlin.math.abs(l[0]) <= size.w / 2f + 0.05f && l[1] in -0.05f..(size.h + PanelHtml.HEADER_M + 0.05f) &&
        l[2] in (-size.d / 2f - 0.05f)..(size.d / 2f + 0.4f)
  }

  /** The book on this page whose spine a point (shelf frame) is over, and whether it is in the left half of it. */
  private fun bookAt(t: Thing, l: FloatArray, except: Book): Pair<Book, Boolean>? {
    val hit = t.books.filter { it !== except }.minByOrNull { b ->
      val dx = kotlin.math.abs(l[0] - b.slot.x); val dy = kotlin.math.abs(l[1] - b.slot.y)
      if (dx <= b.slot.w / 2f + 0.02f && dy <= b.slot.h / 2f + 0.03f) dx + dy else Float.MAX_VALUE
    } ?: return null
    val dx = kotlin.math.abs(l[0] - hit.slot.x); val dy = kotlin.math.abs(l[1] - hit.slot.y)
    if (dx > hit.slot.w / 2f + 0.02f || dy > hit.slot.h / 2f + 0.03f) return null
    return hit to (l[0] < hit.slot.x)
  }

  /**
   * Where a controller ray meets the front of the shelf (shelf frame, unscaled), or null. A carried book sits at your
   * hand — well in front of the shelf — so its own position never reached the ⬆ or a folder book (user, 2026-10-27:
   * "dragging a folder to the move up folder button doesnt highlight the button … nor completes the drop").
   */
  private fun aimLocal(t: Thing): FloatArray? {
    val pose = t.frame.tryGetComponent<Transform>()?.transform ?: return null
    val s = t.scale.takeIf { it > 0f } ?: 1f
    val qi = PoseMath.qConj(PoseMath.qOf(pose)); val origin = PoseMath.tOf(pose)
    val zf = bookFront[t.key] ?: 0.2f
    for ((o, d) in controllerRays()) {
      val lo = PoseMath.rotate(qi, floatArrayOf(o[0] - origin[0], o[1] - origin[1], o[2] - origin[2])).map { it / s }
      val ld = PoseMath.rotate(qi, d)
      if (kotlin.math.abs(ld[2]) < 1e-4f) continue
      val k = (zf - lo[2]) / ld[2]
      if (k <= 0f) continue
      val l = floatArrayOf(lo[0] + ld[0] * k, lo[1] + ld[1] * k, zf)
      if (overShelf(t, l)) return l
    }
    return null
  }

  /** The drop target a controller aims at while carrying `b`: "up" (the ⬆), "folder:<id>", or null. */
  private fun aimTarget(t: Thing, b: Book): String? {
    val l = aimLocal(t) ?: return null
    if (overUp(t, l)) return "up"
    bookAt(t, l, except = b)?.first?.takeIf { it.folder && it.itemId != b.itemId }?.let { return "folder:" + it.itemId }
    // Carried in from another folder: aimed anywhere at this shelf, it is filed here. (Not a book of this page: a
    // tap on it, the ray still on the shelf, must stay a tap.)
    return if (b in t.carried) "here" else null
  }

  /** Is a controller ray on `b`'s own spine (its slot on the shelf)? */
  private fun aimingAt(t: Thing, b: Book): Boolean {
    val l = aimLocal(t) ?: return false
    return kotlin.math.abs(l[0] - b.slot.x) <= b.slot.w / 2f + 0.02f && kotlin.math.abs(l[1] - b.slot.y) <= b.slot.h / 2f + 0.03f
  }

  /** Light the drop target on the shelf page (or clear it). */
  private fun showDrop(t: Thing, what: String?) {
    val show = what?.takeIf { it != "here" }?.removePrefix("folder:")
    if (show == t.dropShown) return
    t.dropShown = show
    t.web?.evaluateJavascript("dropOn(${if (show == null) "null" else JSONObject.quote(show)})", null)
  }

  /**
   * Carrying a book over its shelf: held a moment over a folder book, the folder opens; over the ⬆ in the header,
   * the shelf goes up a level — so a book can be taken into another folder (and let go of there).
   */
  private fun dragOverShelf(t: Thing, b: Book, now: Long) {
    val size = t.shelfSize ?: return
    val p = (b.shown ?: b.entity).tryGetComponent<Transform>()?.transform?.let { PoseMath.tOf(it) } ?: return
    b.aimWhat = aimTarget(t, b)
    showDrop(t, b.aimWhat)
    if (now - b.aimLogAt > 500) {
      b.aimLogAt = now
      val a = aimLocal(t)
      Log.i(TAG, "aim ${b.title}: ${a?.joinToString { "%.3f".format(it) } ?: "off the shelf"} size w=${"%.3f".format(size.w)} h=${"%.3f".format(size.h)} canUp=${t.canUp} up>=x ${"%.3f".format((size.w - 0.06f) / 2f - 0.14f)} -> ${b.aimWhat}")
    }
    val l = shelfLocal(t, p)?.takeIf { overShelf(t, it) }
    val what = b.aimWhat ?: when {
      l == null -> null
      overUp(t, l) -> "up"
      else -> bookAt(t, l, except = b)?.first?.takeIf { it.folder }?.let { "folder:" + it.itemId }
    }
    if (what != b.overWhat) { b.overWhat = what; b.overSince = now; return }
    if (what == null || what == "here" || now - b.overSince < (if (what == "up") DRAG_UP_MS else DRAG_OPEN_MS)) return
    // A folder opens once per stay; held on the ⬆ the shelf keeps climbing, a level every DRAG_OPEN_MS.
    b.overSince = if (what == "up") now else Long.MAX_VALUE / 2
    if (what == "up") send(JSONObject().put("type", "shelfUp").put("key", t.key))
    else send(JSONObject().put("type", "openFolder").put("key", t.key).put("folderId", what.removePrefix("folder:")))
    Log.i(TAG, "carrying ${b.title}: ${if (what == "up") "up a level" else "into $what"}")
  }

  /**
   * Every frame: a resting book stays on its slot; take one off the shelf and it turns into a solid book in your
   * hand (its spine hides); let go of it away from the shelf — or just tap it — and it opens to read, then goes back.
   */
  private fun updateBooks() {
    val now = System.currentTimeMillis()
    hoverBooks()
    for (t in things.values) {
      if (t.books.isEmpty() && t.carried.isEmpty()) continue
      val s = t.scale
      for (b in (t.books + t.carried)) {
        val grabbed = b.entity.tryGetComponent<Grabbable>()?.isGrabbed == true
        // Select mode: the press selects (at once — no book in the hand, no card); letting go does nothing.
        if (grabbed && !b.held && t.selecting) { b.held = true; b.selectGrab = true; selectBook(t, b); continue }
        if (grabbed && b.selectGrab) continue
        if (!grabbed && b.selectGrab) { b.held = false; b.selectGrab = false; b.placedScale = -1f }
        if (grabbed && !b.held) {
          b.held = true; b.grabbedAt = now; b.overWhat = null
          // A book fills its slot (spine width = its thickness); a record sleeve and a tape are drawn at real size.
          val held = when (t.shelfAsset) { "record" -> "record"; "vhs" -> "vhs"; else -> "book" }
          b.reach = 0f
          b.shown = Entity.create(listOf(
              Mesh(Uri.parse("apk:///office/$held-${b.color}.glb")),
              Scale(if (held == "book") Vector3(BOOK_DEPTH * s, b.slot.h * s, b.slot.w * s) else Vector3(s)),
              Transform(b.entity.tryGetComponent<Transform>()?.transform ?: Pose()),
          ))
          heldBook = b
          t.web?.evaluateJavascript("hold(${JSONObject.quote(b.itemId)}, true)", null)
          b.card = showCard(b)
          Log.i(TAG, "took ${b.title} off ${t.key}")
          continue
        }
        if (grabbed) { placeShown(b); placeCard(t, b); dragOverShelf(t, b, now); continue }
        val carried = b in t.carried
        val rest = if (carried) null else (bookRestPose(t, b) ?: continue)
        if (b.held) {
          b.held = false
          // Where you let go is where you SEE it (pushed out or pulled in), not the block in your hand.
          val at = b.shown?.tryGetComponent<Transform>()?.transform ?: b.entity.tryGetComponent<Transform>()?.transform
          b.shown?.destroy(); b.shown = null
          if (heldBook === b) heldBook = null
          b.overWhat = null
          // Let go over its own shelf: onto another book (placed there) or a folder book (filed inside); anywhere
          // else on the shelf it just goes back.
          // Still at its own slot (a tap, or a pull that came back): not a drop at all.
          // Aimed at a lit drop target (the ⬆ or a folder book) when let go: that is the drop, wherever the book is.
          val aim = b.aimWhat
          b.aimWhat = null
          showDrop(t, null)
          val atRest = aim == null && rest != null && at?.let { PoseMath.near(PoseMath.tOf(it), PoseMath.tOf(rest), BOOK_PULL_M) } != false
          val onShelf = if (atRest || aim != null) null else at?.let { shelfLocal(t, PoseMath.tOf(it)) }?.takeIf { overShelf(t, it) }
          val moved = !atRest && aim == null && onShelf == null
          if (aim != null) {
            val id = if (b.folder) b.itemId else itemField(t, b.itemId, "rowId").ifEmpty { b.itemId }
            // The ⬆ is not a drop: hovering on it takes the shelf up a level (dragOverShelf); letting go there
            // puts the book back (user, 2026-10-27: "i dont want it to drop in the next level by dropping it there").
            if (aim == "up") Log.i(TAG, "${b.title} let go on ⬆: put back")
            else if (aim == "here") send(JSONObject().put("type", "shelfReorder").put("key", t.key).put("id", id).put("targetId", "").put("edge", "end"))
            else send(JSONObject().put("type", "shelfReorder").put("key", t.key).put("id", id).put("targetId", aim.removePrefix("folder:")).put("edge", "into"))
            Log.i(TAG, "${b.title} dropped by aim on $aim")
          } else if (onShelf != null) {
            val id = if (b.folder) b.itemId else itemField(t, b.itemId, "rowId").ifEmpty { b.itemId }
            val hit = bookAt(t, onShelf, except = b)
            if (overUp(t, onShelf)) {
              Log.i(TAG, "${b.title} let go on ⬆: put back")
            } else if (hit != null) {
              val (target, before) = hit
              val targetId = if (target.folder) target.itemId else itemField(t, target.itemId, "rowId").ifEmpty { target.itemId }
              // A folder book moves the folder (control panel: into a folder book, else to where the shelf stands).
              send(JSONObject().put("type", "shelfReorder").put("key", t.key).put("id", id).put("targetId", targetId)
                  .put("edge", if (target.folder) "into" else if (before) "before" else "after"))
              Log.i(TAG, "${b.title} let go on ${target.title} (${if (target.folder) "into" else if (before) "before" else "after"})")
            } else if (b.folder && b !in t.carried && aimingAt(t, b)) {
              // Let go of a folder while pointing at it: open it (not re-file it where it already is).
              activateBook(t, b)
            } else if (b in t.carried || b.folder) {
              // Let go on the shelf on no book — after carrying it into another folder (an empty one has no book to
              // drop on): it is filed where the shelf stands now.
              send(JSONObject().put("type", "shelfReorder").put("key", t.key).put("id", id).put("targetId", "").put("edge", "end"))
              Log.i(TAG, "${b.title} let go on an empty spot: filed here")
            }
          }
          if (moved) {
            val p = at?.let { PoseMath.tOf(it) }
            val player = p?.let { when (t.shelfAsset) {
              "record" -> playerNear("recordplayer", it)
              "vhs" -> playerNear("vhsplayer", it)
              else -> null
            } }
            when {
              t.selecting -> selectBook(t, b)
              // An album plays as its songs, one at a time with ⏮ ⏭ (asked of the control panel); Spotify's own album
              // player only when none of its songs has a Spotify track.
              // (With a Spotify album link it is Spotify's own album player, the case below.)
              player != null && t.shelfAsset == "record" && b.album && itemSrc(t, b.itemId).isEmpty() && itemField(t, b.itemId, "spotify").isEmpty() ->
                send(JSONObject().put("type", "albumQueue").put("key", player.key).put("id", itemField(t, b.itemId, "rowId").ifEmpty { b.itemId })
                    .put("title", b.title).put("fallback", itemField(t, b.itemId, "spotify")))
              player != null && t.shelfAsset == "record" -> playRecord(player, b.title, itemSrc(t, b.itemId), itemField(t, b.itemId, "spotify"))
              player != null -> playTape(player, b.title, b.itemId, itemSrc(t, b.itemId))
              // An album dropped anywhere but a player opens on its shelf: its songs, each a mini record.
              // A song's mini record does something only on a record player; let go anywhere else, it goes back.
              b.mini -> Log.i(TAG, "${b.title} put back (not on a record player)")
              t.shelfAsset == "record" && b.album -> send(JSONObject().put("type", "openAlbum").put("key", t.key).put("id", itemField(t, b.itemId, "rowId").ifEmpty { b.itemId }))
              // A folder book pulled off the shelf goes back: a folder opens with a tap, not a pull (a pull meant to
              // move it opened it and left the shelf inside an empty folder — "the shelf crashed", 2026-10-27).
              // Let go while still pointing at itself: open it, however long it was held (user, 2026-10-27: "i
              // also cant drill into folders anymore" — a 0.35s tap was the only way in).
              // A folder pulled off the shelf and let go away from it opens (user, 2026-10-27).
              b.folder -> activateBook(t, b)
              else -> activateBook(t, b, near = p)
            }
          } else if (atRest && now - b.grabbedAt < BOOK_TAP_MS) activateBook(t, b)
          t.web?.evaluateJavascript("hold(${JSONObject.quote(b.itemId)}, false)", null)
          hideCard(b)
          b.placedScale = -1f
          // A book carried in from another folder of the shelf is done with now.
          if (carried) { t.carried.remove(b); b.entity.destroy(); continue }
        }
        if (rest == null) continue
        if (b.placedScale != s) {
          val k = if (b.mini) MINI_RECORD else 1f
          b.entity.setComponent(Scale(Vector3(b.slot.w * s * k, b.slot.h * s * k, BOOK_PROXY_DEPTH * s)))
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
    t.panelW = w; t.panelH = h
    panelThings[id] = t
    if (t.spotifyUrl != null) registerPanel(spotifyPanel(id, w, h, t))
    else if (t.browser) registerPanel(browserPanel(id, w, h, t))
    // The grid screen is the whole app: at the panels' 500 dp a metre a 1.6m screen is an 800px-wide window, so the
    // app laid out zoomed in and cut off. At a browser screen's density it is a desktop-width window, as in a browser.
    else registerPanel(webPanel(id, w, h, toolbar = false, dpPerMeter = if (t.decorEntry?.optString("model") == "gridscreen") BROWSER_DP_PER_M else 500f) { web ->
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
    t.gecko?.close(); t.gecko = null
    t.web?.let { w -> try { w.loadUrl("about:blank"); w.destroy() } catch (_: Throwable) {} }
    t.handle?.destroy()
    t.panel?.destroy()
    t.gear?.destroy()
    t.trash?.destroy()
    for (b in t.books + t.carried) { b.entity.destroy(); b.shown?.destroy() }
    t.books.clear(); t.carried.clear()
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
    if (model == "notepad") { send(JSONObject().put("type", "newNote").put("key", "")); return }
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
      "recordplayer", "vhsplayer" -> {
        // A record left playing is still on the player when the app opens again.
        entry.optJSONObject("playing")?.let { p ->
          val q = p.optJSONArray("queue")
          main.post {
            if (q != null) playQueue(t, p.optString("title"), (0 until q.length()).mapNotNull { q.optJSONObject(it)?.let { o -> o.optString("title") to o.optString("url") } }, p.optInt("at"))
            else playRecord(t, p.optString("title"), p.optString("src"), p.optString("spotify"))
          }
        }
      }
      // The whole grid, live: the app itself (its own panels and date — `local`), on a screen you place.
      "gridscreen" -> { t.panelUrl = "$origin/?local=1"; attachPanel(t, OfficeSizes.SCREEN_W, OfficeSizes.SCREEN_H, OfficeSizes.SCREEN_Y, 0.025f) }
      // One button: a new note in Notes, opened beside it to write in (and on the Documents shelf).
      // "New note" is not a piece of the room: adding it makes a page in Notes and opens it in a window (user: "adding
      // the screen should just open a window with a new note"). One placed before is taken out.
      "notepad" -> main.post { deleteThing(t.key) }
      // A plain web browser on a screen: an address bar, back / forward / reload; it remembers its last page.
      "browser", "claude", "remotedesktop" -> {
        t.browser = true
        // A Claude screen is a browser that starts at claude.ai (the native app cannot be put in a panel); a PC screen
        // starts at Chrome Remote Desktop — your Windows PC, controlled from here, through Google (no shared network).
        val home = when (entry.optString("model")) {
          "claude" -> "https://claude.ai/new"
          "remotedesktop" -> "https://remotedesktop.google.com/access"
          else -> "https://www.google.com"
        }
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
  /** A shelf item's bookmark address ("" for anything else) — what a book's `url` is built from. */
  private fun bookUrl(t: Thing, itemId: String): String {
    for (i in 0 until t.shelfItems.length()) {
      val item = t.shelfItems.optJSONObject(i) ?: continue
      if (item.optString("id") == itemId) return if (item.isNull("url")) "" else item.optString("url")
    }
    return ""
  }

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
  private fun stopPlayer(t: Thing, forget: Boolean = true) {
    t.gecko?.close(); t.gecko = null; t.spotifyUrl = null
    t.panel?.destroy(); t.panel = null; t.web = null; t.html = ""
    if (forget) savePlaying(t, null)
  }

  /** What a player is playing, kept on its decor entry so it is still playing when the app opens again. */
  private fun savePlaying(t: Thing, playing: JSONObject?) {
    if (!t.key.startsWith("decor:")) return
    val list = store.decor().map { e ->
      if (e.optString("key") != t.key) e
      else JSONObject(e.toString()).also { if (playing == null) it.remove("playing") else it.put("playing", playing) }
    }
    store.saveDecor(list)
    list.firstOrNull { it.optString("key") == t.key }?.let { t.decorEntry = it }
  }

  /** The page the record player opens: Spotify's mini player (its embed), loaded on its own page so your Spotify
   *  sign-in applies (inside a frame it played 30-second previews). Not the web app (user: "i want mini players"). */
  private fun spotifyWebPlayer(url: String?): String =
      // #autoplay: the built-in helper (assets/spotify-autoplay) presses play, so a dropped record or the next song
      // of an album starts by itself.
      (url ?: "https://open.spotify.com").substringBefore('#') + "#autoplay"

  /** The record player's Spotify window: the title and ⏹ over Spotify's own page, on Firefox's engine — the same
   *  profile as the browser screens, so once you are signed in to Spotify on any screen, songs play whole. (The
   *  plain web view it used before had no Spotify sign-in, and Spotify plays only a 30-second preview then.) */
  private fun spotifyPanel(id: Int, w: Float, h: Float, t: Thing): PanelRegistration =
      ComposeViewPanelRegistration(
          id,
          composeViewCreator = { _, ctx ->
            ComposeView(ctx).apply {
              setContent {
                Column(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0xEB1E140C))) {
                  Row(Modifier.fillMaxWidth().padding(6.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text(t.nowPlaying.value, color = androidx.compose.ui.graphics.Color(0xFFF4E9D8), fontSize = 18.sp, maxLines = 1,
                        modifier = Modifier.weight(1f).padding(horizontal = 6.dp))
                    // An album playing as its songs: back / on through them.
                    if (t.queue.size > 1) {
                      Button(onClick = { main.post { stepQueue(t, -1) } }) { Text("⏮", fontSize = 22.sp) }
                      Button(onClick = { main.post { stepQueue(t, 1) } }) { Text("⏭", fontSize = 22.sp) }
                    }
                    Button(onClick = { main.post { stopPlayer(t) } }) { Text("⏹", fontSize = 22.sp) }
                  }
                  AndroidView(
                      modifier = Modifier.fillMaxSize(),
                      factory = { c ->
                        GeckoBrowser(c, spotifyWebPlayer(t.spotifyUrl), onUrl = {}, onPressed = { v -> keyTarget = v },
                            // A song of an album that played to its end: the next one starts.
                            onMediaEnded = { main.post { if (t.queue.size > 1 && t.queueAt < t.queue.size - 1) stepQueue(t, 1) } })
                            .also { t.gecko = it }.view
                      },
                  )
                }
              }
            }
          },
          settingsCreator = {
            UIPanelSettings(
                rendering = PANEL_RENDER,
                shape = QuadShapeOptions(width = w, height = h),
                style = PanelStyleOptions(themeResourceId = R.style.PanelAppThemeTransparent),
                display = DpPerMeterDisplayOptions(dpPerMeter = SPOTIFY_DP_PER_M, resolutionScale = BROWSER_RES),
            )
          },
      )

  /** A record dropped on a record player plays there: its audio file, else Spotify's player for it. */
  /** An album with no Spotify album link plays as its songs, one at a time, with ⏮ ⏭ (the control panel sends them). */
  private fun playQueue(player: Thing, title: String, items: List<Pair<String, String>>, at: Int = 0) {
    if (items.isEmpty()) { showOnPanel(player, PanelHtml.playerCard(title, "", player.key, "No Spotify tracks for this album")); return }
    val i = at.coerceIn(0, items.size - 1)
    val g = player.gecko
    val reuse = player.spotifyUrl != null && g != null && player.panel != null
    if (!reuse) stopPlayer(player, forget = false)
    player.queue = items; player.queueAt = i; player.spotifyTitle = title
    player.spotifyUrl = items[i].second
    player.nowPlaying.value = "$title · ${i + 1}/${items.size} ${items[i].first}"
    if (reuse) g!!.load(spotifyWebPlayer(items[i].second)) else attachPanel(player, SPOTIFY_W, SPOTIFY_H, 0.24f + SPOTIFY_H / 2f, 0f)
    savePlaying(player, JSONObject().put("title", title).put("at", i)
        .put("queue", org.json.JSONArray(items.map { JSONObject().put("title", it.first).put("url", it.second) })))
    Log.i(TAG, "playing $title on ${player.key} as ${items.size} songs, song ${i + 1}: ${items[i].second}")
  }

  private fun stepQueue(t: Thing, d: Int) {
    if (t.queue.size < 2) return
    val i = (t.queueAt + d + t.queue.size) % t.queue.size
    t.queueAt = i; t.spotifyUrl = t.queue[i].second
    t.nowPlaying.value = "${t.spotifyTitle} · ${i + 1}/${t.queue.size} ${t.queue[i].first}"
    t.gecko?.load(spotifyWebPlayer(t.queue[i].second))
    t.decorEntry?.optJSONObject("playing")?.let { p -> savePlaying(t, JSONObject(p.toString()).put("at", i)) }
  }

  private fun playRecord(player: Thing, title: String, src: String, spotify: String = "") {
    player.queue = emptyList()
    player.nowPlaying.value = title
    if (src.isEmpty() && spotify.isNotEmpty()) {
      // Already showing Spotify: the new record plays in the SAME window. Making a new one left the old window's
      // player going (the header said the new song, the old one kept playing).
      val g = player.gecko
      if (player.spotifyUrl != null && g != null && player.panel != null) {
        player.spotifyUrl = spotify
        g.load(spotifyWebPlayer(spotify))
        savePlaying(player, JSONObject().put("title", title).put("spotify", spotify))
        Log.i(TAG, "playing $title on ${player.key} through Spotify (same window): ${spotifyWebPlayer(spotify)}")
        return
      }
      // Spotify's player needs more room than a now-playing card, so the player's window is made at that size.
      stopPlayer(player, forget = false)
      player.spotifyUrl = spotify; player.spotifyTitle = title
      attachPanel(player, SPOTIFY_W, SPOTIFY_H, 0.24f + SPOTIFY_H / 2f, 0f)
      savePlaying(player, JSONObject().put("title", title).put("spotify", spotify))
      Log.i(TAG, "playing $title on ${player.key} through Spotify: ${spotifyWebPlayer(spotify)}")
      return
    }
    if (src.isEmpty()) { showOnPanel(player, PanelHtml.playerCard(title, "", player.key, "No audio file or Spotify track for this record")); return }
    if (player.spotifyUrl != null) stopPlayer(player, forget = false)
    showOnPanel(player, PanelHtml.playerCard(title, src, player.key, "Now playing"))
    savePlaying(player, JSONObject().put("title", title).put("src", src))
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
  /** A screen (a browser / PC / Claude screen, the grid or note screen, a page screen) moves without "Move
   *  furniture" being on, like a reader window (user: "i need the screens to not be only when furniture is turned
   *  on"). Furniture still needs the switch, so reaching for a book never moves the shelf. */
  private fun isScreen(t: Thing): Boolean =
      t.key.startsWith("screen:") || t.decorEntry?.optString("model")?.let { modelFile(it) == "screen" || (it == "window" || it == "openwindow") } == true

  /** Per controller, the piece whose menu its ray holds (see showMenus). */
  private val stickyPointed = HashMap<Int, String?>()

  private fun showMenus() {
    val now = System.currentTimeMillis()
    // Each controller points at ONE piece: the nearest its ray meets. A ray across the room passes through several
    // pieces' boxes, and lighting them all up let a grab land on the wrong piece.
    val pointed = HashSet<String>()
    for ((ri, ray) in controllerRays().withIndex()) {
      val (o, d) = ray
      var best: Thing? = null; var bestD = Float.MAX_VALUE
      val hits = ArrayList<Thing>()
      for (t in things.values) {
        // Sitting in a piece puts your controllers inside its box, which reads as pointing at it — skip it then.
        if (t.key == CONTROL || t.ghosted) continue
        if (!moveMode && !isScreen(t)) continue
        val dist = hitDistance(t, o, d) ?: continue
        hits += t
        if (dist < bestD) { bestD = dist; best = t }
      }
      // A small piece standing on or in a bigger one (a record player on a desk) is inside the big one's pointing
      // box, which reaches up to the big one's bar — so the ray met the desk first and the player's bar never showed.
      // Of the pieces hit, one standing inside another's box wins over that box.
      best?.let { outer -> hits.filter { it !== outer && standsInside(it, outer) }.minByOrNull { footprint(it) }?.let { best = it } }
      // Once a piece's menu is up, it keeps it while this ray still touches the piece: a small move onto a
      // neighbour no longer switches the selection (user, 2026-10-27: "one little move and its pointing at a diff
      // piece of furniture").
      stickyPointed[ri]?.let { k -> hits.firstOrNull { it.key == k }?.let { best = it } }
      stickyPointed[ri] = best?.key
      best?.let { it.lastHover = now; pointed += it.key }
    }
    // Pointing at another piece hides the last one at once; the linger is only for pointing at nothing.
    if (pointed.isNotEmpty()) for (t in things.values) if (t.key !in pointed) t.lastHover = 0L
    for (t in things.values) {
      if (t.key == CONTROL) continue
      val want = (moveMode || isScreen(t)) && (!t.ghosted && now - t.lastHover < MENU_LINGER_MS || t.handle?.held == true || t.key in pieceWindows)
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
      placeMenuButtons()
      animateFlames()
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
        val trig = down and (ButtonBits.ButtonTriggerR or ButtonBits.ButtonTriggerL) != 0
        // A fresh press on this controller: a ⚙ or 🗑 its ray meets takes it.
        if (trig && c.id !in triggersHeld) c.tryGetComponent<Transform>()?.transform?.let { pose ->
          pressMenuButton(PoseMath.tOf(pose), PoseMath.rotate(PoseMath.qOf(pose), floatArrayOf(0f, 0f, 1f)))
        }
        if (trig) triggersHeld += c.id else triggersHeld -= c.id
        if (trig) {
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
      // A book, record or tape in your hand: the same stick pushes it away / pulls it in.
      if (reachDir != 0f && held == null && heldReader == null) heldBook?.let { it.reach += reachDir * REACH_M_PER_S * dt }
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
   * of the record players is stuck … wont let me drag or delete it"). The app makes models in a few known places —
   * a piece's frame, a shelf's books, a grab bar, a reader's handle, the VR sky — so any other office model is a
   * leftover: it is logged and removed.
   */
  private fun sweepStrayModels() {
    val owned = HashSet<Long>()
    for (t in things.values) {
      owned += t.frame.id
      t.handle?.entity?.id?.let { owned += it }
      t.gear?.id?.let { owned += it }
      t.trash?.id?.let { owned += it }
      for (b in t.books + t.carried) { owned += b.entity.id; b.shown?.id?.let { owned += it } }
    }
    for (h in readerHandles.values) owned += h.entity.id
    // The VR apartment's sky is the room's, not a piece's (RoomAnchor).
    if (::room.isInitialized) room.skyEntityId?.let { owned += it }
    for (f in flames) owned += f.id
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
                rendering = PANEL_RENDER,
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

  /**
   * Where window `panelId` is in the room and its half size: a reader window, or a piece's panel (the grid screen is
   * one). A drag that started on the grid screen read as "outside its window" every frame, because only reader windows
   * were looked up — so the carried preview showed for the whole drag (user, 2026-10-26).
   */
  private fun windowBox(panelId: Int): Triple<Pose, Float, Float>? {
    readers[panelId]?.let { e ->
      val pose = e.tryGetComponent<Transform>()?.transform ?: return null
      val s = e.tryGetComponent<com.meta.spatial.toolkit.Scale>()?.scale?.x ?: 1f
      return Triple(pose, READER_W * s / 2f, READER_H * s / 2f)
    }
    val t = panelThings[panelId] ?: return null
    if (t.panel == null || t.panelW <= 0f) return null
    val frame = t.frame.tryGetComponent<Transform>()?.transform ?: return null
    val s = t.scale
    val pose = PoseMath.toWorld(frame, floatArrayOf(0f, t.panelAt[0] * s, t.panelAt[1] * s), PoseMath.yaw(180f))
    return Triple(pose, t.panelW * s / 2f, t.panelH * s / 2f)
  }

  /** The page of window `panelId`: a reader window's, or a piece's panel's. */
  private fun webOf(panelId: Int): WebView? = readerWebs[panelId] ?: panelThings[panelId]?.web

  private fun remote(panel: Int, call: String) = readerWebs[panel]?.evaluateJavascript("window.__moduliRemoteDrag && window.__moduliRemoteDrag.$call", null)

  /** Each frame of a drag: which window the controller points at; out of its own window the drag goes with it. */
  private fun updateGhost() {
    val d = pendingDrag
    val g = ghost ?: return
    if (d == null || d.released) { g.setComponent(Visible(false)); return }
    val ray = dragRay ?: controllerRays().firstOrNull() ?: run { g.setComponent(Visible(false)); return }
    val (o, dir) = ray
    val src = windowBox(d.fromPanel)
    val srcPose = src?.first
    val inside = src != null && PoseMath.rayBox(o, dir, src.first,
        floatArrayOf(-src.second, -src.third, -0.03f), floatArrayOf(src.second, src.third, 0.03f)) != null
    // The page keeps the last point it saw inside, so on release it would drop there: tell it the pointer has left.
    if (d.outside != !inside) {
      d.outside = !inside
      Log.i(TAG, "drag ${d.occId}: pointer ${if (inside) "back in" else "left"} window ${d.fromPanel}")
      webOf(d.fromPanel)?.evaluateJavascript("window.__moduliOutside=${!inside}", null)
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
    webOf(from)?.evaluateJavascript("window.__moduliOutside=false", null)
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
          webOf(drag.fromPanel)?.evaluateJavascript("window.__moduliMovedOut && window.__moduliMovedOut(${JSONObject.quote(drag.occId)})", null)
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
    // Under THIS window: a bookmark's browser window is taller (its address bar), and a bar placed for a page window
    // sat behind its bottom edge — the window could not be moved.
    val h = if (occId.startsWith("url:")) READER_H + 0.16f else READER_H
    readerHandles[id] = GrabHandle(e, -(h / 2f + HANDLE_GAP / 2f), facesHead = true, widthScale = 1.5f).also { it.follow() }
    readerHandleDy[id] = -(h / 2f + HANDLE_GAP / 2f)
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
      // Its page stops too: a closed window kept playing a video's sound (the panel went, its browser did not).
      readerGecko.remove(id)?.close()
      readerWebs.remove(id)?.let { w -> try { w.loadUrl("about:blank"); w.destroy() } catch (_: Throwable) {} }
      readerHandles.remove(id)?.destroy(); readers.remove(id)?.destroy()
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
    // A model, not a panel: on a panel the cursor hid and the click never arrived (user, 2026-10-27). Pressed through
    // pressMenuButton. Placed beside the bar every frame (placeMenuButtons), not parented to it.
    return Entity.create(listOf(
        Mesh(Uri.parse("apk:///office/menu_gear.glb"), hittable = MeshCollision.LineTest),
        Transform(PoseMath.sane(PoseMath.toWorld(handlePose(handle), GEAR_LOCAL, PoseMath.yaw(180f)), "OfficeActivity:1404")),
        // Exactly like the grab bar (GrabHandle): grabbable, which is what keeps the cursor showing on it. It is put
        // back beside the bar every frame (placeMenuButtons), so a grab cannot carry it off.
        Grabbable(true, GrabbableType.PIVOT_Y),
    ))
  }

  /**
   * A 🗑 just right of the ⚙. One tap arms it ("Sure?"), a second within 3s deletes the piece — a plain web confirm
   * never showed inside a headset panel, which is why deleting from the settings window did nothing.
   */
  private fun trashButton(t: Thing): Entity? {
    val handle = t.handle ?: return null
    return Entity.create(listOf(
        Mesh(Uri.parse("apk:///office/menu_trash.glb"), hittable = MeshCollision.LineTest),
        Transform(PoseMath.sane(PoseMath.toWorld(handlePose(handle), TRASH_LOCAL, PoseMath.yaw(180f)), "OfficeActivity:1440")),
        // Exactly like the grab bar (GrabHandle): grabbable, which is what keeps the cursor showing on it. It is put
        // back beside the bar every frame (placeMenuButtons), so a grab cannot carry it off.
        Grabbable(true, GrabbableType.PIVOT_Y),
    ))
  }

  private val GEAR_LOCAL get() = floatArrayOf(0.28f, 0f, 0f)
  private val TRASH_LOCAL get() = floatArrayOf(0.28f + GEAR_M / 2f + 0.015f + TRASH_W / 2f, 0f, 0f)

  private fun handlePose(h: GrabHandle): Pose = h.entity.tryGetComponent<Transform>()?.transform ?: Pose()

  private var lastMenuPress = 0L
  /** Controllers whose trigger is down, so a press is acted on once, when it starts. */
  private val triggersHeld = HashSet<Long>()

  private fun pressGear(t: Thing) {
    val now = System.currentTimeMillis(); if (now - lastMenuPress < 400) return; lastMenuPress = now
    Log.i(TAG, "gear pressed ${t.key}")
    togglePiece(t.key)
  }

  private fun setTrashArmed(t: Thing, armed: Boolean) {
    t.trashArmed = armed
    t.trash?.setComponent(Mesh(Uri.parse("apk:///office/menu_${if (armed) "sure" else "trash"}.glb"), hittable = MeshCollision.LineTest))
  }

  /** First press arms the 🗑 ("Sure?"), a second within 3s deletes the piece. */
  private fun pressTrash(t: Thing) {
    val now = System.currentTimeMillis(); if (now - lastMenuPress < 400) return; lastMenuPress = now
    Log.i(TAG, "trash pressed ${t.key} armed=${t.trashArmed}")
    if (t.trashArmed && now - t.trashArmedAt < 3000) { removePiece(t.key); return }
    setTrashArmed(t, true); t.trashArmedAt = now
  }

  /**
   * A trigger press on a shown ⚙ or 🗑, found from the controller's own ray. The panels' own clicks never arrive in
   * the headset (the cursor reaches them and hides, the press goes nowhere — user, 2026-10-27), so the app does it.
   * Returns true when a button took the press.
   */
  private fun pressMenuButton(o: FloatArray, d: FloatArray): Boolean {
    var best: Pair<Thing, Boolean>? = null; var bestD = Float.MAX_VALUE
    val half = floatArrayOf(GEAR_M / 2f, GEAR_M / 2f, 0.03f)
    for (t in things.values) {
      if (!t.menuShown) continue
      for ((e, isTrash) in listOf(t.gear to false, t.trash to true)) {
        val pose = e?.tryGetComponent<Transform>()?.transform ?: continue
        val hx = if (isTrash) TRASH_W / 2f else half[0]
        val hit = PoseMath.rayBox(o, d, pose, floatArrayOf(-hx, -half[1], -half[2]), floatArrayOf(hx, half[1], half[2])) ?: continue
        if (hit < bestD) { bestD = hit; best = t to isTrash }
      }
    }
    val (t, isTrash) = best ?: return false
    if (isTrash) pressTrash(t) else pressGear(t)
    return true
  }

  /** Puts each shown ⚙ and 🗑 beside its bar (see gearButton for why they are not parented to it). */
  // ── The fireplace's moving fire (user, 2026-10-27: "id like a fireplace that moves") ────────────────────────────
  /** Five flames across the firebox: model (flame-0..2, quest/tools/flames.py), x, depth, size, phase. */
  private val FLAME_LAYOUT = listOf(
      floatArrayOf(0f, 0f, -0.1f, 1f, 0f), floatArrayOf(1f, -0.12f, -0.11f, 0.95f, 1.7f), floatArrayOf(1f, 0.12f, -0.11f, 0.9f, 3.1f),
      floatArrayOf(2f, -0.21f, -0.12f, 0.8f, 4.4f), floatArrayOf(2f, 0.2f, -0.12f, 0.85f, 5.6f),
  )
  /** The firebox floor and where the flames stand (fireplace model frame, quest/tools/realFurniture.mjs). */
  private val FLAME_BASE_Y = 0.17f
  private val flames = ArrayList<Entity>()
  private var flameParent: Entity? = null

  /** Keeps the flames in the fireplace and makes each flicker and sway, every frame. */
  private fun animateFlames() {
    val fp = things["fireplace"]?.frame
    if (fp !== flameParent) {
      for (f in flames) f.destroy(); flames.clear(); flameParent = fp
      if (fp != null) for (l in FLAME_LAYOUT) flames += Entity.create(listOf(
          Mesh(Uri.parse("apk:///office/flame-${l[0].toInt()}.glb"), hittable = MeshCollision.NoCollision),
          Transform(Pose(Vector3(l[1], FLAME_BASE_Y, l[2]))),
          Scale(Vector3(l[3], l[3], 1f)),
          TransformParent(fp),
      ))
    }
    if (flames.isEmpty()) return
    val t = System.nanoTime() / 1e9f
    for ((i, f) in flames.withIndex()) {
      val l = FLAME_LAYOUT[i]; val p = l[4]
      val sy = 1f + 0.22f * kotlin.math.sin(t * 7.3f + p) + 0.1f * kotlin.math.sin(t * 13.1f + p * 2f) + 0.05f * kotlin.math.sin(t * 23f + p * 3f)
      val sx = 1f + 0.08f * kotlin.math.sin(t * 5.1f + p * 1.3f)
      val sway = 0.012f * kotlin.math.sin(t * 3.7f + p)
      f.setComponent(Scale(Vector3(l[3] * sx, l[3] * sy, 1f)))
      f.setComponent(Transform(Pose(Vector3(l[1] + sway, FLAME_BASE_Y, l[2]))))
    }
  }

  private fun placeMenuButtons() {
    val now = System.currentTimeMillis()
    for (t in things.values) {
      if (t.trashArmed && now - t.trashArmedAt > 3000) setTrashArmed(t, false)
      if (!t.menuShown) continue
      val h = t.handle ?: continue
      val hp = handlePose(h)
      val sx = h.widthScale
      t.gear?.setComponent(Transform(PoseMath.sane(PoseMath.toWorld(hp, GEAR_LOCAL.also { it[0] *= sx }, PoseMath.yaw(180f)), "OfficeActivity:gear")))
      t.trash?.setComponent(Transform(PoseMath.sane(PoseMath.toWorld(hp, TRASH_LOCAL.also { it[0] *= sx }, PoseMath.yaw(180f)), "OfficeActivity:trash")))
    }
  }

  /**
   * Take a piece out of the room. Decor lives on this headset, so it goes here; a shelf or screen is part of the
   * grid's office, so the control panel removes it from there too (else the next state would bring it back).
   */
  private fun removePiece(key: String) {
    Log.i(TAG, "remove piece $key")
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
    // VR is a high-rise apartment at sunset: a low orange sun from where the sunset is in the sky photo (about 30°
    // right of straight ahead, just above the horizon — quest/tools/skyDome.py), and a cool blue-grey fill from the
    // sky. Mixed reality keeps neutral light to match your real room.
    if (vr) scene.setLightingEnvironment(
        ambientColor = Vector3(0.38f, 0.38f, 0.46f),
        sunColor = Vector3(2.6f, 1.5f, 0.9f),
        sunDirection = -Vector3(0.48f, 0.25f, -0.87f),
        environmentIntensity = 0.35f,
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
