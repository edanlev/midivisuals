import type * as THREE from 'three';

export type VisualizerMode = 'bubbles' | 'waves' | 'plasma' | 'trees' | 'water';

export interface NoteInfo {
  onTime: number;
  velocity: number;
  sustain: boolean;
  color: THREE.Color;
}

// Base type for a shader-driven visualizer layer
export interface ShaderLayer {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  uniforms: {
    u_time: { value: number };
    u_resolution: { value: THREE.Vector2 };
    u_color_gradient: { value: THREE.Texture | null };
    [key: string]: any;
  };
}

// --- Bubbles Types ---
export interface BubbleData {
  // x, y, radius, hue
  data: THREE.Vector4;
  // vx, vy, initialRadius, life
  velocity: THREE.Vector4;
  age: number;
  active: boolean;
}
export interface BubbleLayer extends ShaderLayer {
  bubbles: BubbleData[];
  uniforms: ShaderLayer['uniforms'] & {
    u_bubbles: { value: THREE.Vector4[] };
  };
}

// --- Waves Types ---
export interface Ripple {
  x: number;
  y: number;
  strength: number;
  birth: number;
  hue?: number; // optional hue for water/waves variants
}

export interface WaveLayer extends ShaderLayer {
  ripples: Ripple[];
  uniforms: ShaderLayer['uniforms'] & {
    u_ripples: { value: THREE.Vector4[] };
    u_ripple_count: { value: number };
  };
}

// --- Plasma Types ---
export interface PlasmaParticleData {
  // x, y, size, ageRatio
  data: THREE.Vector4;
  // vx, vy, 0, life
  velocity: THREE.Vector4;
  active: boolean;
}
export interface PlasmaLayer extends ShaderLayer {
  particles: PlasmaParticleData[];
  uniforms: ShaderLayer['uniforms'] & {
    u_particles: { value: THREE.Vector4[] };
  };
}

// --- Trees Types ---
export interface TreeSeed {
  // x, y, birthTime, velocity
  data: THREE.Vector4;
  // r, g, b, flashIntensity
  colorData: THREE.Vector4;
  active: boolean;
}
export interface TreeLayer extends ShaderLayer {
  seeds: TreeSeed[];
  uniforms: ShaderLayer['uniforms'] & {
    u_seeds: { value: THREE.Vector4[] };
    u_seed_colors: { value: THREE.Vector4[] };
  };
}

// (solar visual removed)