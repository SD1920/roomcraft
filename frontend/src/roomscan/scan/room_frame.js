// Moving points between the AR session's frame and the room's frame.
//
// A `fit` (from fitRoomRectangle in room_scan.js) defines the room frame:
// origin at the room centre, x along the front wall towards the right wall,
// z towards the back wall, y up from the floor, metres. This matches the
// team app's layout (front wall at z = -length/2).
//
// Kept separate so room_scan.js and furniture.js can both use it without
// importing each other.

const xz = (p) => [p[0], p[2]];
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];

/** A point from the AR session's frame into the room frame (metres). */
export function toRoom(fit, p) {
  const d = [p[0] - fit.centre[0], p[2] - fit.centre[1]];
  return { x: dot2(d, fit.xAxis), z: dot2(d, fit.zAxis), y: p[1] - fit.floorY };
}

/** The inverse of toRoom: a room-frame point back into the AR frame. */
export function fromRoom(fit, x, z, y = 0) {
  return [
    fit.centre[0] + fit.xAxis[0] * x + fit.zAxis[0] * z,
    fit.floorY + y,
    fit.centre[1] + fit.xAxis[1] * x + fit.zAxis[1] * z,
  ];
}

/** Length of a named wall in metres: front and back run the room's width. */
export function wallLengthM(fit, wall) {
  return wall === 'front' || wall === 'back' ? fit.widthM : fit.lengthM;
}

/** Position along a wall in the room frame: x on front/back, z on left/right. */
export function alongWall(wall, r) {
  return wall === 'front' || wall === 'back' ? r.x : r.z;
}

export { xz, dot2 };
