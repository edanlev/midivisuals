import * as THREE from 'three';
import type { TreeLayer, TreeSeed } from '../types';
import { noteToX } from '../utils/helpers';

const MAX_SEEDS = 20;

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
  uniform vec4 u_seeds[${MAX_SEEDS}]; // x, y, birthTime, velocity
  uniform vec4 u_seed_colors[${MAX_SEEDS}]; // r, g, b, flash_intensity

  float random (in vec2 _st) {
    return fract(sin(dot(_st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  float noise (in vec2 _st) {
    vec2 i = floor(_st);
    vec2 f = fract(_st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
  }

  #define NUM_OCTAVES 5
  float fbm ( in vec2 _st) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    for (int i = 0; i < NUM_OCTAVES; ++i) {
        v += a * noise(_st);
        _st = _st * 2.0 + shift;
        a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 st = v_uv;
    st.x *= u_resolution.x / u_resolution.y;
    
    // Domain warping for a hypnotic, flowing background
    vec2 q = vec2(fbm(st + u_time * 0.05), fbm(st + vec2(1.0)));
    vec2 r = vec2(fbm(st + q * 2.0 + u_time * 0.1), fbm(st + q * 2.0 + vec2(5.0)));
    
    float pattern = pow(fbm(st + r), 2.0);
    
    // Sample the gradient for the background color
    vec2 grad_uv = vec2(pattern, 0.5);
    vec3 color = texture2D(u_color_gradient, grad_uv).rgb * pattern * 0.4;
    
    // Combine with seeds from MIDI notes
    for (int i = 0; i < ${MAX_SEEDS}; i++) {
        if (u_seeds[i].z == 0.0) continue;
        
        vec4 seed_data = u_seeds[i];
        vec4 seed_color_data = u_seed_colors[i];
        vec3 seed_color = seed_color_data.rgb;
        float flash_intensity = seed_color_data.a;
        
        vec2 seed_pos = seed_data.xy;
        seed_pos.x *= u_resolution.x / u_resolution.y;
        float dist = distance(st, seed_pos);

        float life = u_time - seed_data.z;
        float max_dist = life * seed_data.w * 0.5; // Grow out from seed

        // Vein Influence: Veins take on the note's color
        float vein_influence = smoothstep(max_dist, max_dist - 0.15, dist);
        color += pow(pattern, 6.0) * seed_color * 2.5 * vein_influence;

        // Flash Ring on Note On
        if (flash_intensity > 0.0) {
            float flash_radius = life * 0.8; // Flash expands faster
            float flash_thickness = 0.02;
            float flash_ring = smoothstep(flash_radius - flash_thickness, flash_radius, dist) - smoothstep(flash_radius, flash_radius + flash_thickness, dist);
            color += seed_color * flash_ring * 2.0 * flash_intensity;
        }
    }
    
    color = clamp(color, 0.0, 1.0);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createTreesLayer(scene: THREE.Scene, w: number, h: number): TreeLayer {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uniforms = {
    u_time: { value: 0 },
    u_resolution: { value: new THREE.Vector2(w, h) },
    u_color_gradient: { value: null },
    u_seeds: { value: Array.from({ length: MAX_SEEDS }, () => new THREE.Vector4()) },
    u_seed_colors: { value: Array.from({ length: MAX_SEEDS }, () => new THREE.Vector4()) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  scene.add(mesh);

  const seeds: TreeSeed[] = Array.from({ length: MAX_SEEDS }, () => ({
    data: new THREE.Vector4(),
    colorData: new THREE.Vector4(),
    active: false,
  }));

  return { mesh, uniforms, seeds };
}

export function onTreeNoteOn(layer: TreeLayer, note: number, vel: number, color: THREE.Color): void {
  let seed = layer.seeds.find(s => !s.active);
  if (!seed) seed = layer.seeds[0]; // Overwrite oldest

  seed.active = true;
  seed.data.set(
    noteToX(note),
    Math.random(),
    layer.uniforms.u_time.value,
    0.1 + (vel / 127) * 0.3
  );
  seed.colorData.set(
    color.r,
    color.g,
    color.b,
    1.0 // Initial flash intensity
  );
}

export function onTreeNoteOff(layer: TreeLayer, note: number, vel: number, heldMs: number): void {
  // Can add a pulse or fade effect here in the future
}

export function updateTrees(layer: TreeLayer, dt: number): void {
    const now = performance.now() / 1000;
    layer.uniforms.u_time.value = now;
    const deltaSeconds = Math.min(dt / 1000, 0.05);
    
    for (let i = 0; i < MAX_SEEDS; i++) {
        const seed = layer.seeds[i];
        if (seed.active) {
            // Decay flash intensity (lasts ~0.5s)
            seed.colorData.w = Math.max(0.0, seed.colorData.w - deltaSeconds * 2.0);

            // Fade out seeds after a while
            if (now - seed.data.z > 20.0) { // Live for 20 seconds
                seed.active = false;
                seed.data.set(0,0,0,0);
                seed.colorData.set(0,0,0,0);
            }
            layer.uniforms.u_seeds.value[i].copy(seed.data);
            layer.uniforms.u_seed_colors.value[i].copy(seed.colorData);
        } else {
            layer.uniforms.u_seeds.value[i].set(0,0,0,0);
            layer.uniforms.u_seed_colors.value[i].set(0,0,0,0);
        }
    }
}