package com.viafluere.moduli.office

import android.content.Context
import android.util.Log
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView

/**
 * A browser screen drawn by Firefox's engine (GeckoView) instead of the system WebView.
 *
 * Why (user, 2026-10-25): Google refused to sign in on the office's browser screens ("this browser or app may not be
 * secure"), which Chrome Remote Desktop needs. The headset's WebView adds `X-Requested-With: <this app>` to every
 * request and cannot be told not to — `WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST` reads false on it, and the
 * header is added below where DevTools can rewrite requests. GeckoView sends no such header; to a site it is Firefox.
 *
 * Moduli's own windows (control panel, shelves, readers) stay on WebView: they talk to the app through
 * `addJavascriptInterface`, which GeckoView does not have.
 */
object GeckoEngine {
  private var runtime: GeckoRuntime? = null

  /** One runtime per process (GeckoView allows no second one). Cookies and sign-ins persist in its profile. */
  fun runtime(ctx: Context): GeckoRuntime =
      runtime ?: GeckoRuntime.create(
          ctx.applicationContext,
          GeckoRuntimeSettings.Builder()
              .configFilePath(memoryConfig(ctx))
              .javaScriptEnabled(true)
              .remoteDebuggingEnabled(BuildConfig.DEBUG)
              .consoleOutput(BuildConfig.DEBUG)
              .build(),
      ).also { runtime = it }

  /**
   * Firefox gives every site its own process (Fission) and keeps spares warm: on the headset that was five page
   * processes, ~700 MB, beside the app's own ~650 MB — and the room blacked out for seconds while the system freed
   * memory. One shared page process, no spares. And no separate GPU process: low on memory, the system killed it
   * first (it counts as a background process) and every browser screen went black and stayed black. (GeckoView reads this file in a debuggable build, which this is.)
   */
  private fun memoryConfig(ctx: Context): String {
    val f = java.io.File(ctx.filesDir, "geckoview-config.yaml")
    f.writeText(
        """
        |prefs:
        |  fission.autostart: false
        |  dom.ipc.processCount: 1
        |  dom.ipc.processCount.webIsolated: 1
        |  dom.ipc.processPrelaunch.enabled: false
        |  browser.sessionhistory.max_total_viewers: 0
        |  layers.gpu-process.enabled: false
        |""".trimMargin())
    return f.absolutePath
  }
}

/** One browser screen's session: its view, and what the panel's address bar and buttons read. */
class GeckoBrowser(
    ctx: Context,
    startUrl: String,
    private val onUrl: (String) -> Unit,
    private val onTitle: (String) -> Unit = {},
    /** The screen was pressed: a paired keyboard should type into it. */
    private val onPressed: (GeckoView) -> Unit = {},
) {
  var canGoBack = false; private set
  var canGoForward = false; private set
  var url: String = startUrl; private set
  var title: String = ""; private set

  val session: GeckoSession = GeckoSession(
      GeckoSessionSettings.Builder()
          // Desktop: Chrome Remote Desktop and Spotify's web player send a mobile browser to their apps.
          .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
          .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
          .build(),
  )

  val view: GeckoView = GeckoView(ctx).apply {
    // A TextureView draws into the panel's own surface like any other view; the default SurfaceView is a separate
    // window layer a panel texture may never see.
    setViewBackend(GeckoView.BACKEND_TEXTURE_VIEW)
    layoutParams = android.view.ViewGroup.LayoutParams(
        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
    )
    isFocusable = true; isFocusableInTouchMode = true
    // A press asks for focus, so the headset keyboard types into the page (as the WebView windows do).
    setOnTouchListener { v, ev ->
      if (ev.actionMasked == android.view.MotionEvent.ACTION_DOWN) { onPressed(v as GeckoView); if (!v.hasFocus()) v.requestFocus() }
      false
    }
  }

  private lateinit var mainNav: GeckoSession.NavigationDelegate
  /** The popup showing in this screen (a sign-in window), or null. */
  private var popup: GeckoSession? = null

  private fun openPopup(): GeckoSession {
    val p = GeckoSession(
        GeckoSessionSettings.Builder()
            .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
            .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
            .build(),
    )
    p.permissionDelegate = session.permissionDelegate
    p.navigationDelegate = object : GeckoSession.NavigationDelegate {
      override fun onLocationChange(s: GeckoSession, u: String?, perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>, hasUserGesture: Boolean) {
        if (u != null) onUrl(u)
      }
      // A popup's own popups take its place (rare; one level is enough for sign-in).
      override fun onNewSession(s: GeckoSession, uri: String): GeckoResult<GeckoSession>? { s.loadUri(uri); return null }
    }
    p.contentDelegate = object : GeckoSession.ContentDelegate {
      override fun onCloseRequest(s: GeckoSession) { view.post { closePopup() } }
      override fun onCrash(s: GeckoSession) { view.post { closePopup() } }
      override fun onKill(s: GeckoSession) { view.post { closePopup() } }
    }
    popup?.let { closePopup() }
    popup = p
    // GeckoView opens the returned session itself (keeping window.opener); this screen shows it once it is open.
    // Wait for that: setSession on a session not yet open would open it here, without its opener.
    fun showWhenOpen(tries: Int) {
      if (popup !== p) return
      if (p.isOpen) { view.releaseSession(); view.setSession(p); return }
      if (tries > 0) view.postDelayed({ showWhenOpen(tries - 1) }, 50)
    }
    view.post { showWhenOpen(60) }
    Log.i("ModuliOffice", "gecko: popup opened")
    return p
  }

  private fun closePopup() {
    val p = popup ?: return
    popup = null
    try { view.releaseSession(); view.setSession(session) } catch (_: Throwable) {}
    try { p.close() } catch (_: Throwable) {}
    onUrl(url)
    Log.i("ModuliOffice", "gecko: popup closed")
  }

  init {
    mainNav = object : GeckoSession.NavigationDelegate {
      override fun onLocationChange(s: GeckoSession, u: String?, perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>, hasUserGesture: Boolean) {
        if (u != null) { url = u; onUrl(u) }
      }
      override fun onCanGoBack(s: GeckoSession, v: Boolean) { canGoBack = v }
      override fun onCanGoForward(s: GeckoSession, v: Boolean) { canGoForward = v }
      // A new window (target=_blank, window.open) is a real popup: it takes this screen until it closes, then the
      // page that opened it is back. Loading it in place lost the opener — "Continue with Google" on claude.ai
      // stopped on accounts.google.com/gsi/transform, blank, with no page left to hand the sign-in back to.
      override fun onNewSession(s: GeckoSession, uri: String): GeckoResult<GeckoSession>? =
          GeckoResult.fromValue(openPopup())
    }
    session.navigationDelegate = mainNav
    // Spotify (and every streaming site) plays through DRM — Widevine, which GeckoView refuses unless the app says
    // yes ("protected content not enabled"). A screen is the user's own browser, so DRM and autoplay are allowed.
    session.permissionDelegate = object : GeckoSession.PermissionDelegate {
      override fun onContentPermissionRequest(
          s: GeckoSession,
          perm: GeckoSession.PermissionDelegate.ContentPermission,
      ): GeckoResult<Int>? {
        val allow = when (perm.permission) {
          GeckoSession.PermissionDelegate.PERMISSION_MEDIA_KEY_SYSTEM_ACCESS,
          GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_AUDIBLE,
          GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_INAUDIBLE,
          GeckoSession.PermissionDelegate.PERMISSION_STORAGE_ACCESS -> true
          else -> false
        }
        Log.i("ModuliOffice", "gecko: permission ${perm.permission} for ${perm.uri} -> ${if (allow) "allow" else "deny"}")
        return GeckoResult.fromValue(
            if (allow) GeckoSession.PermissionDelegate.ContentPermission.VALUE_ALLOW
            else GeckoSession.PermissionDelegate.ContentPermission.VALUE_DENY)
      }
    }
    session.contentDelegate = object : GeckoSession.ContentDelegate {
      override fun onTitleChange(s: GeckoSession, t: String?) { title = t ?: ""; onTitle(title) }
      override fun onCrash(s: GeckoSession) { Log.w("ModuliOffice", "gecko: content crashed, reopening"); reopen() }
      override fun onKill(s: GeckoSession) { Log.w("ModuliOffice", "gecko: content killed, reopening"); reopen() }
    }
    session.open(GeckoEngine.runtime(ctx))
    view.setSession(session)
    session.loadUri(startUrl)
  }

  private fun reopen() {
    if (!session.isOpen) session.open(GeckoEngine.runtime(view.context))
    session.loadUri(url)
  }

  fun load(u: String) { closePopup(); session.loadUri(u) }
  /** Back from a popup closes it (back to the page that opened it). */
  fun back() { if (popup != null) closePopup() else session.goBack() }
  fun forward() = session.goForward()
  fun reload() = (popup ?: session).reload()
  fun close() { try { popup?.close(); view.releaseSession(); session.close() } catch (_: Throwable) {} }
}
