import * as THREE from 'three';
import type { WaveLayer, Ripple } from '../types';

const vertexShader = `
  varying vec2 v_uv;
  void main() {
    v_uv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform sampler2D u_color_gradient;
  uniform vec4 u_ripples[32];
  uniform int u_ripple_count;

  // HSL to RGB conversion
  vec3 hsl(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
    return l + s * (rgb-0.5)*(1.0-abs(2.0*l-1.0));
  }

  // 2D Noise function
  float random (vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  float noise (vec2 st) {
      vec2 i = floor(st);
      vec2 f = fract(st);
      float a = random(i);
      float b = random(i + vec2(1.0, 0.0));
      float c = random(i + vec2(0.0, 1.0));
      float d = random(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
  }

  void main(){
    vec2 p = v_uv;
    float t = u_time * 0.1;

    // Aspect-correct coords
    vec2 st = p;
    st.x *= u_resolution.x / u_resolution.y;

    // Sum of ripples from MIDI notes
    float v = 0.0;
    for(int i = 0; i < 32; i++){
      if(i >= u_ripple_count) break;
      vec4 r = u_ripples[i];
      
      // Aspect-correct ripple center
      vec2 center = r.xy;
      center.x *= u_resolution.x / u_resolution.y;
      
      float d = distance(st, center);
      float age = u_time - r.w;
      
      // Sharper wave
      float wave = sin(40.0 * d - age * 3.0);
      float falloff = 1.0 / (1.0 + 50.0 * pow(d, 2.0));
      // Fade in ripple strength
      v += wave * falloff * r.z * smoothstep(0.0, 0.2, age);
    }
    
    // Add subtle procedural noise for constant water motion
    float surfaceNoise = noise(p * 5.0 + t * 0.5) * 0.03;
    v += surfaceNoise;
    
    // Animated base color using the gradient texture
    vec2 grad_uv = vec2(noise(p * 2.0 + t), 0.5);
    vec3 baseColor = texture2D(u_color_gradient, grad_uv).rgb * 0.5;
    vec3 waveColor = mix(baseColor, vec3(0.2, 0.5, 1.0), smoothstep(-0.05, 0.05, v));
    
    // More vibrant, colorful sheen, concentrated on peaks
    float sheen = pow(smoothstep(0.1, 0.15, v), 5.0);
    vec3 rainbow = hsl(u_time * 0.2 + v * 3.0, 1.0, 0.55);
    vec3 finalColor = waveColor + sheen * rainbow * 1.5;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export function createWavesLayer(scene: THREE.Scene, w: number, h: number): WaveLayer {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uniforms = {
    u_time: { value: 0 },
    u_resolution: { value: new THREE.Vector2(w, h) },
    u_color_gradient: { value: null },
    u_ripples: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
    u_ripple_count: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1; // Render first
  scene.add(mesh);
  
  const ripples: Ripple[] = [];
  return { mesh, uniforms, ripples };
}

function addWaveRipple(layer: WaveLayer, xNorm: number, vel: number) {
    if (layer.ripples.length >= 30) layer.ripples.shift();
    // Use simple UV coordinates
    layer.ripples.push({
      x: xNorm, // x in [0, 1]
      y: 0.5 + (Math.random() - 0.5) * 0.5,
      strength: (vel / 127) * 0.15,
      birth: performance.now() / 1000,
      hue: 0, // Add hue property
    });
}

export function onWaveNoteOn(layer: WaveLayer, xNorm: number, vel: number): void {
  addWaveRipple(layer, xNorm, vel);
}

export function onWaveNoteOff(layer: WaveLayer, xNorm: number, vel: number, heldMs: number): void {
  // Much stronger splash on release
  const strength = Math.min(127, vel + Math.min(100, heldMs / 15));
  addWaveRipple(layer, xNorm, strength * 1.5);
}

export function updateWaves(layer: WaveLayer, dt: number): void {
  const now = performance.now() / 1000;
  layer.uniforms.u_time.value = now;

  // Cull old ripples
  layer.ripples = layer.ripples.filter(r => now - r.birth < 8.0);
  
  const rippleUniforms = layer.uniforms.u_ripples.value;
  const numRipples = Math.min(layer.ripples.length, 32);
  layer.uniforms.u_ripple_count.value = numRipples;
  
  for (let i = 0; i < numRipples; i++) {
    const r = layer.ripples[i];
    rippleUniforms[i].set(r.x, r.y, r.strength, r.birth);
  }
}