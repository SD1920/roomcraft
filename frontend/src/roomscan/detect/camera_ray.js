// From a pixel in a camera frame to a point on the room's floor.
//
// A camera frame grabbed in the AR session comes with the view's projection
// matrix and pose. A pixel picks a line out of the camera; where that line
// meets the floor (whose height the wall taps already found) is where the
// thing at that pixel stands, if the pixel is where it touches the floor.
// For a detected object, the bottom-centre of its box is that pixel.
//
// Pixels are in the frame as handed to the detector: (0, 0) top-left, x right,
// y down. Normalised device coordinates are x right, y UP, -1 to 1.

import { Matrix4, Vector4 } from 'three';
import { dropToFloor } from '../ar/tap_log.js';

// A box whose bottom is within this fraction of the frame's bottom edge is
// treated as cut off by the frame.
const CUT_OFF_FRACTION = 0.02;

/**
 * @param projection 16 numbers, column-major (XRView.projectionMatrix)
 * @param view 16 numbers, column-major (XRView.transform.matrix): camera to world
 * @returns {{origin: number[], dir: number[]}} unit direction, world frame
 */
export function pixelRay(projection, view, u, v, width, height) {
  const ndcX = (2 * u) / width - 1;
  const ndcY = 1 - (2 * v) / height;
  const invProj = new Matrix4().fromArray(projection).invert();
  const p = new Vector4(ndcX, ndcY, -1, 1).applyMatrix4(invProj);
  const dirCam = new Vector4(p.x / p.w, p.y / p.w, p.z / p.w, 0);
  const world = dirCam.applyMatrix4(new Matrix4().fromArray(view));
  const len = Math.hypot(world.x, world.y, world.z);
  return {
    origin: [view[12], view[13], view[14]],
    dir: [world.x / len, world.y / len, world.z / len],
  };
}

/**
 * Where a detected box stands on the floor.
 * @param box {x, y, w, h} in frame pixels, top-left origin
 * @returns {{point: number[] | null, widthM: number | null, cutOff?: true} | null}
 *   null when the floor is unknown or the box bottom does not look down onto
 *   the floor; point null with cutOff when the box runs off the frame bottom
 */
export function placeBoxOnFloor(box, frame, floorY) {
  if (floorY === null || floorY === undefined) return null;
  const bottom = box.y + box.h;
  // A box running off the bottom of the frame does not show where the object
  // meets the floor, so its bottom edge is not its base. First phone run:
  // close-ups of a bed had boxes cut by the frame, and their floor points
  // landed at the photographer's feet.
  if (bottom >= frame.height * (1 - CUT_OFF_FRACTION)) return { point: null, widthM: null, cutOff: true };
  const at = (u) => dropToFloor(pixelRay(frame.projection, frame.view, u, bottom, frame.width, frame.height), floorY);
  const centre = at(box.x + box.w / 2);
  if (!centre) return null;
  const left = at(box.x), right = at(box.x + box.w);
  // the box's bottom edge seen from an angle is not the object's true width;
  // a rough figure, used only to suggest a size
  const widthM = left && right ? Math.hypot(right[0] - left[0], right[2] - left[2]) : null;
  return { point: centre, widthM };
}

/**
 * The reverse of pixelRay, for tests and drawing: where a world point
 * appears in the frame, in pixels, or null if it is behind the camera.
 */
export function projectToPixel(projection, view, p, width, height) {
  const toCam = new Matrix4().fromArray(view).invert();
  const c = new Vector4(p[0], p[1], p[2], 1).applyMatrix4(toCam);
  if (c.z >= 0) return null; // the camera looks along -z
  const clip = c.applyMatrix4(new Matrix4().fromArray(projection));
  const ndcX = clip.x / clip.w, ndcY = clip.y / clip.w;
  return [((ndcX + 1) / 2) * width, ((1 - ndcY) / 2) * height];
}
