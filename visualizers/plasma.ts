import * as THREE from 'three';
import type { PlasmaLayer, PlasmaParticleData } from '../types';

const MAX_PARTICLES = 100;

const vertexShader = `
  varying vec2 v_uv;
  void main() {
    v_uv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform sampler2D u_color_gradient;
  uniform vec4 u_particles[${MAX_PARTICLES}]; // x, y, size, ageRatio

  float random (in vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  float noise (in vec2 st) {
      vec2 i = floor(st);
      vec2 f = fract(st);
      float a = random(i);
      float b = random(i + vec2(1.0, 0.0));
      float c = random(i + vec2(0.0, 1.0));
      float d = random(i + vec2(1.0, 1.0));
      vec2 u = f*f*(3.0-2.0*f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
  }

  float fbm (in vec2 st) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; ++i) {
          v += a * noise(st);
          st = st * 2.0;
          a *= 0.5;
      }
      return v;
  }

  // A more vibrant, high-contrast color ramp for the plasma
  vec3 plasmaColor(float temp, vec3 cool_color) {
    vec3 hot_color = vec3(1.0, 1.0, 0.9); // Brilliant white-yellow
    vec3 mid_color = vec3(1.0, 0.5, 0.0); // Fiery orange

    // Layer colors with smooth transitions for a glowing effect
    vec3 color = mix(cool_color, mid_color, smoothstep(0.1, 0.6, temp));
    color = mix(color, hot_color, smoothstep(0.6, 0.9, temp));
    return color;
  }

  void main() {
    vec2 q = v_uv;
    q.x *= u_resolution.x / u_resolution.y;

    // Animated turbulent background for plasma flow
    vec2 motion = vec2(fbm(q + u_time * 0.1), fbm(q * 1.5 + u_time * 0.1 + 5.0));
    float baseNoise = fbm(q + motion);

    // Add hotspots from MIDI notes
    float heat = 0.0;
    for (int i = 0; i < ${MAX_PARTICLES}; i++) {
        if (u_particles[i].z == 0.0) continue; // size is 0
        
        vec2 pos = u_particles[i].xy;
        pos.x *= u_resolution.x / u_resolution.y;
        float radius = u_particles[i].z;
        float ageRatio = u_particles[i].w;

        // Distort particle shape with noise for a wispy, organic look
        float dist = distance(q, pos);
        float distortion = noise(q * 15.0 + u_time * 2.0) * 0.5 + 0.5;
        float intensity = 1.0 - smoothstep(0.0, radius * distortion, dist);
        
        // Fade out heat with age, more sharply at the end
        intensity *= (1.0 - pow(ageRatio, 3.0));
        heat += intensity;
    }
    
    // Combine base noise and particle heat
    float total_temp = baseNoise * 0.4 + heat * 1.2;
    
    vec3 grad_sample = texture2D(u_color_gradient, vec2(total_temp, 0.5)).rgb;
    vec3 cool = grad_sample * 0.15; // Darker cool tone for more contrast
    vec3 color = plasmaColor(total_temp, cool);

    // Add high-frequency sparkles in the hottest areas for energy
    float sparkle_mask = smoothstep(0.8, 0.9, total_temp);
    float sparkles = random(q * u_resolution.x + u_time * 10.0) * sparkle_mask;

    gl_FragColor = vec4(color + sparkles * 0.5, 1.0);
  }
`;

export function createPlasmaLayer(scene: THREE.Scene, w: number, h: number): PlasmaLayer {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uniforms = {
    u_time: { value: 0 },
    u_resolution: { value: new THREE.Vector2(w, h) },
    u_color_gradient: { value: null },
    u_particles: { value: Array.from({ length: MAX_PARTICLES }, () => new THREE.Vector4()) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  scene.add(mesh);

  const particles: PlasmaParticleData[] = Array.from({ length: MAX_PARTICLES }, () => ({
    data: new THREE.Vector4(),
    velocity: new THREE.Vector4(), // Using all 4 components: vx, vy, life, 1/life
    active: false,
  }));

  return { mesh, uniforms, particles };
}

// Spawns a rising plume of plasma
function addHotspot(layer: PlasmaLayer, xNorm: number, vel: number): void {
    let p = layer.particles.find(p => !p.active);
    if (!p) return; // Don't overwrite if full, let sparks have priority
    p.active = true;
    
    const life = 2.5 + Math.random() * 3.0;
    const size = 0.1 + (vel / 127) * 0.1;
    
    p.data.set(xNorm, 0.1, size, 0.0); // Start near bottom
    p.velocity.set(
        (Math.random() - 0.5) * 0.05,  // vx
        0.1 + Math.random() * 0.1,    // vy (initial upward push)
        life,                         // w: total lifespan
        1.0 / life                    // z: for calculating age ratio
    );
}

// Spawns a short-lived, explosive spark for note-off events
function addSpark(layer: PlasmaLayer, xNorm: number, vel: number): void {
    let p = layer.particles.find(p => !p.active);
    if (!p) return;
    p.active = true;

    const life = 0.6 + Math.random() * 0.8;
    const size = 0.05 + (vel / 127) * 0.08;
    const speed = 0.2 + (vel / 127) * 0.3 + Math.random() * 0.1;
    const angle = Math.random() * Math.PI * 2;

    p.data.set(xNorm, 0.5, size, 0.0); // Start mid-screen
    p.velocity.set(
        Math.cos(angle) * speed,       // vx (radial burst)
        Math.sin(angle) * speed,       // vy (radial burst)
        life,
        1.0 / life
    );
}

export function onPlasmaNoteOn(layer: PlasmaLayer, xNorm: number, vel: number): void {
  const count = 1 + Math.floor((vel / 127) * 2);
  for (let i = 0; i < count; i++) {
    addHotspot(layer, xNorm, vel);
  }
}

export function onPlasmaNoteOff(layer: PlasmaLayer, xNorm: number, vel: number, heldMs: number): void {
  const flareVel = Math.min(127, vel + heldMs / 25);
  const count = 3 + Math.floor((flareVel / 127) * 10);
  for (let i = 0; i < count; i++) {
    addSpark(layer, xNorm, flareVel);
  }
}

export function updatePlasma(layer: PlasmaLayer, dt: number): void {
    const now = performance.now() / 1000;
    layer.uniforms.u_time.value = now;
    const deltaSeconds = Math.min(dt / 1000, 0.05);

    for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = layer.particles[i];
        if (!p.active) {
            layer.uniforms.u_particles.value[i].z = 0.0; // Set size to 0
            continue;
        };
        
        // -- More Dynamic Physics --
        // Apply weak gravity
        p.velocity.y -= 0.25 * deltaSeconds;
        // Add random wobble/turbulence
        p.velocity.x += (Math.random() - 0.5) * 0.2 * deltaSeconds;
        // Air resistance/damping
        p.velocity.multiplyScalar(0.98);

        p.data.x += p.velocity.x * deltaSeconds;
        p.data.y += p.velocity.y * deltaSeconds;
        
        // Update age and check for death
        const ageRatio = p.data.w + deltaSeconds * p.velocity.z; // p.velocity.z is 1/life
        p.data.w = ageRatio;

        if (ageRatio > 1.0) {
            p.active = false;
            p.data.z = 0;
        }

        layer.uniforms.u_particles.value[i].copy(p.data);
    }
}