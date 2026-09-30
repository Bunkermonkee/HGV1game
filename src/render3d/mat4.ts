/**
 * Minimal 4×4 matrix maths for the first-person renderer (column-major, as
 * WebGL expects).
 *
 * World axes: X = east (the 2D game's x), Y = up, Z = south (the 2D game's
 * y). A 2D heading θ points along (cos θ, 0, sin θ). Model space for
 * vehicles and objects: +x forwards, +y up, +z to the object's right.
 */
export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** out = a · b */
export function multiply(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
    }
  }
  return out;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function lookAt(eye: number[], target: number[], up: number[] = [0, 1, 0]): Mat4 {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l;
  zy /= l;
  zz /= l;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz) || 1;
  xx /= l;
  xy /= l;
  xz /= l;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx;
  m[1] = yx;
  m[2] = zx;
  m[4] = xy;
  m[5] = yy;
  m[6] = zy;
  m[8] = xz;
  m[9] = yz;
  m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

/**
 * A 2D-style placement: position (x, height, z) and a heading about the
 * vertical, as used everywhere in the game.
 */
export function frame(x: number, y: number, z: number, heading: number): Mat4 {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const m = new Float32Array(16);
  // Columns: local x → (c, 0, s), local y → up, local z → (−s, 0, c).
  m[0] = c;
  m[2] = s;
  m[5] = 1;
  m[8] = -s;
  m[10] = c;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  m[15] = 1;
  return m;
}

/** A box/primitive placed in `parent`'s frame: centre (x, y, z), size, optional yaw about y and roll about x. */
export function place(
  parent: Mat4,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  yaw = 0,
  roll = 0,
  out: Mat4 = new Float32Array(16),
): Mat4 {
  const cy = Math.cos(yaw);
  const syw = Math.sin(yaw);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  // Local = T · Ryaw · Rroll · S
  const l = new Float32Array(16);
  // Rroll about x: y → (0, cr, sr), z → (0, −sr, cr); then yaw about y (same convention as frame()).
  l[0] = cy * sx;
  l[1] = 0;
  l[2] = syw * sx;
  // column y: yaw applied to (0, cr, sr)
  l[4] = -syw * sr * sy;
  l[5] = cr * sy;
  l[6] = cy * sr * sy;
  // column z: yaw applied to (0, −sr, cr)
  l[8] = -syw * cr * sz;
  l[9] = -sr * sz;
  l[10] = cy * cr * sz;
  l[12] = x;
  l[13] = y;
  l[14] = z;
  l[15] = 1;
  return multiply(parent, l, out);
}

export function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}

export function transformDir(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
}
