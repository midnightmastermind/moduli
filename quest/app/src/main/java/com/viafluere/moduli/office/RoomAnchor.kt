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
 * In VR mode the room's own walls, floor and ceiling are drawn as a log cabin (user, 2026-10-23: "give it a cabin
 * feel") — textures from quest/tools/cabinTextures.py — so the VR room IS your room, in wood.
 */
class RoomAnchor(context: Context, systemManager: SystemManager) : MRUKSceneEventListener {
  val feature = MRUKFeature(context, systemManager)
  var onChange: (() -> Unit)? = null
  /** True once a room has been loaded (or loading failed — then everything is kept in the headset's frame). */
  var resolved = false
    private set
  private var walls: AnchorProceduralMesh? = null
  private var wantWalls = false

  private var listening = false

  fun load() {
    if (!listening) { feature.addSceneEventListener(this); listening = true }
    // V2_FALLBACK_V1: newer Quest software saves Space Setup in the V2 scene model; the default (V1 only) found
    // "0 rooms" on a headset whose room had just been scanned. If there is truly no scan, the headset asks for one.
    feature.loadSceneFromDevice(
        requestSceneCaptureIfNoDataFound = true,
        removeMissingRooms = true,
        sceneModel = SceneModel.V2_FALLBACK_V1,
    ).whenComplete { result, err ->
      Log.i(TAG, "room load: $result ${err?.message ?: ""} · rooms ${feature.rooms.size} · floor ${originPose() != null}")
      if (result == MRUKLoadDeviceResult.ERROR_NO_ROOMS_FOUND && !captureAsked) {
        // The headset holds no room model this app can read (seen even right after Space Setup). Open the headset's
        // own room scan from here — as Meta's sample does — then load again. Once per launch, so it cannot loop.
        captureAsked = true
        Log.i(TAG, "no room: asking the headset for a room scan")
        feature.requestSceneCapture().whenComplete { _, e ->
          Log.i(TAG, "room scan finished ${e?.message ?: ""}")
          load()
        }
        return@whenComplete
      }
      resolved = true
      // Always: the activity saves nothing until now, and puts every piece back where it belongs (in the room, or
      // in the headset's frame when there is none). onRoomAdded can fire before this, while saving was still off.
      onChange?.invoke()
    }
  }

  private var captureAsked = false

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

  override fun onRoomAdded(room: MRUKRoom) { if (wantWalls) showWalls(true); onChange?.invoke() }
  override fun onRoomUpdated(room: MRUKRoom) { onChange?.invoke() }

  companion object { private const val TAG = "ModuliOffice" }
}
