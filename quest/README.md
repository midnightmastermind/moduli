# Moduli Office (Quest app)

The VR office as a native Meta Quest app (Meta Spatial SDK 0.14, Kotlin). The room is real (passthrough) and the
furniture is saved relative to your scanned room's floor, so it stays where you put it.

- `OfficeActivity.kt` — the room: fireplace, shelves, screens, decor; a floating Moduli panel (`viafluere.com/?office`,
  which in this app is `client/src/vr/NativeOffice.jsx`) holds every setting and sends the office as JSON.
- `RoomAnchor.kt` — MR Utility Kit: loads the room, gives the floor anchor (the frame poses are saved in), draws the
  room's own walls in VR mode.
- `GrabHandle.kt` — the white bar above each piece (below each panel) you grab to move it. The pieces themselves are
  not grabbable: a shelf's/screen's web panel covers its front, and the SDK's grab flipped a held piece to face you.
- `SelectOnTrigger.kt` — a trigger tap on a piece selects it.
- Controls (`OfficeActivity.InputSystem`): RIGHT stick left/right turns the held (else selected) piece 45°; LEFT stick
  up/down makes it 10% bigger/smaller (0.3x–3x, saved with its pose).
- `PlacementStore.kt` / `PoseMath.kt` — saved poses (per grid, per headset).
- `PanelHtml.kt` — the shelf and screen faces (plain HTML; only the control panel loads the Moduli app).
- `tools/exportModels.mjs` — writes the furniture from `client/src/vr/decorMakers.js` as .glb into `app/src/main/assets/office/`.

## Build

```
export JAVA_HOME=~/.local/jdk/jdk-17.0.21+9
echo "sdk.dir=$HOME/Android/Sdk" > local.properties
./gradlew :app:assembleDebug        # -> app/build/outputs/apk/debug/app-debug.apk
```

## Sideload

Quest in developer mode (Meta Horizon phone app › Devices › Developer mode), USB to the PC, then:
`adb install -r app-debug.apk` (or drag the APK onto the headset in Meta Quest Developer Hub).
It shows under Library › Unknown sources. Allow "spatial data" when asked; sign in to Moduli in the floating panel.
