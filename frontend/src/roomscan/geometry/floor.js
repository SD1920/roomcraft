// Floor-plane geometry on plain [x, z] pairs, in metres.
//
// The AR session is y-up, so a point on the floor is fully described by its
// (x, z). Nothing here imports three.js: these functions are the part of the
// scan that can be checked against known answers without a phone, so they are
// kept free of anything that needs a browser.
//
// Degenerate input returns null. A near-parallel pair of walls "intersects"
// hundreds of metres away, and a number like that looks like a result; null
// cannot be mistaken for one.

const DEG = Math.PI / 180;

export function distance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Total-least-squares line through 2+ floor points.
 * Perpendicular residuals, not vertical ones: a wall can run in any direction,
 * and ordinary least squares breaks down for a wall parallel to the z axis.
 * @returns {{point:number[], dir:number[], rms:number} | null}
 */
export function fitLine2D(points) {
  if (!points || points.length < 2) return null;
  const n = points.length;
  let cx = 0, cz = 0;
  for (const p of points) { cx += p[0]; cz += p[1]; }
  cx /= n; cz /= n;
  let sxx = 0, sxz = 0, szz = 0;
  for (const p of points) {
    const dx = p[0] - cx, dz = p[1] - cz;
    sxx += dx * dx; sxz += dx * dz; szz += dz * dz;
  }
  sxx /= n; sxz /= n; szz /= n;
  const mean = (sxx + szz) / 2;
  const spread = Math.hypot((sxx - szz) / 2, sxz);
  // largest eigenvalue ~ 0 means every point is the same point: no direction
  if (mean + spread < 1e-12) return null;
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const rms = Math.sqrt(Math.max(0, mean - spread));
  return { point: [cx, cz], dir: [Math.cos(theta), Math.sin(theta)], rms };
}

/**
 * Intersection of two lines from fitLine2D.
 * @param minAngleDeg below this angle between the lines the answer is null
 */
export function intersectLines2D(a, b, minAngleDeg = 5) {
  if (!a || !b) return null;
  const cross = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
  // dirs are unit length, so |cross| is the sine of the angle between them
  if (Math.abs(cross) < Math.sin(minAngleDeg * DEG)) return null;
  const px = b.point[0] - a.point[0], pz = b.point[1] - a.point[1];
  const t = (px * b.dir[1] - pz * b.dir[0]) / cross;
  return [a.point[0] + t * a.dir[0], a.point[1] + t * a.dir[1]];
}

/** Shoelace area. Sign depends on winding; see polygonArea for the magnitude. */
export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

export function polygonArea(poly) {
  return Math.abs(signedArea(poly));
}

/**
 * Distance between the first and last point of a traced outline. When the user
 * finishes by re-tapping the corner they started on, this is how far tracking
 * drifted over the walk -- a quality score that needs no tape measure.
 */
export function loopGap(points) {
  if (!points || points.length < 2) return null;
  return distance(points[0], points[points.length - 1]);
}

/**
 * How steeply the camera looks down at a floor point: 90 = straight down,
 * 0 = along the horizon. Takes full [x, y, z] positions.
 * Low angles are where a floor hit is least trustworthy, so every tap records
 * this and the usable limit is chosen from measurements, not assumed.
 */
export function depressionAngleDeg(cam, hit) {
  const horiz = Math.hypot(hit[0] - cam[0], hit[2] - cam[2]);
  return Math.atan2(cam[1] - hit[1], horiz) / DEG;
}

/**
 * Move a floor polygon into the room frame: first corner at the origin, first
 * wall along +x. Rotation and translation only -- never a mirror, which would
 * silently swap the left and right sides of the room.
 */
export function toRoomFrame(poly) {
  if (!poly || poly.length < 2) return null;
  const [ox, oz] = poly[0];
  const dx = poly[1][0] - ox, dz = poly[1][1] - oz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return null;
  const c = dx / len, s = dz / len;
  return poly.map(([x, z]) => {
    const px = x - ox, pz = z - oz;
    return [c * px + s * pz, -s * px + c * pz];
  });
}
