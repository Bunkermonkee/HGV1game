/**
 * Tiny WebGL2 renderer for the first-person view: a handful of unit meshes
 * (box, cylinder, cone, quad) drawn with a model matrix and a colour, simple
 * sun + ambient lighting, up to MAX_LIGHTS spot/point lights for night, and
 * distance fog for rain. No libraries – the whole thing is a few KB.
 */
import type { Mat4 } from './mat4.ts';

export const MAX_LIGHTS = 12;

export interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
}

export type RGBA = [number, number, number, number];

export interface Light {
  pos: [number, number, number];
  /** Unit direction the light points in (ignored for point lights). */
  dir: [number, number, number];
  /** cos of the cone's half-angle; -1 = point light. */
  cosCut: number;
  range: number;
  colour: [number, number, number];
}

export interface Environment {
  sky: [number, number, number];
  ambient: number;
  sun: number;
  sunDir: [number, number, number];
  fogColour: [number, number, number];
  /** Fog from `fogNear` to fully fogged at `fogFar` metres (0 = no fog). */
  fogNear: number;
  fogFar: number;
  lights: Light[];
}

export interface DrawOptions {
  texture?: WebGLTexture | null;
  /** Adds this much of the base colour regardless of lighting (lamps, glass). */
  emissive?: number;
}

const VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec2 aUv;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  vUv = aUv;
  gl_Position = uViewProj * w;
}`;

const FS = `#version 300 es
precision highp float;
#define MAX_LIGHTS ${MAX_LIGHTS}
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
uniform vec4 uColour;
uniform float uEmissive;
uniform bool uUseTex;
uniform sampler2D uTex;
uniform vec3 uEye;
uniform float uAmbient;
uniform float uSun;
uniform vec3 uSunDir;
uniform vec3 uFogColour;
uniform float uFogNear;
uniform float uFogFar;
uniform int uLightCount;
uniform vec3 uLightPos[MAX_LIGHTS];
uniform vec3 uLightDir[MAX_LIGHTS];
uniform float uLightCos[MAX_LIGHTS];
uniform float uLightRange[MAX_LIGHTS];
uniform vec3 uLightColour[MAX_LIGHTS];
out vec4 outColour;
void main() {
  vec4 base = uColour;
  if (uUseTex) base *= texture(uTex, vUv);
  if (base.a < 0.02) discard;
  vec3 n = normalize(vNormal);
  // Two-sided: flip normals facing away (quads, and faces seen in mirrors).
  vec3 toEye = uEye - vWorld;
  if (dot(n, toEye) < 0.0) n = -n;
  float light = uAmbient + uSun * max(dot(n, uSunDir), 0.0);
  vec3 add = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLightCount) break;
    vec3 d = uLightPos[i] - vWorld;
    float dist = length(d);
    vec3 l = d / max(dist, 0.001);
    float att = clamp(1.0 - dist / uLightRange[i], 0.0, 1.0);
    att *= att;
    float cone = 1.0;
    if (uLightCos[i] > -1.0) {
      float c = dot(-l, uLightDir[i]);
      cone = smoothstep(uLightCos[i], uLightCos[i] + 0.12, c);
    }
    float lambert = max(dot(n, l), 0.0) * 0.8 + 0.2;
    add += uLightColour[i] * att * cone * lambert;
  }
  vec3 col = base.rgb * (light + add) + base.rgb * uEmissive;
  if (uFogFar > 0.0) {
    float f = clamp((length(toEye) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    col = mix(col, uFogColour, f);
  }
  outColour = vec4(col, base.a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
  return s;
}

export class GL {
  readonly gl: WebGL2RenderingContext;
  readonly box: Mesh;
  readonly cylinder: Mesh;
  readonly cone: Mesh;
  readonly quad: Mesh;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private anisotropy: { ext: EXT_texture_filter_anisotropic; max: number } | null = null;

  /** Throws if WebGL2 isn't available. */
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.bindAttribLocation(p, 1, 'aNormal');
    gl.bindAttribLocation(p, 2, 'aUv');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    this.prog = p;
    gl.useProgram(p);
    for (const name of [
      'uModel', 'uViewProj', 'uColour', 'uEmissive', 'uUseTex', 'uTex', 'uEye', 'uAmbient', 'uSun', 'uSunDir',
      'uFogColour', 'uFogNear', 'uFogFar', 'uLightCount', 'uLightPos', 'uLightDir', 'uLightCos', 'uLightRange', 'uLightColour',
    ]) {
      this.u[name] = gl.getUniformLocation(p, name);
    }
    gl.uniform1i(this.u.uTex, 0);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) this.anisotropy = { ext, max: gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number };

    this.box = this.mesh(boxGeometry());
    this.cylinder = this.mesh(cylinderGeometry(16));
    this.cone = this.mesh(coneGeometry(14));
    this.quad = this.mesh(quadGeometry());
    gl.enable(gl.DEPTH_TEST);
  }

  private mesh(g: { pos: number[]; normal: number[]; uv: number[] }): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    [g.pos, g.normal, g.uv].forEach((data, i) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, i === 2 ? 2 : 3, gl.FLOAT, false, 0, 0);
    });
    gl.bindVertexArray(null);
    return { vao, count: g.pos.length / 3 };
  }

  /** Texture from a canvas or image, mipmapped for the ground at grazing angles. */
  texture(src: TexImageSource, repeat = false): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (this.anisotropy) gl.texParameterf(gl.TEXTURE_2D, this.anisotropy.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, this.anisotropy.max));
    return t;
  }

  deleteTexture(t: WebGLTexture | null | undefined): void {
    if (t) this.gl.deleteTexture(t);
  }

  /** Start a view: viewport rectangle in device pixels (origin bottom-left). */
  beginView(x: number, y: number, w: number, h: number, viewProj: Mat4, eye: number[], env: Environment): void {
    const gl = this.gl;
    gl.viewport(x, y, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, w, h);
    gl.clearColor(env.sky[0], env.sky[1], env.sky[2], 1);
    // The previous view may have ended in the transparent pass (depth writes off).
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uViewProj, false, viewProj);
    gl.uniform3f(this.u.uEye, eye[0], eye[1], eye[2]);
    gl.uniform1f(this.u.uAmbient, env.ambient);
    gl.uniform1f(this.u.uSun, env.sun);
    gl.uniform3f(this.u.uSunDir, env.sunDir[0], env.sunDir[1], env.sunDir[2]);
    gl.uniform3f(this.u.uFogColour, env.fogColour[0], env.fogColour[1], env.fogColour[2]);
    gl.uniform1f(this.u.uFogNear, env.fogNear);
    gl.uniform1f(this.u.uFogFar, env.fogFar);
    const n = Math.min(MAX_LIGHTS, env.lights.length);
    gl.uniform1i(this.u.uLightCount, n);
    if (n) {
      const pos = new Float32Array(n * 3);
      const dir = new Float32Array(n * 3);
      const col = new Float32Array(n * 3);
      const cos = new Float32Array(n);
      const range = new Float32Array(n);
      env.lights.slice(0, n).forEach((l, i) => {
        pos.set(l.pos, i * 3);
        dir.set(l.dir, i * 3);
        col.set(l.colour, i * 3);
        cos[i] = l.cosCut;
        range[i] = l.range;
      });
      gl.uniform3fv(this.u.uLightPos, pos);
      gl.uniform3fv(this.u.uLightDir, dir);
      gl.uniform3fv(this.u.uLightColour, col);
      gl.uniform1fv(this.u.uLightCos, cos);
      gl.uniform1fv(this.u.uLightRange, range);
    }
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  endViews(): void {
    this.gl.disable(this.gl.SCISSOR_TEST);
  }

  /** Switch to alpha-blended drawing (after all opaque parts). */
  beginTransparent(): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
  }

  draw(mesh: Mesh, model: Mat4, colour: RGBA, opts: DrawOptions = {}): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.u.uModel, false, model);
    gl.uniform4f(this.u.uColour, colour[0], colour[1], colour[2], colour[3]);
    gl.uniform1f(this.u.uEmissive, opts.emissive ?? 0);
    const tex = opts.texture ?? null;
    gl.uniform1i(this.u.uUseTex, tex ? 1 : 0);
    if (tex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    }
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
}

// ---- Unit geometry (all centred on the origin, size 1) --------------------------

type Geo = { pos: number[]; normal: number[]; uv: number[] };

function pushTri(g: Geo, a: number[], b: number[], c: number[], n: number[], uva = [0, 0], uvb = [0, 0], uvc = [0, 0]): void {
  g.pos.push(...a, ...b, ...c);
  g.normal.push(...n, ...n, ...n);
  g.uv.push(...uva, ...uvb, ...uvc);
}

function boxGeometry(): Geo {
  const g: Geo = { pos: [], normal: [], uv: [] };
  const h = 0.5;
  // Each face: normal and two in-plane axes.
  const faces: [number[], number[], number[]][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    const corner = (su: number, sv: number) => [0, 1, 2].map((i) => n[i] * h + u[i] * su * h + v[i] * sv * h);
    const a = corner(-1, -1);
    const b = corner(1, -1);
    const c = corner(1, 1);
    const d = corner(-1, 1);
    pushTri(g, a, b, c, n, [0, 1], [1, 1], [1, 0]);
    pushTri(g, a, c, d, n, [0, 1], [1, 0], [0, 0]);
  }
  return g;
}

/** Axis along y, radius 0.5, height 1. */
function cylinderGeometry(sides: number): Geo {
  const g: Geo = { pos: [], normal: [], uv: [] };
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = [Math.cos(a0) * 0.5, Math.sin(a0) * 0.5];
    const p1 = [Math.cos(a1) * 0.5, Math.sin(a1) * 0.5];
    const nm = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
    const b0 = [p0[0], -0.5, p0[1]];
    const b1 = [p1[0], -0.5, p1[1]];
    const t0 = [p0[0], 0.5, p0[1]];
    const t1 = [p1[0], 0.5, p1[1]];
    pushTri(g, b0, b1, t1, nm);
    pushTri(g, b0, t1, t0, nm);
    pushTri(g, [0, 0.5, 0], t0, t1, [0, 1, 0]);
    pushTri(g, [0, -0.5, 0], b1, b0, [0, -1, 0]);
  }
  return g;
}

/** Axis along y: base radius 0.5 at y = -0.5, apex at y = 0.5. */
function coneGeometry(sides: number): Geo {
  const g: Geo = { pos: [], normal: [], uv: [] };
  const slope = 0.5; // radius / height
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const b0 = [Math.cos(a0) * 0.5, -0.5, Math.sin(a0) * 0.5];
    const b1 = [Math.cos(a1) * 0.5, -0.5, Math.sin(a1) * 0.5];
    const l = Math.hypot(1, slope);
    const nm = [Math.cos(am) / l, slope / l, Math.sin(am) / l];
    pushTri(g, b0, b1, [0, 0.5, 0], nm);
    pushTri(g, [0, -0.5, 0], b1, b0, [0, -1, 0]);
  }
  return g;
}

/** In the xy plane facing +z; uv (0,0) at the top-left (x -0.5, y +0.5). */
function quadGeometry(): Geo {
  const g: Geo = { pos: [], normal: [], uv: [] };
  const n = [0, 0, 1];
  pushTri(g, [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], n, [0, 1], [1, 1], [1, 0]);
  pushTri(g, [-0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], n, [0, 1], [1, 0], [0, 0]);
  return g;
}
