// Ray-plane intersection on plain [x, y, z] arrays, in metres.
//
// This is how ceiling height, doors and windows will be measured: the wall's
// plane is already known from its two floor corners, so a tap only has to
// supply a ray. That avoids relying on the phone to detect a blank wall.

const DEG = Math.PI / 180;

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l < 1e-12 ? null : [v[0] / l, v[1] / l, v[2] / l];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * @param minGrazeDeg below this angle between ray and plane the answer is null.
 *   A grazing ray moves its hit point by metres for a one-pixel change, so a
 *   value there is noise presented as a measurement.
 * @returns {{point:number[], t:number, grazeDeg:number} | null}
 *   null also when the plane is behind the ray origin.
 */
export function rayPlaneIntersect(origin, dir, planePoint, planeNormal, minGrazeDeg = 2) {
  const d = norm(dir), n = norm(planeNormal);
  if (!d || !n) return null;
  const dn = dot(d, n);
  const grazeDeg = Math.asin(Math.min(1, Math.abs(dn))) / DEG;
  if (grazeDeg < minGrazeDeg) return null;
  const w = [planePoint[0] - origin[0], planePoint[1] - origin[1], planePoint[2] - origin[2]];
  const t = dot(w, n) / dn;
  if (!(t > 0)) return null;
  return {
    point: [origin[0] + t * d[0], origin[1] + t * d[1], origin[2] + t * d[2]],
    t,
    grazeDeg,
  };
}
