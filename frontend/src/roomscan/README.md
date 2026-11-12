# AR room scanner

Measures a real room with an Android phone's camera, in the browser: its width and length, ceiling height, doors, windows and furniture. The result is saved as a design that the roomcraft editor opens.

It uses WebXR augmented reality in Chrome (ARCore underneath), plain JavaScript and three.js. No app to install. The page is [`frontend/scan.html`](../../scan.html); this folder is its code.

## Using it

1. Open the scanner on an Android phone in **Chrome**:
   - live site: `https://roomcraft-ivory.vercel.app/scan.html`;
   - locally: `npm run dev:wifi` in `frontend/`, then open `https://<laptop-ip>:5173/scan.html` on the phone.

   WebXR needs HTTPS.
2. **Walls.** Stand facing the wall with the door (wall 1). Tap its four corners in a U:
   - **bottom-left** (green ring on the floor);
   - **top-left** and **top-right** (aim at where the wall meets the ceiling);
   - **bottom-right**.

   Then **Next wall**, turning right. If a corner is hidden behind furniture, tap the floor beside it.
3. **Close room** when the last corner meets the first.
4. **Doors and windows:** two corners each. **Furniture:** pick the type and size (e.g. Bed → Queen), then tap once on it. You can also press **Guess from camera** to have the type suggested.
5. **Save to my designs.** The room opens in the editor with its real size.

## How it measures

- **Walls are lines, not corners.** Each wall is a line on the floor through its bottom taps, fitted with total least squares, so it works for walls at any angle ([`geometry/floor.js`](geometry/floor.js)). The room is the rectangle that best fits all four lines: its angle comes from all four wall directions, and its width and length from how far apart opposite walls are ([`scan/room_scan.js`](scan/room_scan.js)). Exact corner points are never needed.
- **Furniture in the way.** The aiming ring sits at the centre of the screen, so a "corner" tap can land on a bed in front of the wall. Taps more than 20 cm above the floor are left out of the wall fit, and that wall is placed from its top corners instead.
- **Ceiling height:** where the aiming lines through the top-corner taps meet each wall's plane ([`geometry/ray.js`](geometry/ray.js)).
- **Doors, windows, wall items:** two aimed corners meet the wall's plane, giving the position along the wall, width, height and sill.
- **Furniture:** one tap plus the catalogue's standard size, or two corners for tall pieces ([`scan/furniture.js`](scan/furniture.js)).
- **Tidy-up:** before saving, pieces are turned square to the walls and moved out of overlaps ([`room/app_design.js`](room/app_design.js)).
- **Raw taps are kept** ([`ar/tap_log.js`](ar/tap_log.js)). Results are always recomputed from them, so an old scan improves when the code improves.

## Camera furniture detection

1. **On-device guess.** Google MediaPipe runs the **EfficientDet-Lite0** model on the phone's CPU ([`detect/detector.js`](detect/detector.js)). It is loaded on first use. Its COCO labels are mapped to app furniture types ([`detect/coco_catalog.js`](detect/coco_catalog.js)).
2. **Gemini check.** One camera frame goes to the server, which asks Gemini, using the app's catalogue of 86 furniture types, and checks the answer ([`detect/gemini_format.js`](detect/gemini_format.js), [`../../server/gemini_detect.js`](../../server/gemini_detect.js)). The API key stays on the server.
3. **Finding where it stands.** The bottom-centre pixel of a detected box becomes a ray from the camera, and that ray meets the floor at the object's position ([`detect/camera_ray.js`](detect/camera_ray.js)).
4. **Placing it.** Pieces are placed against the wall being faced ([`detect/place.js`](detect/place.js)).
5. **Merging sightings.** Repeat sightings of the same type within 1.0 m are merged into one piece ([`detect/merge.js`](detect/merge.js)).
6. **The user confirms.** Detections are only suggestions until the user confirms them.

## Accuracy

- Lines on an open floor: within 1–2 cm typically, about 4 cm on long lines.
- Ceiling on a real room: 2.72 m against 2.74 m by tape.
- Rooms: within a few cm when the phone's tracking is steady and the corners are visible. Fast turns, plain walls and shiny floors can make tracking slip, and the app then shows a "check" verdict.
- Limits:
  - rectangular rooms only;
  - Android only, because iPhone Safari has no WebXR AR;
  - one-tap furniture uses standard sizes.

## Code map

| Folder / file | What it is |
|---|---|
| [`main.js`](main.js) | Page controller: AR session, guided scan, results, saving to the app |
| [`ar/session.js`](ar/session.js) | WebXR session: tracking, hit test, anchors, frame loop |
| [`ar/tap_log.js`](ar/tap_log.js) | Record of every tap; results are rebuilt from it |
| [`ar/measure.js`](ar/measure.js) | Simple tap-to-measure mode (tape checks) |
| [`ar/feature_report.js`](ar/feature_report.js) | Which AR features this phone supports |
| [`ar/camera_frame.js`](ar/camera_frame.js) | Copies the camera image for the detector |
| [`scan/room_scan.js`](scan/room_scan.js) | Scan state machine; wall lines, rectangle fit, ceiling, openings |
| [`scan/furniture.js`](scan/furniture.js) | Furniture from taps |
| [`scan/room_frame.js`](scan/room_frame.js) | AR world frame ↔ room frame |
| [`scan/room_scan_view.js`](scan/room_scan_view.js) | Markers and lines drawn in AR |
| [`geometry/floor.js`](geometry/floor.js), [`geometry/ray.js`](geometry/ray.js) | Line fitting, intersections, ray–plane maths |
| [`detect/`](detect/) | Camera furniture detection (above) |
| [`room/app_design.js`](room/app_design.js) | Scan → the app's design format (feet, room centred), tidy-up |
| [`room/room_json.js`](room/room_json.js), [`room/plan_sketch.js`](room/plan_sketch.js) | The scanner's own room file, top-view SVG sketch |
| [`data/`](data/) | Furniture catalogue (86 types) and common size presets |

## Tests

306 tests in [`frontend/tests/`](../../tests/), run with `npm test` in `frontend/`. Every geometry test uses rooms that are rotated, off the origin and with the floor below zero, as in a real AR session. [`ar_flow.test.js`](../../tests/ar_flow.test.js) runs a complete scan with a simulated AR session.
