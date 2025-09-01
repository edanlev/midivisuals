// SolarLayer_WavesAutoNotes.ts
import * as THREE from 'three';

export type SolarParticleData = {
  data: THREE.Vector4;     // x, y, size, ageRatio
  velocity: THREE.Vector4; // vx, vy, life, invLife
  active: boolean;
};

type Wave = {
  data: THREE.Vector4;     // x, y, radius, strength
  color: THREE.Vector4;    // r, g, b, width
  speed: number;
  decay: number;
  active: boolean;
};

type HoldState = {
  startMs: number;
  lastSpawnMs: number;
  origin: THREE.Vector2;
  color: THREE.Color;
};

export type SolarLayer = {
  mesh: THREE.Mesh;
  uniforms: {
    u_time: { value: number };
    u_resolution: { value: THREE.Vector2 };
    u_params: { value: THREE.Vector4 };   // x=brightness, y=noiseScale, z=turbulence, w=corona
    u_rotation: { value: number };
    u_flareBoost: { value: number };
    u_flares: { value: THREE.Vector4[] }; // flares on surface
    u_waves: { value: THREE.Vector4[] };  // x,y,radius,strength
    u_waveColor: { value: THREE.Vector4[] }; // r,g,b,width
    u_color: { value: THREE.Vector2 };    // x=hueBias(0..1 warm tilt), y=coolBoost(0..1)
  };
  flares: SolarParticleData[];
  waves: Wave[];
  state: {
    rotSpeed: number;
    emaEnergy: number;
    emaPitch: number;
    emaPitchVar: number;
    activeNotes: Set<number>;
    holds: Map<number, HoldState>;
    lastNoteTs: number;
  };
};

export const MAX_FLARES = 48;
export const MAX_WAVES  = 96;

// ---------- Shaders ----------
const vertexShader = `
  varying vec2 v_uv;
  void main() {
    v_uv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const NOISE_GLSL = `
float hash(vec2 p){ return fract(1e4*sin(dot(p, vec2(127.1,311.7)))); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1,0));
  float c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.y*u.x;
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<6;i++){ v+=a*noise(p); p*=2.02; a*=0.5; }
  return v;
}
`;

const fragmentShader = (maxFlares: number, maxWaves: number) => `
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec2  u_resolution;
  uniform vec4  u_params;      // x=brightness, y=noiseScale, z=turbulence, w=corona
  uniform float u_rotation;
  uniform float u_flareBoost;
  uniform vec4  u_flares[${maxFlares}]; // x,y,size,age
  uniform vec4  u_waves[${maxWaves}];   // x,y,radius,strength
  uniform vec4  u_waveColor[${maxWaves}]; // r,g,b,width
  uniform vec2  u_color;        // hueBias, coolBoost

  ${NOISE_GLSL}

  vec3 heat(float t){
    t = clamp(t, 0.0, 1.25);
    vec3 deep = vec3(0.82, 0.28, 0.09);
    vec3 mid  = vec3(1.00, 0.55, 0.07);
    vec3 hot  = vec3(1.00, 0.96, 0.85);
    vec3 c = mix(deep, mid, smoothstep(0.15, 0.65, t));
    c = mix(c,   hot, smoothstep(0.65, 1.00, t));
    // warm tilt (0..1) → more yellow/white at 1, deeper red at 0
    c = mix(vec3(0.80,0.25,0.08), c, clamp(u_color.x,0.0,1.0));
    // subtle cool infusion for very hot regions (gives auroral blues for high/energetic play)
    c = mix(c, vec3(0.6,0.8,1.0), 0.18 * u_color.y * smoothstep(0.7, 1.1, t));
    return c;
  }

  vec2 rot(vec2 p, float a){
    float s=sin(a), c=cos(a);
    return mat2(c,-s,s,c) * p;
  }

  void main(){
    vec2 uv = v_uv * 2.0 - 1.0;
    uv.x *= u_resolution.x / u_resolution.y;

    float r = length(uv);
    float disk = smoothstep(1.05, 1.0, r);
    float outside = 1.0 - step(r, 1.0);

    vec2 suv = rot(uv, u_rotation);

    float t = u_time * 0.05;
    float noiseScale = 2.0 + 6.0 * u_params.y;
    float turb       = 0.6 + 2.0 * u_params.z;

    float base = fbm(suv * (0.8 + noiseScale*0.4) + vec2( t, -t));
    float cell = fbm(suv * (2.2 + noiseScale)     + vec2(-t,  0.6*t));
    float fine = fbm(suv * (4.5 + noiseScale*1.8) + vec2(1.1*t, -0.7*t));

    float fil = fbm(suv * (6.0 + 10.0*turb) + vec2(2.0*t, 1.3*t));
    float rivers = smoothstep(0.45, 0.85, fil);

    float intensity = 0.55*cell + 0.45*base + 0.25*fine - 0.45*rivers;

    float limb = pow(1.0 - clamp(r, 0.0, 1.0), 0.35);
    intensity *= mix(0.85, 1.25, limb);

    // Flares (bright active regions)
    float flareHeat = 0.0;
    for (int i = 0; i < ${maxFlares}; i++){
      float size = u_flares[i].z;
      if(size == 0.0) continue;
      vec2  p = u_flares[i].xy;
      float age = u_flares[i].w;
      float d = length(suv - p);
      float distort = 0.7 + 0.6 * fbm((suv - p) * 12.0 + u_time*2.0);
      float flare = 1.0 - smoothstep(0.0, size * distort, d);
      flare *= (1.0 - pow(age, 2.5));
      flareHeat += flare;
    }
    intensity += flareHeat * 0.9 + u_flareBoost * 0.35;

    // Traveling wavefronts (helioseismic-like ripples)
    float waveSum = 0.0;
    vec3  waveTint = vec3(0.0);
    for (int i = 0; i < ${maxWaves}; i++){
      float strength = u_waves[i].w;
      if (strength <= 0.0) continue;
      vec2  o = u_waves[i].xy;
      float radius = u_waves[i].z;
      float width  = u_waveColor[i].w;
      float d = length(suv - o);

      float ring = smoothstep(radius - width, radius, d) * (1.0 - smoothstep(radius, radius + width, d));
      float osc  = 0.6 + 0.4 * sin(8.0 * (d - radius));  // fine ripples on the ring
      float wv   = ring * osc * strength;

      waveSum   += wv;
      waveTint  += wv * u_waveColor[i].xyz;
    }
    intensity += 0.65 * waveSum; // waves brighten the surface

    vec3 col = heat(intensity);
    if (waveSum > 1e-4){
      vec3 wc = clamp(waveTint / (waveSum + 1e-5), 0.0, 1.2);
      col = mix(col, wc, clamp(waveSum, 0.0, 0.9)); // color-pull toward wave hue
    }

    col *= (0.9 + 1.6 * u_params.x); // brightness
    col = pow(col, vec3(1.0/1.6));
    col *= disk;

    // Corona (outside limb)
    float corona = 0.0;
    if (outside > 0.0){
      float rim = smoothstep(1.0, 1.18, r);
      float stream = fbm(normalize(uv) * 2.5 + vec2(u_time*0.08, -u_time*0.05));
      float streaks = smoothstep(0.55, 0.95, stream);
      corona = rim * (0.6 + 2.0*u_params.w) * (0.25 + 0.75*streaks);
    }
    vec3 coronaCol = mix(vec3(0.95,0.55,0.12), vec3(1.0,0.92,0.8), 0.7);
    vec3 finalCol = col + coronaCol * corona;

    gl_FragColor = vec4(finalCol, 1.0);
  }
`;

// ---------- Layer creation ----------
export function createSolarLayer(scene: THREE.Scene, w: number, h: number): SolarLayer {
  const geometry = new THREE.PlaneGeometry(2, 2);

  const uniforms = {
    u_time: { value: 0 },
    u_resolution: { value: new THREE.Vector2(w, h) },
    u_params: { value: new THREE.Vector4(0.22, 0.35, 0.35, 0.30) },
    u_rotation: { value: 0 },
    u_flareBoost: { value: 0 },
    u_flares: { value: Array.from({ length: MAX_FLARES }, () => new THREE.Vector4()) },
    u_waves: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },
    u_waveColor: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },
    u_color: { value: new THREE.Vector2(0.8, 0.0) }, // warm tilt, cool boost
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: fragmentShader(MAX_FLARES, MAX_WAVES),
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 0;
  scene.add(mesh);

  const flares: SolarParticleData[] = Array.from({ length: MAX_FLARES }, () => ({
    data: new THREE.Vector4(),
    velocity: new THREE.Vector4(),
    active: false,
  }));

  const waves: Wave[] = Array.from({ length: MAX_WAVES }, () => ({
    data: new THREE.Vector4(),     // x,y,radius,strength
    color: new THREE.Vector4(),    // r,g,b,width
    speed: 0,
    decay: 0,
    active: false,
  }));

  return {
    mesh,
    uniforms,
    flares,
    waves,
    state: {
      rotSpeed: 0.04,
      emaEnergy: 0,
      emaPitch: 60,
      emaPitchVar: 0,
      activeNotes: new Set<number>(),
      holds: new Map<number, HoldState>(),
      lastNoteTs: performance.now(),
    },
  };
}

// ---------- Helpers ----------
function hsvToRgb(h: number, s: number, v: number): THREE.Color {
  const c = new THREE.Color();
  c.setHSL(h, s, v); // close enough for bright tints
  return c;
}

function noteToDiskXY(note: number): { x: number; y: number } {
  const pc = note % 12;
  const oct = Math.floor(note / 12);
  const angle = (pc / 12) * Math.PI * 2.0;
  const lat = THREE.MathUtils.lerp(-0.7, 0.7, THREE.MathUtils.clamp((oct - 2) / 6, 0, 1));
  const r = Math.cos(lat);
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
}

function noteToColor(note: number): THREE.Color {
  // Warm wheel biased, expanding to cool hues at very high notes
  const n = THREE.MathUtils.clamp((note - 36) / (96 - 36), 0, 1); // C2..C7
  const hue = THREE.MathUtils.lerp(0.05, 0.62, Math.pow(n, 1.2)); // ~30°(orange) → ~220°(blue)
  const sat = THREE.MathUtils.lerp(0.9, 1.0, n);
  const val = 1.0;
  return hsvToRgb(hue, sat, val);
}

function spawnFlare(layer: SolarLayer, x: number, y: number, size: number, life: number) {
  const p = layer.flares.find(f => !f.active);
  if (!p) return;
  p.active = true;
  const v = new THREE.Vector2(x, y);
  if (v.length() > 0.98) v.setLength(0.98);
  p.data.set(v.x, v.y, size, 0.0);
  p.velocity.set((Math.random()-0.5)*0.08, (Math.random()-0.5)*0.08, life, 1.0/life);
}

function spawnWave(layer: SolarLayer, origin: THREE.Vector2, color: THREE.Color, strength: number, speed: number, width: number, decay: number) {
  const w = layer.waves.find(wv => !wv.active);
  if (!w) return;
  w.active = true;
  w.data.set(origin.x, origin.y, 0.02, strength); // start near source
  w.color.set(color.r, color.g, color.b, width);
  w.speed = speed;
  w.decay = decay;
}

// ---------- Public: NOTE events ----------
export function onSolarNoteOn(layer: SolarLayer, midiNote: number, velocity0to127: number): void {
  const vel = THREE.MathUtils.clamp(velocity0to127, 0, 127) / 127;
  const { x, y } = noteToDiskXY(midiNote);
  const origin = new THREE.Vector2(x, y);
  const tint = noteToColor(midiNote);

  // flare at impact site
  spawnFlare(layer, x, y, 0.08 + 0.22 * vel, 1.2 + 1.4 * vel);

  // immediate wave impulse
  spawnWave(layer, origin, tint, 0.45 + 0.45 * vel, 0.45 + 0.35 * vel, 0.02 + 0.05 * vel, 0.55 + 0.35 * vel);

  // register hold emitter
  layer.state.activeNotes.add(midiNote);
  layer.state.holds.set(midiNote, {
    startMs: performance.now(),
    lastSpawnMs: performance.now(),
    origin,
    color: tint,
  });

  // musical stats
  const now = performance.now();
  const dt = Math.max(1, now - layer.state.lastNoteTs);
  layer.state.lastNoteTs = now;
  const rateBoost = THREE.MathUtils.clamp(300 / dt, 0, 2);
  const instantEnergy = vel * (1 + rateBoost);
  layer.state.emaEnergy = THREE.MathUtils.lerp(layer.state.emaEnergy, instantEnergy, 0.35);

  const α = 0.25;
  const prevMean = layer.state.emaPitch;
  const newMean = prevMean + α * (midiNote - prevMean);
  const newVar  = (1 - α) * (layer.state.emaPitchVar + α * (midiNote - prevMean) * (midiNote - newMean));
  layer.state.emaPitch = newMean;
  layer.state.emaPitchVar = newVar;

  layer.uniforms.u_flareBoost.value = Math.min(1.0, layer.uniforms.u_flareBoost.value + vel * 0.7);
}

export function onSolarNoteOff(layer: SolarLayer, midiNote: number, velocity0to127?: number): void {
  // final burst proportional to hold time
  const hold = layer.state.holds.get(midiNote);
  if (hold) {
    const held = (performance.now() - hold.startMs) / 1000;
    const boost = THREE.MathUtils.clamp(held / 2.5, 0, 1);
    spawnWave(layer, hold.origin, hold.color, 0.5 + 0.8 * boost, 0.55 + 0.5 * boost, 0.03 + 0.06 * boost, 0.6 + 0.4 * boost);
    layer.state.holds.delete(midiNote);
  }
  layer.state.activeNotes.delete(midiNote);
}

// ---------- Update ----------
export function updateSolar(layer: SolarLayer, dtMs: number): void {
  const now = performance.now() / 1000;
  layer.uniforms.u_time.value = now;

  const dt = Math.min(dtMs / 1000, 0.05);

  // Emit waves repeatedly while notes are held (longer press => more waves)
  const repeatMs = 140; // base interval
  layer.state.holds.forEach((h, note) => {
    const elapsed = performance.now() - h.lastSpawnMs;
    const held = (performance.now() - h.startMs) / 1000;
    const factor = THREE.MathUtils.clamp(held / 3.0, 0, 1); // more/faster as you hold
    if (elapsed >= repeatMs * (1.0 - 0.6 * factor)) {
      h.lastSpawnMs = performance.now();
      const strength = 0.35 + 0.5 * factor;
      const speed    = 0.45 + 0.5 * factor;
      const width    = 0.025 + 0.06 * factor;
      const decay    = 0.55 + 0.4 * factor;
      spawnWave(layer, h.origin, h.color, strength, speed, width, decay);
    }
  });

  // Music→visual mapping (auto)
  const energy = layer.state.emaEnergy;
  const highness = THREE.MathUtils.clamp((layer.state.emaPitch - 48) / (84 - 48), 0, 1);
  const spreadN = THREE.MathUtils.clamp(Math.sqrt(Math.max(0, layer.state.emaPitchVar)) / 8, 0, 1);
  const poly = layer.state.activeNotes.size;

  // Rotation & parameters
  const dir = highness < 0.5 ? -1 : 1;
  layer.state.rotSpeed = dir * (0.02 + 0.20 * THREE.MathUtils.clamp(energy / 2, 0, 1) + 0.10 * spreadN);

  const brightness = THREE.MathUtils.clamp(0.18 + 0.6 * (energy / 2) + 0.12 * THREE.MathUtils.clamp(poly / 6, 0, 1), 0, 1);
  const noiseScale = THREE.MathUtils.clamp(0.22 + 0.70 * highness, 0, 1);
  const turbulence = THREE.MathUtils.clamp(0.22 + 0.65 * (0.6 * spreadN + 0.4 * THREE.MathUtils.clamp(energy / 2, 0, 1)), 0, 1);
  const corona     = THREE.MathUtils.clamp(0.18 + 0.70 * THREE.MathUtils.clamp(energy / 2, 0, 1) + 0.12 * THREE.MathUtils.clamp(poly / 6, 0, 1), 0, 1);

  // Global color steering: high + energetic → bluer tint; otherwise warmer
  const hueBias  = THREE.MathUtils.clamp(0.55 + 0.35 * (1.0 - highness), 0, 1); // warmer for lows
  const coolBoost= THREE.MathUtils.clamp(0.15 + 0.85 * (0.6*highness + 0.4*THREE.MathUtils.clamp(energy/2,0,1)), 0, 1);

  const P = layer.uniforms.u_params.value;
  P.set(brightness, noiseScale, turbulence, corona);
  layer.uniforms.u_color.value.set(hueBias, coolBoost);

  // advance rotation & decay flash
  layer.uniforms.u_rotation.value += layer.state.rotSpeed * dt;
  layer.uniforms.u_flareBoost.value = Math.max(0, layer.uniforms.u_flareBoost.value - dt * 0.35);

  // Flares
  for (let i = 0; i < MAX_FLARES; i++) {
    const f = layer.flares[i];
    if (!f.active) { layer.uniforms.u_flares.value[i].z = 0.0; continue; }
    f.velocity.x *= 0.985; f.velocity.y *= 0.985;
    f.data.x += f.velocity.x * dt;
    f.data.y += f.velocity.y * dt;
    const age = f.data.w + f.velocity.w * dt;
    f.data.w = age;
    if (age >= 1.0) { f.active = false; f.data.z = 0.0; }
    layer.uniforms.u_flares.value[i].copy(f.data);
  }

  // Waves propagate & fade (radius grows, width gently broadens, strength decays)
  for (let i = 0; i < MAX_WAVES; i++) {
    const w = layer.waves[i];
    if (!w.active) { layer.uniforms.u_waves.value[i].w = 0.0; continue; }
    w.data.z += w.speed * dt;                        // radius
    w.color.w = Math.min(0.12, w.color.w + 0.02*dt); // width bloom
    w.data.w *= Math.exp(-w.decay * dt);             // strength decay
    if (w.data.w < 0.02 || w.data.z > 2.0) { w.active = false; w.data.w = 0.0; }
    layer.uniforms.u_waves.value[i].copy(w.data);
    layer.uniforms.u_waveColor.value[i].copy(w.color);
  }
}

// ---------- Resize ----------
export function resizeSolar(layer: SolarLayer, w: number, h: number): void {
  layer.uniforms.u_resolution.value.set(w, h);
}
