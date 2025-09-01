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
uniform vec4 u_ripples[32]; // x, hue, strength, birth
uniform int u_ripple_count;

// HSL to RGB conversion
vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
    return c.z + c.y * (rgb-0.5)*(1.0-abs(2.0*c.z-1.0));
}

// 2D noise function for water texture
float noise(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

float fbm(vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
        value += amplitude * noise(st);
        st *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

void main() {
    vec2 st = v_uv;
    st.x *= u_resolution.x / u_resolution.y;

    // Animated, deep blue/purple background
    float slow_time = u_time * 0.05;
    vec3 base_color = hsl2rgb(vec3(0.65 + 0.1 * sin(slow_time), 0.7, 0.05));
    float noise_pattern = fbm(st * 2.0 + slow_time * 0.2);
    vec3 final_color = base_color + noise_pattern * 0.08;

    vec3 ripple_color_sum = vec3(0.0);
    float total_ripple_influence = 0.0;

    for (int i = 0; i < 32; i++) {
        if (i >= u_ripple_count) break;
        
        vec4 ripple = u_ripples[i];
        float ripple_x = ripple.x;
        float hue = ripple.y;
        float strength = ripple.z;
        float birth = ripple.w;
        
        vec2 ripple_center = vec2(ripple_x, 0.5);
        ripple_center.x *= u_resolution.x / u_resolution.y;
        
        float dist = distance(st, ripple_center);
        float time_since_birth = u_time - birth;
        
        if (time_since_birth > 0.0 && time_since_birth < 7.0) { // Ripples last for 7 seconds
            float wave_speed = 0.35;
            float wave_front = time_since_birth * wave_speed;
            float wave_width = 0.03 + strength * 0.1;
            
            // Smoother ring shape
            float ring = smoothstep(wave_front - wave_width, wave_front, dist) - smoothstep(wave_front, wave_front + wave_width, dist);
            
            if (ring > 0.0) {
                float decay = 1.0 - smoothstep(0.0, 7.0, time_since_birth);
                float influence = ring * strength * decay;
                
                // Soft sine wave for displacement, less chaotic
                float displacement = sin((dist - wave_front) * 60.0) * 0.5 + 0.5;
                influence *= displacement;

                vec3 ripple_color = hsl2rgb(vec3(hue, 0.9, 0.55));
                
                ripple_color_sum += ripple_color * influence;
                total_ripple_influence += influence;
            }
        }
    }

    if (total_ripple_influence > 0.0) {
        vec3 mixed_ripple_color = ripple_color_sum / total_ripple_influence;
        // Mix based on the strength of the ripple influence
        final_color = mix(final_color, mixed_ripple_color, clamp(total_ripple_influence * 1.5, 0.0, 1.0));
    }

    gl_FragColor = vec4(final_color, 1.0);
}
`;

export function createWaterLayer(scene: THREE.Scene, w: number, h: number): WaveLayer {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const uniforms = {
        u_time: { value: 0 },
        u_resolution: { value: new THREE.Vector2(w, h) },
        u_ripples: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) },
        u_ripple_count: { value: 0 },
        u_color_gradient: { value: null }, // Not used by new shader, but kept for compatibility
    };
    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1;
    scene.add(mesh);
    const ripples: Ripple[] = [];
    return { mesh, uniforms, ripples };
}

function addWaterRipple(layer: WaveLayer, xNorm: number, vel: number, hue: number) {
    if (layer.ripples.length >= 30) {
        // Find the oldest ripple and replace it
        let oldest_ripple_index = 0;
        for(let i = 1; i < layer.ripples.length; i++) {
            if(layer.ripples[i].birth < layer.ripples[oldest_ripple_index].birth) {
                oldest_ripple_index = i;
            }
        }
        layer.ripples.splice(oldest_ripple_index, 1);
    }
    layer.ripples.push({
        x: xNorm,
        y: 0.5, // y is not used for position
        strength: (vel / 127) * 0.5 + 0.1, // Normalized strength
        birth: performance.now() / 1000,
        hue: hue
    });
}

export function onWaterNoteOn(layer: WaveLayer, xNorm: number, vel: number, hue: number): void {
    addWaterRipple(layer, xNorm, vel, hue);
}

export function onWaterNoteOff(layer: WaveLayer, xNorm: number, vel: number, heldMs: number): void {
    // A slightly stronger ripple on release
    const strength = Math.min(127, vel + Math.min(80, heldMs / 20));
    const hue = (Math.random() * 360) / 360; // Use a random hue for note-off for variety
    addWaterRipple(layer, xNorm, strength * 1.2, hue);
}

export function updateWater(layer: WaveLayer, dt: number): void {
    const now = performance.now() / 1000;
    layer.uniforms.u_time.value = now;

    // Cull old ripples
    layer.ripples = layer.ripples.filter(r => now - r.birth < 7.0);

    const rippleUniforms = layer.uniforms.u_ripples.value;
    const numRipples = Math.min(layer.ripples.length, 32);
    layer.uniforms.u_ripple_count.value = numRipples;

    for (let i = 0; i < numRipples; i++) {
        const r = layer.ripples[i];
        rippleUniforms[i].set(r.x, r.hue, r.strength, r.birth);
    }
}
