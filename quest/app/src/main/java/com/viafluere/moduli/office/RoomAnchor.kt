package com.viafluere.moduli.office

import android.content.Context
import android.util.Log
import com.meta.spatial.core.Color4
import com.meta.spatial.core.SystemManager
import com.meta.spatial.mruk.AnchorProceduralMesh
import com.meta.spatial.mruk.AnchorProceduralMeshConfig
import com.meta.spatial.mruk.MRUKFeature
import com.meta.spatial.mruk.MRUKLabel
import com.meta.spatial.mruk.MRUKRoom
import com.meta.spatial.mruk.MRUKSceneEventListener
import com.meta.spatial.mruk.SceneModel
import com.meta.spatial.toolkit.Material

/**
 * The scanned room (the headset's Space Setup), through Meta's MR Utility Kit — used ONLY to build the VR cabin from
 * your room's own walls, floor and ceiling (textures from quest/tools/cabinTextures.py).
 *
 * It used to be the frame every placement was saved in, but the scan was found on one start and missing on the
 * next, and each miss scattered the room. Placement is in the boundary-tied STAGE space now (OfficeActivity).
 */
class RoomAnchor(context: Context, systemManager: SystemManager) : MRUKSceneEventListener {
  val feature = MRUKFeature(context, systemManager)
  private var walls: AnchorProceduralMesh? = null
  private var wantWalls = false
  private var listening = false
  private var captureAsked = false

  fun load(then: (() -> Unit)? = null) {
    if (!listening) { feature.addSceneEventListener(this); listening = true }
    // V2_FALLBACK_V1: newer Quest software may save Space Setup in the V2 scene model.
    feature.loadSceneFromDevice(
        requestSceneCaptureIfNoDataFound = false,
        removeMissingRooms = true,
        sceneModel = SceneModel.V2_FALLBACK_V1,
    ).whenComplete { result, err ->
      Log.i(TAG, "room load: $result ${err?.message ?: ""} · rooms ${feature.rooms.size}")
      then?.invoke()
    }
  }

  /**
   * VR mode: draw the room's walls, floor and ceiling as a log cabin (passthrough is off, so this is the room you
   * see). With no room scan, ask the headset for one — once — and draw the cabin when it is done.
   */
  fun showWalls(show: Boolean) {
    wantWalls = show
    if (!show) { walls?.destroy(); walls = null; return }
    if (walls != null) return
    if (feature.rooms.isEmpty()) {
      if (captureAsked) return
      captureAsked = true
      Log.i(TAG, "VR cabin: no room scan, asking the headset for one")
      feature.requestSceneCapture().whenComplete { _, _ -> load { if (wantWalls) showWalls(true) } }
      return
    }
    // Each texture tiles; repeat counts are per surface, so a wall shows ~3 log courses across and 2 tiles up.
    fun wood(tex: Int, u: Float, v: Float) = Material().apply {
      baseTextureAndroidResourceId = tex
      repeatU = u; repeatV = v
      baseColor = Color4(1f, 1f, 1f, 1f)
      roughness = 0.9f
    }
    walls = AnchorProceduralMesh(
        feature,
        mapOf(
            MRUKLabel.FLOOR to AnchorProceduralMeshConfig(wood(R.drawable.cabin_floor, 3f, 3f), false),
            MRUKLabel.WALL_FACE to AnchorProceduralMeshConfig(wood(R.drawable.cabin_logs, 3f, 2f), false),
            MRUKLabel.CEILING to AnchorProceduralMeshConfig(wood(R.drawable.cabin_ceiling, 3f, 3f), false),
        ),
    )
  }

  override fun onRoomAdded(room: MRUKRoom) { if (wantWalls) showWalls(true) }

  companion object { private const val TAG = "ModuliOffice" }
}
