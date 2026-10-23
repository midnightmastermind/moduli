package com.viafluere.moduli.office

import android.content.Context
import android.util.Log
import com.meta.spatial.core.Color4
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.SystemManager
import com.meta.spatial.mruk.AnchorProceduralMesh
import com.meta.spatial.mruk.AnchorProceduralMeshConfig
import com.meta.spatial.mruk.MRUKFeature
import com.meta.spatial.mruk.MRUKLabel
import com.meta.spatial.mruk.MRUKLoadDeviceResult
import com.meta.spatial.mruk.MRUKRoom
import com.meta.spatial.mruk.MRUKSceneEventListener
import com.meta.spatial.mruk.SceneModel
import com.meta.spatial.toolkit.Material
import com.meta.spatial.toolkit.Transform

/**
 * The scanned room (the headset's Space Setup), through Meta's MR Utility Kit.
 *
 * Its FLOOR anchor is the frame every placement is saved in (PlacementStore "room" space): the anchor stays put in
 * the real room however the headset's tracking origin moves, which is what the browser office could not do.
 * In VR mode the room's own walls, floor and ceiling are drawn, so the VR room IS your room.
 */
class RoomAnchor(context: Context, systemManager: SystemManager) : MRUKSceneEventListener {
  val feature = MRUKFeature(context, systemManager)
  var onChange: (() -> Unit)? = null
  /** True once a room has been loaded (or loading failed — then everything is kept in the headset's frame). */
  var resolved = false
    private set
  private var walls: AnchorProceduralMesh? = null
  private var wantWalls = false

  fun load() {
    feature.addSceneEventListener(this)
    // V2_FALLBACK_V1: newer Quest software saves Space Setup in the V2 scene model; the default (V1 only) found
    // "0 rooms" on a headset whose room had just been scanned. If there is truly no scan, the headset asks for one.
    feature.loadSceneFromDevice(
        requestSceneCaptureIfNoDataFound = true,
        removeMissingRooms = true,
        sceneModel = SceneModel.V2_FALLBACK_V1,
    ).whenComplete { result, err ->
      Log.i(TAG, "room load: $result ${err?.message ?: ""} · rooms ${feature.rooms.size} · floor ${originPose() != null}")
      resolved = true
      if (result != MRUKLoadDeviceResult.SUCCESS) onChange?.invoke()
    }
  }

  private fun floor(): Entity? {
    val room = feature.getCurrentRoom() ?: feature.rooms.firstOrNull() ?: return null
    return room.floors.firstOrNull() ?: room.entity
  }

  /** The floor anchor's pose in the world, or null while there is no room. */
  fun originPose(): Pose? = floor()?.tryGetComponent<Transform>()?.transform?.takeIf { it != Pose() }

  /** VR mode: draw the room's walls, floor and ceiling (passthrough is off, so this is the room you see). */
  fun showWalls(show: Boolean) {
    wantWalls = show
    if (!show) { walls?.destroy(); walls = null; return }
    if (walls != null || feature.rooms.isEmpty()) return
    fun mat(r: Float, g: Float, b: Float) = Material().apply { baseColor = Color4(r, g, b, 1f) }
    walls = AnchorProceduralMesh(
        feature,
        mapOf(
            MRUKLabel.FLOOR to AnchorProceduralMeshConfig(mat(0.34f, 0.22f, 0.14f), false),
            MRUKLabel.WALL_FACE to AnchorProceduralMeshConfig(mat(0.78f, 0.72f, 0.62f), false),
            MRUKLabel.CEILING to AnchorProceduralMeshConfig(mat(0.9f, 0.88f, 0.84f), false),
        ),
    )
  }

  override fun onRoomAdded(room: MRUKRoom) { if (wantWalls) showWalls(true); onChange?.invoke() }
  override fun onRoomUpdated(room: MRUKRoom) { onChange?.invoke() }

  companion object { private const val TAG = "ModuliOffice" }
}
