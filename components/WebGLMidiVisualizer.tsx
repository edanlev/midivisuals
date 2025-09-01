import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { useMidi } from "../hooks/useMidi";
import { UI } from "./UI";
import { noteToHue, noteToX } from "../utils/helpers";
import type { VisualizerMode, BubbleLayer, WaveLayer, PlasmaLayer, TreeLayer, NoteInfo, SolarLayer } from "../types";
import { createBubblesLayer, updateBubbles, onBubbleNoteOn, onBubbleNoteOff } from "../visualizers/bubbles";
import { createWavesLayer, updateWaves, onWaveNoteOn, onWaveNoteOff } from "../visualizers/waves";
import { createPlasmaLayer, updatePlasma, onPlasmaNoteOn, onPlasmaNoteOff } from "../visualizers/plasma";
import { createTreesLayer, updateTrees, onTreeNoteOn, onTreeNoteOff } from "../visualizers/trees";
import { createSolarLayer, updateSolar, onSolarNoteOn, onSolarNoteOff } from "../visualizers/SolarLayer_WavesAutoNotes";
import { createWaterLayer, updateWater, onWaterNoteOn, onWaterNoteOff } from "../visualizers/water";

const GRADIENT_WIDTH = 16;

export function WebGLMidiVisualizer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const animationFrameId = useRef<number>(0);

  const [mode, setMode] = useState<VisualizerMode>("waves");

  const bubblesLayer = useRef<BubbleLayer | null>(null);
  const wavesLayer = useRef<WaveLayer | null>(null);
  const plasmaLayer = useRef<PlasmaLayer | null>(null);
  const treesLayer = useRef<TreeLayer | null>(null);
  const solarLayer = useRef<SolarLayer | null>(null);
  const waterLayer = useRef<WaveLayer | null>(null);
  
  const gradientTexture = useRef<THREE.DataTexture | null>(null);
  const activeNoteColors = useRef<{ [key: number]: NoteInfo }>({});

  const onNoteOn = useCallback((note: number, velocity: number, color: THREE.Color) => {
    const x = noteToX(note, 127);
    const hue = noteToHue(note);
    activeNoteColors.current[note] = { onTime: performance.now(), velocity, sustain: true, color };

    switch (mode) {
      case "bubbles": bubblesLayer.current && onBubbleNoteOn(bubblesLayer.current, velocity, hue); break;
      case "waves": wavesLayer.current && onWaveNoteOn(wavesLayer.current, x, velocity); break;
      case "plasma": plasmaLayer.current && onPlasmaNoteOn(plasmaLayer.current, x, velocity); break;
      case "trees": treesLayer.current && onTreeNoteOn(treesLayer.current, note, velocity, color); break;
      case "solar": solarLayer.current && onSolarNoteOn(solarLayer.current, note, velocity); break;
      case "water": waterLayer.current && onWaterNoteOn(waterLayer.current, x, velocity, hue); break;
    }
  }, [mode]);

  const onNoteOff = useCallback((note: number, velocity: number, heldMs: number, color: THREE.Color) => {
    const x = noteToX(note, 127);
    const hue = noteToHue(note);
    
    delete activeNoteColors.current[note];

    switch (mode) {
      case "bubbles": bubblesLayer.current && onBubbleNoteOff(bubblesLayer.current, velocity, hue); break;
      case "waves": wavesLayer.current && onWaveNoteOff(wavesLayer.current, x, velocity, heldMs); break;
      case "plasma": plasmaLayer.current && onPlasmaNoteOff(plasmaLayer.current, x, velocity, heldMs); break;
      case "trees": treesLayer.current && onTreeNoteOff(treesLayer.current, note, velocity, heldMs); break;
      case "solar": solarLayer.current && onSolarNoteOff(solarLayer.current, note); break;
      case "water": waterLayer.current && onWaterNoteOff(waterLayer.current, x, velocity, heldMs); break;
    }
  }, [mode]);

  const midi = useMidi({ onNoteOn, onNoteOff });

  // Auto-connect MIDI on mount
  React.useEffect(() => {
    midi.initMidi();
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Ensure canvas fills the container
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.left = '0';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);
  rendererRef.current = renderer;

    const scene = new THREE.Scene();
    // No static background, shaders will draw it
    scene.background = null;
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1000);
    camera.position.set(0, 0, 2.2);
    cameraRef.current = camera;
    
    // Gradient Texture for dynamic colors
    const gradientData = new Uint8Array(GRADIENT_WIDTH * 4);
    const texture = new THREE.DataTexture(gradientData, GRADIENT_WIDTH, 1, THREE.RGBAFormat);
    gradientTexture.current = texture;

    // Post-processing for Bloom effect
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.4, 0.8);
    
    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composerRef.current = composer;

    // Create all layers and assign the gradient texture
    bubblesLayer.current = createBubblesLayer(scene, w, h);
    bubblesLayer.current.uniforms.u_color_gradient.value = gradientTexture.current;
    
    wavesLayer.current = createWavesLayer(scene, w, h);
    wavesLayer.current.uniforms.u_color_gradient.value = gradientTexture.current;

    plasmaLayer.current = createPlasmaLayer(scene, w, h);
    plasmaLayer.current.uniforms.u_color_gradient.value = gradientTexture.current;

    treesLayer.current = createTreesLayer(scene, w, h);
    treesLayer.current.uniforms.u_color_gradient.value = gradientTexture.current;

    solarLayer.current = createSolarLayer(scene, w, h);

    waterLayer.current = createWaterLayer(scene, w, h);
    waterLayer.current.uniforms.u_color_gradient.value = gradientTexture.current;

    let lastTime = performance.now();
    const animate = (time: number) => {
      const dt = time - lastTime;
      lastTime = time;
      
      // --- Update Color Gradient ---
      const now = performance.now();
      const activeNotes = Object.values(activeNoteColors.current);
      const displayColors: THREE.Color[] = [];

      activeNotes.forEach(noteInfo => {
        // Type guard for NoteInfo
        if (
          noteInfo &&
          typeof noteInfo === 'object' &&
          'onTime' in noteInfo &&
          'color' in noteInfo &&
          typeof (noteInfo as any).onTime === 'number' &&
          (noteInfo as any).color instanceof THREE.Color
        ) {
          const ni = noteInfo as import('../types').NoteInfo;
          const holdDurationSeconds = (now - ni.onTime) / 1000;
          const hueShift = (holdDurationSeconds * 0.02) % 1.0;
          const displayColor = new THREE.Color();
          const hsl = { h: 0, s: 0, l: 0 };
          ni.color.getHSL(hsl);
          hsl.h = (hsl.h + hueShift) % 1.0;
          displayColor.setHSL(hsl.h, hsl.s, hsl.l);
          displayColors.push(displayColor);
        }
      });

      if (gradientTexture.current) {
        const data = gradientTexture.current.image.data;
        const width = gradientTexture.current.image.width;

        if (displayColors.length === 0) {
            for (let i = 0; i < width; i++) {
                data[i * 4] = 7; data[i * 4 + 1] = 7; data[i * 4 + 2] = 18; data[i * 4 + 3] = 255;
            }
        } else {
            displayColors.sort((a, b) => {
                const hslA = { h: 0, s: 0, l: 0 }, hslB = { h: 0, s: 0, l: 0 };
                a.getHSL(hslA); b.getHSL(hslB);
                return hslA.h - hslB.h;
            });
            for (let i = 0; i < width; i++) {
                const t = i / (width - 1);
                const color = new THREE.Color();
                if (displayColors.length === 1) {
                    color.copy(displayColors[0]);
                } else {
                    const colorT = t * (displayColors.length - 1);
                    const i1 = Math.floor(colorT);
                    const i2 = Math.min(i1 + 1, displayColors.length - 1);
                    const localT = colorT - i1;
                    color.copy(displayColors[i1]).lerp(displayColors[i2], localT);
                }
                data[i * 4] = Math.floor(color.r * 255);
                data[i * 4 + 1] = Math.floor(color.g * 255);
                data[i * 4 + 2] = Math.floor(color.b * 255);
                data[i * 4 + 3] = 255;
            }
        }
        gradientTexture.current.needsUpdate = true;
      }
      
      // Update uniforms and layer logic
      const timeSeconds = time / 1000;
      const allLayers = [bubblesLayer.current, wavesLayer.current, plasmaLayer.current, treesLayer.current, solarLayer.current, waterLayer.current];
      allLayers.forEach(layer => {
        if(layer?.mesh.visible) layer.uniforms.u_time.value = timeSeconds;
      });

      if (bubblesLayer.current?.mesh.visible) updateBubbles(bubblesLayer.current, dt);
      if (wavesLayer.current?.mesh.visible) updateWaves(wavesLayer.current, dt);
      if (plasmaLayer.current?.mesh.visible) updatePlasma(plasmaLayer.current, dt);
      if (treesLayer.current?.mesh.visible) updateTrees(treesLayer.current, dt);
      if (solarLayer.current?.mesh.visible) updateSolar(solarLayer.current, timeSeconds);
      if (waterLayer.current?.mesh.visible) updateWater(waterLayer.current, dt);
      
      composer.render();
      animationFrameId.current = requestAnimationFrame(animate);
    };
    animationFrameId.current = requestAnimationFrame(animate);

    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current || !composerRef.current) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight;
      cameraRef.current.aspect = newW / newH;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(newW, newH);
      composerRef.current.setSize(newW, newH);

      const allLayers = [bubblesLayer.current, wavesLayer.current, plasmaLayer.current, treesLayer.current, solarLayer.current, waterLayer.current];
      allLayers.forEach(layer => {
        if(layer) layer.uniforms.u_resolution.value.set(newW, newH);
      })
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId.current);
      window.removeEventListener("resize", handleResize);
      gradientTexture.current?.dispose();
      if(container && renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      scene.traverse(object => {
          if (object instanceof THREE.Mesh) {
              if (object.geometry) object.geometry.dispose();
              if (Array.isArray(object.material)) {
                  object.material.forEach(material => material.dispose());
              } else if (object.material) {
                  object.material.dispose();
              }
          }
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bubblesLayer.current) bubblesLayer.current.mesh.visible = mode === "bubbles";
    if (wavesLayer.current) wavesLayer.current.mesh.visible = mode === "waves";
    if (plasmaLayer.current) plasmaLayer.current.mesh.visible = mode === "plasma";
    if (treesLayer.current) treesLayer.current.mesh.visible = mode === "trees";
    if (solarLayer.current) solarLayer.current.mesh.visible = mode === "solar";
    if (waterLayer.current) waterLayer.current.mesh.visible = mode === "water";
  }, [mode]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-screen h-screen bg-[#070712]"
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', overflow: 'hidden', zIndex: 0 }}
    >
      <UI
        mode={mode}
        setMode={setMode}
        initMidi={midi.initMidi}
        connectInput={midi.connectInput}
        midiInputs={midi.midiInputs}
        midiOutputs={midi.midiOutputs}
        selectedInputId={midi.selectedInputId}
        selectedOutputId={midi.selectedOutputId}
        setSelectedOutputId={midi.setSelectedOutputId}
        forwardToDAW={midi.forwardToDAW}
        setForwardToDAW={midi.setForwardToDAW}
      />
    </div>
  );
}