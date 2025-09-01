import * as THREE from 'three';
import type { BubbleLayer, BubbleData } from '../types';

const MAX_BUBBLES = 100;

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
  uniform vec4 u_bubbles[${MAX_BUBBLES}]; // x, y, radius, hue

  // HSL to RGB conversion
  vec3 hsl(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
    return l + s * (rgb-0.5)*(1.0-abs(2.0*l-1.0));
  }

  // Gloabl background
  vec3 bg(vec2 uv) {
    float n = sin(uv.x * 2.0 + u_time * 0.1) * cos(uv.y * 5.0 - u_time * 0.1);
    vec3 grad_sample = texture2D(u_color_gradient, vec2(n * 0.5 + 0.5, 0.5)).rgb;
    return grad_sample * 0.2; // Dark background
  }

  void main() {
    vec2 uv = v_uv;
    vec3 finalColor = bg(uv);

    vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
    
    for (int i = 0; i < ${MAX_BUBBLES}; i++) {
      vec4 bubble = u_bubbles[i];
      if (bubble.z <= 0.0) continue;

      // Calculate distance in aspect-corrected space
      float d = distance(uv * aspect, bubble.xy * aspect);
      float radius = bubble.z;
      if (d > radius) continue;

      float sdf = (radius - d) / radius;

      // Refraction effect
      vec2 refractedUv = uv + normalize(uv - bubble.xy) * (sdf * -0.05);
      vec3 refractedBg = bg(refractedUv);

      // Rim light - sharper and more intense
      float rim = pow(sdf, 4.0);
      vec3 bubbleColor = hsl(bubble.w, 0.9, 0.75);
      vec3 rimColor = bubbleColor * 2.0;

      // Higher contrast mixing
      vec3 mixedColor = mix(refractedBg, bubbleColor, 0.1);
      mixedColor = mix(mixedColor, rimColor, rim * 0.9);
      
      // Sharper alpha fade at edges
      float alpha = smoothstep(0.0, 0.05, sdf) * (1.0 - smoothstep(0.95, 1.0, sdf));
      
      finalColor = mix(finalColor, mixedColor, alpha);
    }

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export function createBubblesLayer(scene: THREE.Scene, w: number, h: number): BubbleLayer {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uniforms = {
    u_time: { value: 0 },
    u_resolution: { value: new THREE.Vector2(w, h) },
    u_color_gradient: { value: null },
    u_bubbles: { value: Array.from({ length: MAX_BUBBLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  scene.add(mesh);

  const bubbles: BubbleData[] = Array.from({ length: MAX_BUBBLES }, () => ({
    data: new THREE.Vector4(),
    velocity: new THREE.Vector4(),
    age: 0,
    active: false,
  }));

  return { mesh, uniforms, bubbles };
}

export function onBubbleNoteOn(layer: BubbleLayer, vel: number, hue: number): void {
  let bubble = layer.bubbles.find(b => !b.active);
  if (!bubble) bubble = layer.bubbles[0]; // Overwrite oldest if full

  const life = 3.0 + Math.random() * 3.0;
  const initialRadius = 0.03 + (vel / 127) * 0.12;

  bubble.active = true;
  bubble.age = 0;
  // Use UV coordinates [0, 1]. Start from bottom.
  bubble.data.set(
    Math.random(), // x
    -0.1,          // y (start just below screen)
    0,             // radius (starts at 0)
    hue / 360      // hue
  );
  bubble.velocity.set(
    (Math.random() - 0.5) * 0.05, // vx
    0.1 + Math.random() * 0.08,   // vy
    initialRadius,                // initialRadius for scaling
    life                          // life
  );
}

export function onBubbleNoteOff(layer: BubbleLayer, vel: number, hue: number): void {
  // Can implement a ripple or burst effect here later
}

export function updateBubbles(layer: BubbleLayer, dt: number): void {
  const now = layer.uniforms.u_time.value;
  const deltaSeconds = Math.min(dt / 1000, 0.05);

  for (let i = 0; i < MAX_BUBBLES; i++) {
    const bubble = layer.bubbles[i];
    if (!bubble.active) {
        layer.uniforms.u_bubbles.value[i].set(0,0,0,0);
        continue;
    };

    // Update position
    bubble.data.x += bubble.velocity.x * deltaSeconds;
    bubble.data.y += bubble.velocity.y * deltaSeconds;

    // Add gentle horizontal sway
    bubble.data.x += Math.sin(now * 1.5 + bubble.data.y * 15.0) * 0.0003;
    
    // Update age and check for death
    bubble.age += deltaSeconds;
    const ageRatio = bubble.age / bubble.velocity.w;

    if (ageRatio > 1.0 || bubble.data.y > 1.1) {
      bubble.active = false;
      layer.uniforms.u_bubbles.value[i].set(0,0,0,0);
      continue;
    }
    
    // Pop-in and fade-out animation via radius
    const popInDuration = 0.1; // 10% of life
    const scale = ageRatio < popInDuration
      ? bubble.velocity.z * (ageRatio / popInDuration)
      : bubble.velocity.z * (1.0 - (ageRatio - popInDuration) / (1.0 - popInDuration));
    bubble.data.z = Math.max(0.0, scale);

    // Update the uniform array
    layer.uniforms.u_bubbles.value[i].set(bubble.data.x, bubble.data.y, bubble.data.z, bubble.data.w);
  }
}