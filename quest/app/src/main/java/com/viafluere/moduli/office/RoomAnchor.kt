package com.viafluere.moduli.office

import android.content.Context
import android.net.Uri
import android.util.Log
import com.meta.spatial.core.Color4
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.SystemManager
import com.meta.spatial.mruk.AnchorProceduralMesh
import com.meta.spatial.mruk.AnchorProceduralMeshConfig
import com.meta.spatial.mruk.MRUKFeature
import com.meta.spatial.mruk.MRUKLabel
import com.meta.spatial.mruk.MRUKRoom
import com.meta.spatial.mruk.MRUKSceneEventListener
import com.meta.spatial.mruk.SceneModel
import com.meta.spatial.runtime.AlphaMode
import com.meta.spatial.toolkit.Material
import com.meta.spatial.toolkit.Mesh
import com.meta.spatial.toolkit.MeshCollision
import com.meta.spatial.toolkit.Transform

/**
 * The scanned room (the headset's Space Setup), through Meta's MR Utility Kit — used ONLY to build the VR room from
 * your room's own walls, floor and ceiling.
 *
 * VR mode is a high-rise apartment at sunset (user, 2026-10-27): every scanned wall becomes floor-to-ceiling windows
 * at the room's real size, a city skyline at sunset outside (assets/office/skydome.glb, quest/tools/skyDome.py),
 * light oak floor and white ceiling (quest/tools/apartmentTextures.py). Mixed reality is unchanged.
 *
 * It used to be the frame every placement was saved in, but the scan was found on one start and missing on the
 * next, and each miss scattered the room. Placement is in the boundary-tied STAGE space now (OfficeActivity).
 */
class RoomAnchor(context: Context, systemManager: SystemManager) : MRUKSceneEventListener {
  val feature = MRUKFeature(context, systemManager)
  private var walls: AnchorProceduralMesh? = null
  private var sky: Entity? = null
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
   * VR mode: draw the room's walls (as windows), floor and ceiling, and the sunset sky outside (passthrough is off, so
   * this is the room you see). With no room scan, ask the headset for one — once — and draw the room when it is done.
   */
  fun showWalls(show: Boolean) {
    wantWalls = show
    if (!show) { walls?.destroy(); walls = null; sky?.destroy(); sky = null; return }
    if (walls != null) return
    if (feature.rooms.isEmpty()) {
      if (captureAsked) return
      captureAsked = true
      Log.i(TAG, "VR room: no room scan, asking the headset for one")
      feature.requestSceneCapture().whenComplete { _, _ -> load { if (wantWalls) showWalls(true) } }
      return
    }
    fun surface(tex: Int, u: Float, v: Float, masked: Boolean = false) = Material().apply {
      baseTextureAndroidResourceId = tex
      repeatU = u; repeatV = v
      baseColor = Color4(1f, 1f, 1f, 1f)
      roughness = 0.8f
      // The window wall: frames and sill solid, the panes (alpha 0 in the texture) open onto the sky.
      if (masked) alphaMode = AlphaMode.MASKED.mode
    }
    walls = AnchorProceduralMesh(
        feature,
        mapOf(
            MRUKLabel.FLOOR to AnchorProceduralMeshConfig(surface(R.drawable.apartment_floor, 3f, 3f), false),
            // repeatV 1: one texture spans the wall's height, so the sill sits at about waist height on every wall;
            // repeatU 3: three window bays across each wall.
            MRUKLabel.WALL_FACE to AnchorProceduralMeshConfig(surface(R.drawable.apartment_window, 3f, 1f, masked = true), false),
            MRUKLabel.CEILING to AnchorProceduralMeshConfig(surface(R.drawable.apartment_ceiling, 2f, 2f), false),
        ),
    )
    // The sky: an unlit inside-out sphere, 120m out, centred on the room origin.
    if (sky == null) {
      sky = Entity.create(listOf(
          Mesh(Uri.parse("apk:///office/skydome.glb"), hittable = MeshCollision.NoCollision),
          Transform(Pose()),
      ))
    }
  }

  override fun onRoomAdded(room: MRUKRoom) { if (wantWalls) showWalls(true) }

  companion object { private const val TAG = "ModuliOffice" }
}
