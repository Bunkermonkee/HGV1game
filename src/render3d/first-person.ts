/**
 * First-person view: the yard in 3D from the driver's seat, with nearside
 * and offside mirrors rendered from the real mirror heads.
 *
 * The yard floor is the 2D game's own top-down drawing turned into a
 * texture, so bay lines, numbers and hatching match the overhead view
 * exactly. Everything standing up (buildings, dock doors, buffers, trailers,
 * cones, the rig) is built from boxes, cylinders and cones.
 */
import { BRAND, brandLogo } from '../config/brand.ts';
import { theme } from '../config/theme.ts';
import { TRACTOR, TRAILER } from '../config/vehicle.ts';
import { DEG } from '../core/math.ts';
import type { Obstacle } from '../game/obstacles.ts';
import type { Session } from '../game/session.ts';
import type { Bay, YardLayout } from '../game/yard.ts';
import type { Artic } from '../physics/artic.ts';
import { Atmosphere } from '../render/atmosphere.ts';
import { drawYard } from '../render/draw-yard.ts';
import { GL, type Environment, type Light, type RGBA } from './gl.ts';
import { frame, lookAt, multiply, perspective, place, transformDir, transformPoint, type Mat4 } from './mat4.ts';

/** A mirror inset on screen, CSS pixels from the top-left. */
export interface MirrorRect {
  side: -1 | 1; // -1 nearside (left), +1 offside (right, the driver's side)
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FirstPersonFrame {
  viewW: number;
  viewH: number;
  dpr: number;
  /** Where the driver is looking, relative to straight ahead (radians, + = right). */
  lookYaw: number;
  mirrors: MirrorRect[];
}

// ---- Vehicle geometry (metres, vehicle frames: +x forwards, +z right) ----------

const CAB_FRONT = TRACTOR.wheelbase + TRACTOR.frontOverhang;
const CAB_REAR = CAB_FRONT - TRACTOR.cabLength;
const T_REAR = -(TRAILER.length - TRAILER.kingpinSetback);
const T_FRONT = TRAILER.kingpinSetback;
const MIRROR_X = CAB_FRONT - 0.45;
const MIRROR_Z = TRACTOR.width / 2 + TRACTOR.mirrorReach;
/** Driver's eye: right-hand seat, about 2.5 m up. */
const EYE = { x: CAB_FRONT - 0.95, y: 2.55, z: 0.55 };
const DECK = 1.3; // trailer floor height
const BODY_TOP = 4.0;

const BUILDING_HEIGHT = 9;
const POD_HEIGHT = 4.6;
const FENCE_HEIGHT = 2.2;
const GROUND_MARGIN = 30;

function rgb(hex: string, a = 1): RGBA {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

const BLACK: RGBA = [0.06, 0.06, 0.07, 1];
const TYRE: RGBA = [0.08, 0.08, 0.08, 1];
const CHASSIS: RGBA = [0.14, 0.15, 0.16, 1];
const STEEL: RGBA = [0.62, 0.65, 0.68, 1];
const GLASS: RGBA = [0.12, 0.16, 0.2, 1];
const CONE: RGBA = [1, 0.42, 0.05, 1];
const WHITE: RGBA = [0.95, 0.95, 0.95, 1];
const YELLOW: RGBA = [1, 0.8, 0.05, 1];
const DASH: RGBA = [0.11, 0.12, 0.13, 1];
const TRIM: RGBA = [0.2, 0.21, 0.23, 1];

/** Per-yard GPU resources, rebuilt when the level changes. */
interface YardAssets {
  yard: YardLayout;
  ground: WebGLTexture;
  signs: Map<string, WebGLTexture>;
  scenery: { x: number; z: number; w: number; d: number; h: number; colour: RGBA; kind: 'unit' | 'tree' }[];
}

export class FirstPerson {
  private g: GL;
  private assets: YardAssets | null = null;
  private logo: WebGLTexture | null = null;
  private logoAspect = 3;
  private door: WebGLTexture;

  /** Throws if WebGL2 isn't available: check `FirstPerson.supported()` first. */
  constructor(readonly canvas: HTMLCanvasElement) {
    this.g = new GL(canvas);
    this.door = this.g.texture(doorTexture());
  }

  static supported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch {
      return false;
    }
  }

  private ensureAssets(yard: YardLayout): YardAssets {
    if (this.assets?.yard === yard) return this.assets;
    if (this.assets) {
      this.g.deleteTexture(this.assets.ground);
      for (const t of this.assets.signs.values()) this.g.deleteTexture(t);
    }
    const signs = new Map<string, WebGLTexture>();
    for (const b of yard.bays) if (b.buffers) signs.set(b.label, this.g.texture(signTexture(b.label, !!b.target)));
    this.assets = { yard, ground: this.g.texture(groundTexture(yard)), signs, scenery: scenery(yard) };
    return this.assets;
  }

  private ensureLogo(): void {
    if (this.logo || !BRAND.trailerRoofLogo) return;
    const img = brandLogo('onDark');
    if (!img) return;
    this.logo = this.g.texture(img);
    this.logoAspect = img.naturalWidth / img.naturalHeight;
  }

  render(session: Session, f: FirstPersonFrame): void {
    const g = this.g;
    const { viewW, viewH, dpr } = f;
    const pw = Math.round(viewW * dpr);
    const ph = Math.round(viewH * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    const yard = session.yard;
    const artic = session.artic;
    const assets = this.ensureAssets(yard);
    this.ensureLogo();
    const env = environment(yard, artic, session);
    const cab = frame(artic.x, 0, artic.y, artic.heading);

    // Driver's view.
    const eye = transformPoint(cab, EYE.x, EYE.y, EYE.z);
    const yaw = f.lookYaw;
    const pitch = -0.1 + Math.min(0, -Math.abs(yaw) * 0.08);
    const dir = transformDir(cab, Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    const aspect = pw / ph;
    const hfov = 88 * DEG;
    const fovY = Math.min(72 * DEG, Math.max(42 * DEG, 2 * Math.atan(Math.tan(hfov / 2) / aspect)));
    const vp = multiply(perspective(fovY, aspect, 0.05, 600), lookAt(eye, [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]]));
    g.beginView(0, 0, pw, ph, vp, eye, env);
    this.drawWorld(session, assets, true);

    // Mirrors: look back down the side from each mirror head, reflected.
    for (const m of f.mirrors) {
      const mx = Math.round(m.x * dpr);
      const my = Math.round((viewH - m.y - m.h) * dpr);
      const mw = Math.round(m.w * dpr);
      const mh = Math.round(m.h * dpr);
      if (mw < 8 || mh < 8) continue;
      const head = transformPoint(cab, MIRROR_X, 2.35, m.side * MIRROR_Z);
      const out = 7 * DEG;
      const down = 5 * DEG;
      const look = transformDir(cab, -Math.cos(out), -Math.sin(down), m.side * Math.sin(out));
      const a = mw / mh;
      const mfovY = 2 * Math.atan(Math.tan(13 * DEG) / a);
      const proj = perspective(mfovY, a, 0.1, 400);
      proj[0] = -proj[0]; // mirror image
      const mvp = multiply(proj, lookAt(head, [head[0] + look[0], head[1] + look[1], head[2] + look[2]]));
      g.beginView(mx, my, mw, mh, mvp, head, env);
      this.drawWorld(session, assets, false);
    }
    g.endViews();
  }

  // ---- Scene -------------------------------------------------------------------

  private drawWorld(session: Session, a: YardAssets, driverView: boolean): void {
    const g = this.g;
    const yard = session.yard;
    const I = frame(0, 0, 0, 0);
    const night = !!yard.conditions.night;

    // Ground: endless grass, then the yard texture on top.
    g.draw(g.quad, place(I, yard.width / 2, -0.03, yard.height / 2, 3000, 3000, 1, 0, -Math.PI / 2), rgb(theme.yardGrass));
    const gw = yard.width + GROUND_MARGIN * 2;
    const gh = yard.height + GROUND_MARGIN * 2;
    g.draw(g.quad, place(I, yard.width / 2, 0, yard.height / 2, gw, gh, 1, 0, -Math.PI / 2), [1, 1, 1, 1], { texture: a.ground });

    // Surroundings beyond the fence.
    for (const s of a.scenery) {
      if (s.kind === 'unit') g.draw(g.box, place(I, s.x, s.h / 2, s.z, s.w, s.h, s.d), s.colour);
      else {
        g.draw(g.cylinder, place(I, s.x, 1.2, s.z, 0.4, 2.4, 0.4), [0.3, 0.22, 0.14, 1]);
        g.draw(g.cone, place(I, s.x, 2 + s.h / 2, s.z, s.w, s.h, s.w), s.colour);
      }
    }

    for (const o of session.obstacles) this.drawObstacle(o);
    for (const bay of yard.bays) if (bay.buffers) this.drawDock(bay, a, night);
    this.drawRig(session.artic, driverView, night);
    if (driverView) this.drawCabInterior(session.artic);
    this.drawFence(yard);
  }

  private drawObstacle(o: Obstacle): void {
    const g = this.g;
    const b = o.box;
    const I = frame(b.cx, 0, b.cy, b.angle);
    const L = b.halfLength * 2;
    const W = b.halfWidth * 2;
    switch (o.kind) {
      case 'wall':
        if (o.building) {
          const h = Math.min(L, W) < 4 ? POD_HEIGHT : BUILDING_HEIGHT;
          g.draw(g.box, place(I, 0, h / 2, 0, L, h, W), rgb(theme.yardBuilding));
          g.draw(g.box, place(I, 0, h + 0.15, 0, L + 0.3, 0.3, W + 0.3), rgb(theme.yardBuildingRoof));
          g.draw(g.box, place(I, 0, 0.6, 0, L + 0.04, 1.2, W + 0.04), [0.5, 0.5, 0.48, 1]);
        } else {
          g.draw(g.box, place(I, 0, 1.1, 0, L, 2.2, W), [0.62, 0.62, 0.6, 1]);
        }
        break;
      case 'kerb':
        g.draw(g.box, place(I, 0, 0.08, 0, L, 0.16, W), rgb(theme.yardKerb));
        if (Math.min(L, W) > 1.5) g.draw(g.box, place(I, 0, 0.17, 0, L - 0.4, 0.02, W - 0.4), rgb(theme.yardGrass));
        break;
      case 'cone':
        if (o.hit) {
          g.draw(g.cone, place(I, 0, 0.2, 0.25, 0.4, 0.7, 0.4, 0.6, Math.PI / 2), CONE);
        } else {
          g.draw(g.box, place(I, 0, 0.02, 0, 0.44, 0.04, 0.44), BLACK);
          g.draw(g.cone, place(I, 0, 0.4, 0, 0.4, 0.76, 0.4), CONE);
          g.draw(g.cylinder, place(I, 0, 0.45, 0, 0.19, 0.1, 0.19), WHITE);
        }
        break;
      case 'bollard':
        g.draw(g.cylinder, place(I, 0, 0.55, 0, 0.3, 1.1, 0.3), YELLOW);
        g.draw(g.cylinder, place(I, 0, 0.85, 0, 0.31, 0.12, 0.31), BLACK);
        break;
      case 'buffer':
        g.draw(g.box, place(I, 0, 1.15, 0, L, 0.45, W), BLACK);
        break;
      case 'trailer': {
        // Parked trailer: the obstacle box runs rear → front along its heading.
        const kingpin = frame(
          b.cx + Math.cos(b.angle) * (b.halfLength - TRAILER.kingpinSetback),
          0,
          b.cy + Math.sin(b.angle) * (b.halfLength - TRAILER.kingpinSetback),
          b.angle,
        );
        this.drawTrailer(kingpin, rgb(o.colour ?? '#6b6f76'), true, false, false);
        break;
      }
      default:
        break;
    }
  }

  private drawDock(bay: Bay, a: YardAssets, night: boolean): void {
    const g = this.g;
    const F = frame(bay.x, 0, bay.y, bay.heading * DEG);
    const dw = bay.width - 0.9;
    // Seal, door and leveller at the building face (bay frame: +x out of the bay).
    g.draw(g.box, place(F, 0.02, 2.85, 0, 0.06, 3.5, dw + 0.5), BLACK);
    g.draw(g.quad, place(F, 0.06, 2.85, 0, dw, 3.0, 1, -Math.PI / 2), [1, 1, 1, 1], { texture: this.door });
    g.draw(g.box, place(F, 0.08, 1.2, 0, 0.12, 0.1, dw), [0.3, 0.3, 0.3, 1]);
    // Traffic light beside the door: green on the target bay.
    const lamp: RGBA = bay.target ? [0.2, 1, 0.45, 1] : [1, 0.25, 0.15, 1];
    g.draw(g.box, place(F, 0.1, 2.3, dw / 2 + 0.45, 0.12, 0.5, 0.22), BLACK);
    g.draw(g.box, place(F, 0.17, 2.3, dw / 2 + 0.45, 0.02, 0.16, 0.14), lamp, { emissive: 1.4 });
    // Number board above the door.
    const sign = a.signs.get(bay.label);
    g.draw(g.quad, place(F, 0.07, 4.95, 0, 1.3, 0.85, 1, -Math.PI / 2), [1, 1, 1, 1], { texture: sign, emissive: night ? 0.6 : 0 });
    // Dock lamp on an arm above.
    g.draw(g.box, place(F, 0.35, 5.6, 0, 0.7, 0.08, 0.08), CHASSIS);
    g.draw(g.box, place(F, 0.7, 5.5, 0, 0.3, 0.14, 0.4), [0.9, 0.85, 0.6, 1], { emissive: night ? 1.2 : 0.1 });
  }

  private drawFence(yard: YardLayout): void {
    const g = this.g;
    const I = frame(0, 0, 0, 0);
    const m = 0.9;
    const x0 = -m;
    const x1 = yard.width + m;
    const z0 = -m;
    const z1 = yard.height + m;
    const post: RGBA = [0.15, 0.26, 0.18, 1];
    const sides: [number, number, number, number][] = [
      [x0, z0, x1, z0],
      [x1, z0, x1, z1],
      [x1, z1, x0, z1],
      [x0, z1, x0, z0],
    ];
    for (const [ax, az, bx, bz] of sides) {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.ceil(len / 3);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        g.draw(g.box, place(I, ax + (bx - ax) * t, FENCE_HEIGHT / 2, az + (bz - az) * t, 0.08, FENCE_HEIGHT, 0.08), post);
      }
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const ang = Math.atan2(bz - az, bx - ax);
      g.draw(g.box, place(I, cx, FENCE_HEIGHT - 0.1, cz, len, 0.06, 0.06, ang), post);
    }
    g.beginTransparent();
    for (const [ax, az, bx, bz] of sides) {
      const len = Math.hypot(bx - ax, bz - az);
      const ang = Math.atan2(bz - az, bx - ax);
      g.draw(g.box, place(I, (ax + bx) / 2, FENCE_HEIGHT / 2, (az + bz) / 2, len, FENCE_HEIGHT, 0.02, ang), [0.16, 0.3, 0.2, 0.35]);
    }
  }

  // ---- The rig -------------------------------------------------------------------

  private drawRig(artic: Artic, driverView: boolean, night: boolean): void {
    const g = this.g;
    const T = frame(artic.x, 0, artic.y, artic.heading);
    const cabColour = rgb(theme.cabColour);
    const hw = TRACTOR.width / 2;

    // Chassis, fuel tanks, fifth wheel.
    g.draw(g.box, place(T, 1.9, 0.85, 0, 5.4, 0.45, 1.0), CHASSIS);
    for (const s of [-1, 1]) g.draw(g.cylinder, place(T, 2.2, 0.7, s * 0.9, 0.55, 1.2, 0.55, Math.PI / 2, Math.PI / 2), STEEL);
    g.draw(g.cylinder, place(T, TRACTOR.fifthWheelAhead, 1.12, 0, 1.4, 0.1, 1.4), BLACK);

    if (!driverView) {
      // Cab body (from inside, the interior is drawn instead).
      const cabLen = CAB_FRONT - CAB_REAR;
      g.draw(g.box, place(T, CAB_REAR + cabLen / 2, 2.45, 0, cabLen, 2.6, TRACTOR.width), cabColour);
      g.draw(g.box, place(T, CAB_REAR + cabLen / 2 - 0.1, 3.95, 0, cabLen - 0.4, 0.4, TRACTOR.width - 0.2), rgb(theme.cabRoof));
      g.draw(g.box, place(T, CAB_FRONT + 0.005, 2.8, 0, 0.02, 1.1, TRACTOR.width - 0.3), GLASS, { emissive: 0.1 });
      for (const s of [-1, 1]) g.draw(g.box, place(T, CAB_FRONT - 0.65, 2.75, s * (hw + 0.005), 1.0, 0.95, 0.02), GLASS, { emissive: 0.1 });
    }
    // Bumper, headlights.
    g.draw(g.box, place(T, CAB_FRONT - 0.05, 0.85, 0, 0.15, 0.5, TRACTOR.width), BLACK);
    for (const s of [-1, 1]) {
      g.draw(g.box, place(T, CAB_FRONT + 0.03, 1.0, s * 0.95, 0.04, 0.2, 0.36), [1, 0.97, 0.85, 1], { emissive: night ? 2 : 0.4 });
    }
    // Mirror arms and heads.
    for (const s of [-1, 1]) {
      g.draw(g.box, place(T, MIRROR_X + 0.1, 2.9, s * (hw + 0.16), 0.05, 0.05, 0.34), BLACK);
      g.draw(g.box, place(T, MIRROR_X, 2.35, s * MIRROR_Z, 0.1, 0.6, 0.28), BLACK);
    }
    // Wheels: steered fronts, twin rears.
    const r = TRACTOR.wheelDiameter / 2;
    const tw = TRACTOR.track / 2;
    for (const s of [-1, 1]) {
      g.draw(g.cylinder, place(T, TRACTOR.wheelbase, r, s * tw, r * 2, TRACTOR.wheelWidth, r * 2, artic.steer, Math.PI / 2), TYRE);
      g.draw(g.cylinder, place(T, 0, r, s * tw, r * 2, 0.6, r * 2, 0, Math.PI / 2), TYRE);
      g.draw(g.cylinder, place(T, TRACTOR.wheelbase, r, s * (tw + TRACTOR.wheelWidth / 2 + 0.005), r, 0.01, r, artic.steer, Math.PI / 2), STEEL);
      g.draw(g.cylinder, place(T, 0, r, s * (tw + 0.305), r, 0.01, r, 0, Math.PI / 2), STEEL);
    }

    const hitch = artic.hitch;
    const K = frame(hitch.x, 0, hitch.y, artic.trailerHeading);
    this.drawTrailer(K, rgb(theme.trailerCurtain), false, artic.gear === 'R', night, true);
  }

  /**
   * Curtainsider in its kingpin frame. `parked`: landing legs down.
   * `reversing`: reversing lamps lit.
   */
  private drawTrailer(K: Mat4, curtain: RGBA, parked: boolean, reversing: boolean, night: boolean, logo = false): void {
    const g = this.g;
    const len = TRAILER.length;
    const mid = (T_REAR + T_FRONT) / 2;
    const hw = TRAILER.width / 2;
    const bodyH = BODY_TOP - DECK;
    g.draw(g.box, place(K, mid, DECK + bodyH / 2, 0, len, bodyH, TRAILER.width), curtain);
    g.draw(g.box, place(K, mid, BODY_TOP + 0.03, 0, len, 0.06, TRAILER.width), rgb(theme.trailerRoof));
    g.draw(g.box, place(K, mid, DECK - 0.1, 0, len, 0.2, TRAILER.width), [0.35, 0.36, 0.38, 1]);
    // Curtain straps: a few vertical lines each side.
    for (let x = T_REAR + 0.9; x < T_FRONT - 0.5; x += 1.1) {
      for (const s of [-1, 1]) g.draw(g.box, place(K, x, DECK + bodyH / 2, s * (hw + 0.004), 0.05, bodyH - 0.1, 0.01), [0.3, 0.3, 0.3, 1]);
    }
    // Amber side marker lamps along the bottom rail (they're what you see of it at night).
    for (let x = T_REAR + 1; x < T_FRONT - 1; x += 2.6) {
      for (const s of [-1, 1]) g.draw(g.box, place(K, x, DECK - 0.12, s * (hw + 0.01), 0.1, 0.06, 0.02), [1, 0.6, 0.1, 1], { emissive: night ? 3 : 0.4 });
    }
    // Rear doors and lamps.
    g.draw(g.box, place(K, T_REAR - 0.02, DECK + bodyH / 2, 0, 0.04, bodyH, TRAILER.width), [0.8, 0.82, 0.84, 1]);
    g.draw(g.box, place(K, T_REAR - 0.03, DECK + bodyH / 2, 0, 0.04, bodyH, 0.04), [0.5, 0.52, 0.55, 1]);
    g.draw(g.box, place(K, T_REAR + 0.3, 0.55, 0, 0.1, 0.12, TRAILER.width - 0.3), STEEL);
    for (const s of [-1, 1]) {
      g.draw(g.box, place(K, T_REAR - 0.05, 1.0, s * 1.0, 0.04, 0.16, 0.34), [1, 0.1, 0.08, 1], { emissive: night ? 1.2 : 0.3 });
      g.draw(g.box, place(K, T_REAR - 0.05, 1.0, s * 0.72, 0.04, 0.12, 0.14), [1, 1, 0.95, 1], { emissive: reversing ? 2.2 : 0 });
    }
    // Chassis rails and the tri-axle bogie.
    g.draw(g.box, place(K, mid, DECK - 0.35, 0, len - 1, 0.3, 1.0), CHASSIS);
    const r = TRAILER.wheelDiameter / 2;
    const tw = TRAILER.track / 2;
    for (let i = 0; i < TRAILER.axleCount; i++) {
      const x = -TRAILER.kingpinToBogie + (i - (TRAILER.axleCount - 1) / 2) * TRAILER.axleSpacing;
      for (const s of [-1, 1]) {
        g.draw(g.cylinder, place(K, x, r, s * tw, r * 2, TRAILER.wheelWidth, r * 2, 0, Math.PI / 2), TYRE);
        g.draw(g.cylinder, place(K, x, r, s * (tw + TRAILER.wheelWidth / 2 + 0.005), r, 0.01, r, 0, Math.PI / 2), STEEL);
      }
    }
    // Landing legs behind the kingpin (down to the ground when parked).
    for (const s of [-1, 1]) {
      const legH = parked ? DECK : 0.7;
      g.draw(g.box, place(K, -1.1, DECK - legH / 2, s * 0.85, 0.12, legH, 0.12), STEEL);
    }
    if (parked) g.draw(g.box, place(K, T_FRONT - 0.1, DECK + bodyH / 2, 0, 0.2, bodyH, TRAILER.width), curtain);
    if (logo && this.logo) {
      const w = Math.min(6, len * 0.4);
      const h = w / this.logoAspect;
      for (const s of [-1, 1]) {
        g.draw(g.quad, place(K, mid + 1, DECK + bodyH * 0.55, s * (hw + 0.02), w, h, 1, s > 0 ? 0 : Math.PI), [1, 1, 1, 1], { texture: this.logo });
      }
    }
  }

  /** Inside the cab: dashboard, pillars, roof header and door tops (driver's view only). */
  private drawCabInterior(artic: Artic): void {
    const g = this.g;
    const T = frame(artic.x, 0, artic.y, artic.heading);
    const hw = TRACTOR.width / 2 - 0.05;
    const glassX = CAB_FRONT - 0.12;
    // Dashboard, sloping away towards the screen.
    g.draw(g.box, place(T, glassX - 0.3, 2.02, 0, 0.6, 0.22, TRACTOR.width - 0.1), DASH);
    g.draw(g.box, place(T, glassX - 0.62, 1.9, EYE.z, 0.1, 0.3, 0.7), TRIM);
    // A-pillars, roof header and sun visor.
    for (const s of [-1, 1]) g.draw(g.box, place(T, glassX, 2.85, s * hw, 0.14, 1.5, 0.14), TRIM);
    g.draw(g.box, place(T, glassX - 0.15, 3.55, 0, 0.35, 0.18, TRACTOR.width - 0.1), TRIM);
    g.draw(g.box, place(T, glassX - 0.3, 3.38, EYE.z, 0.3, 0.03, 0.8), [0.18, 0.18, 0.2, 1]);
    // Door tops (the side window sills) and the B-pillar / back wall.
    for (const s of [-1, 1]) {
      g.draw(g.box, place(T, (CAB_REAR + glassX) / 2, 1.9, s * hw, glassX - CAB_REAR, 0.25, 0.08), TRIM);
      g.draw(g.box, place(T, CAB_REAR + 0.4, 2.8, s * hw, 0.12, 1.6, 0.12), TRIM);
    }
    g.draw(g.box, place(T, CAB_REAR + 0.1, 2.4, 0, 0.08, 2.2, TRACTOR.width - 0.1), [0.16, 0.16, 0.18, 1]);
    g.draw(g.box, place(T, CAB_REAR + 0.14, 2.9, 0, 0.02, 0.35, 0.9), GLASS);
    // Bonnet edge just visible below the screen.
    g.draw(g.box, place(T, CAB_FRONT - 0.02, 1.75, 0, 0.1, 0.12, TRACTOR.width), rgb(theme.cabColour));
  }
}

// ---- Lighting -------------------------------------------------------------------

function environment(yard: YardLayout, artic: Artic, session: Session): Environment {
  const c = yard.conditions;
  const lights: Light[] = [];
  const T = frame(artic.x, 0, artic.y, artic.heading);
  const hitch = artic.hitch;
  const K = frame(hitch.x, 0, hitch.y, artic.trailerHeading);
  const fwd = transformDir(T, 1, -0.12, 0);
  const back = transformDir(K, -1, -0.15, 0);
  const norm = (v: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  if (c.night) {
    for (const s of [-1, 1]) {
      lights.push({ pos: transformPoint(T, CAB_FRONT + 0.1, 1.0, s * 0.95), dir: norm(fwd), cosCut: 0.86, range: 55, colour: [1.3, 1.25, 1.1] });
    }
    if (artic.gear === 'R' && session.state === 'driving') {
      for (const s of [-1, 1]) {
        lights.push({ pos: transformPoint(K, T_REAR - 0.1, 1.0, s * 0.72), dir: norm(back), cosCut: 0.55, range: 26, colour: [0.95, 0.95, 0.9] });
      }
    }
    lights.push({ pos: transformPoint(K, T_REAR - 0.3, 1.0, 0), dir: [0, 0, 0], cosCut: -1, range: 5, colour: [0.5, 0.05, 0.03] });
    // Dock lamps: the nearest few (and the target bay's always).
    const docks = yard.bays
      .filter((b) => b.buffers)
      .map((b) => ({ b, d: Math.hypot(b.x - artic.x, b.y - artic.y) - (b.target ? 1000 : 0) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 7);
    for (const { b } of docks) {
      const F = frame(b.x, 0, b.y, b.heading * DEG);
      lights.push({
        pos: transformPoint(F, 0.8, 5.4, 0),
        dir: norm(transformDir(F, 0.5, -1, 0)),
        cosCut: 0.45,
        range: b.target ? 22 : 16,
        colour: b.target ? [0.8, 0.75, 0.55] : [0.45, 0.42, 0.3],
      });
    }
    return {
      sky: [0.02, 0.03, 0.05],
      ambient: 0.14,
      sun: 0,
      sunDir: [0, 1, 0],
      fogColour: [0.02, 0.03, 0.05],
      fogNear: 60,
      fogFar: 220,
      lights,
    };
  }
  if (c.rain) {
    const vis = c.visibility ?? 40;
    const fog: [number, number, number] = [0.52, 0.55, 0.58];
    return { sky: fog, ambient: 0.62, sun: 0.25, sunDir: norm([0.3, 1, 0.2]), fogColour: fog, fogNear: vis * 0.35, fogFar: vis * 1.6, lights };
  }
  return {
    sky: [0.62, 0.74, 0.87],
    ambient: 0.55,
    sun: 0.55,
    sunDir: norm([0.45, 0.8, 0.35]),
    fogColour: [0.7, 0.78, 0.86],
    fogNear: 150,
    fogFar: 700,
    lights,
  };
}

// ---- Textures -------------------------------------------------------------------

/** The yard floor, drawn by the 2D renderer. */
function groundTexture(yard: YardLayout): HTMLCanvasElement {
  const gw = yard.width + GROUND_MARGIN * 2;
  const gh = yard.height + GROUND_MARGIN * 2;
  const k = Math.min(24, 4096 / Math.max(gw, gh));
  const c = document.createElement('canvas');
  c.width = Math.round(gw * k);
  c.height = Math.round(gh * k);
  const ctx = c.getContext('2d')!;
  ctx.scale(k, k);
  ctx.translate(GROUND_MARGIN, GROUND_MARGIN);
  drawYard(ctx, yard);
  Atmosphere.wetTarmac(ctx, yard);
  return c;
}

function signTexture(label: string, target: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 84;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = target ? '#1f8f4e' : '#f2f2f2';
  ctx.fillRect(0, 0, 128, 84);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 122, 78);
  ctx.fillStyle = target ? '#fff' : '#111';
  ctx.font = `900 58px ${theme.uiFontDisplay}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 46);
  return c;
}

/** Sectional dock door: horizontal panels. */
function doorTexture(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = theme.yardDockDoor;
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 21) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, y, 128, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, y + 3, 128, 2);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(56, 112, 16, 6);
  return c;
}

/** Neighbouring units and trees outside the fence, fixed per yard. */
function scenery(yard: YardLayout): YardAssets['scenery'] {
  const out: YardAssets['scenery'] = [];
  let seed = Math.round(yard.width * 131 + yard.height * 17);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const units: RGBA[] = [
    [0.55, 0.6, 0.66, 1],
    [0.66, 0.66, 0.62, 1],
    [0.45, 0.52, 0.6, 1],
    [0.7, 0.68, 0.64, 1],
  ];
  // A row of units behind the far fence and along the sides.
  for (let x = -10; x < yard.width + 10; x += 34 + rnd() * 10) {
    out.push({ x, z: yard.height + 24 + rnd() * 10, w: 26 + rnd() * 8, d: 18, h: 7 + rnd() * 5, colour: units[Math.floor(rnd() * 4)], kind: 'unit' });
  }
  for (let z = 8; z < yard.height + 20; z += 30 + rnd() * 10) {
    out.push({ x: -26 - rnd() * 8, z, w: 18, d: 24, h: 6 + rnd() * 4, colour: units[Math.floor(rnd() * 4)], kind: 'unit' });
    out.push({ x: yard.width + 26 + rnd() * 8, z, w: 18, d: 24, h: 6 + rnd() * 4, colour: units[Math.floor(rnd() * 4)], kind: 'unit' });
  }
  for (let i = 0; i < 26; i++) {
    const side = Math.floor(rnd() * 3);
    const x = side === 0 ? -6 - rnd() * 6 : side === 1 ? yard.width + 6 + rnd() * 6 : rnd() * yard.width;
    const z = side === 2 ? yard.height + 5 + rnd() * 5 : 10 + rnd() * (yard.height - 5);
    const h = 4 + rnd() * 4;
    out.push({ x, z, w: 2.5 + rnd() * 2, d: 0, h, colour: [0.2 + rnd() * 0.08, 0.36 + rnd() * 0.1, 0.18, 1], kind: 'tree' });
  }
  return out;
}
