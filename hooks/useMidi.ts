import { useState, useRef, useCallback } from 'react';
import * as THREE from 'three';
import type { NoteInfo } from '../types';
import { noteToHue } from '../utils/helpers';

interface UseMidiProps {
  onNoteOn: (note: number, velocity: number, color: THREE.Color) => void;
  onNoteOff: (note: number, velocity: number, heldDuration: number, color: THREE.Color) => void;
}

export function useMidi({ onNoteOn, onNoteOff }: UseMidiProps) {
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
  const [midiInputs, setMidiInputs] = useState<MIDIInput[]>([]);
  const [midiOutputs, setMidiOutputs] = useState<MIDIOutput[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>('');
  const [selectedOutputId, setSelectedOutputId] = useState<string>('');
  const [forwardToDAW, setForwardToDAW] = useState<boolean>(false);
  const notesRef = useRef<{ [key: number]: NoteInfo }>({});

  const onMIDIMessage = useCallback((event: MIDIMessageEvent) => {
    const [status, d1, d2] = event.data;
    const cmd = status & 0xf0;
    const note = d1;
    const velocity = d2;

    if (cmd === 0x90 && velocity > 0) { // Note On
      // More saturated, jewel-like colors
      const color = new THREE.Color().setHSL(noteToHue(note) / 360, 1.0, 0.6);
      notesRef.current[note] = { onTime: performance.now(), velocity, sustain: true, color };
      onNoteOn(note, velocity, color);
      if (forwardToDAW) {
        const out = midiAccess?.outputs.get(selectedOutputId);
        out?.send([0x90, note, velocity]);
      }
    } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) { // Note Off
      const info = notesRef.current[note];
      if (info) {
        info.sustain = false;
        const heldDuration = performance.now() - info.onTime;
        onNoteOff(note, velocity, heldDuration, info.color);
        delete notesRef.current[note];
      }
      if (forwardToDAW) {
        const out = midiAccess?.outputs.get(selectedOutputId);
        out?.send([0x80, note, velocity]);
      }
    }
  }, [onNoteOn, onNoteOff, forwardToDAW, selectedOutputId, midiAccess]);

  const connectInput = useCallback((id: string) => {
    if (!midiAccess) return;
    midiAccess.inputs.forEach(input => {
      if (input.id === id) {
        input.onmidimessage = onMIDIMessage;
      } else {
        input.onmidimessage = null; // Disconnect others
      }
    });
    // If id is empty, listen to all
    if (!id) {
        midiAccess.inputs.forEach(input => input.onmidimessage = onMIDIMessage);
    }
    setSelectedInputId(id);
  }, [midiAccess, onMIDIMessage]);

  const refreshDevices = useCallback(() => {
    if (midiAccess) {
        setMidiInputs(Array.from(midiAccess.inputs.values()));
        setMidiOutputs(Array.from(midiAccess.outputs.values()));
    }
  }, [midiAccess]);

  const initMidi = useCallback(async () => {
    if (navigator.requestMIDIAccess) {
      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        setMidiAccess(access);
        setMidiInputs(Array.from(access.inputs.values()));
        setMidiOutputs(Array.from(access.outputs.values()));
        access.onstatechange = refreshDevices;
        // connect to all inputs by default
        connectInput('');
      } catch (error) {
        console.error("Failed to get MIDI access.", error);
        alert("Web MIDI not supported or permission denied. Please use Chrome or Edge.");
      }
    } else {
      alert("Web MIDI API not supported in this browser.");
    }
  }, [refreshDevices, connectInput]);

  return {
    initMidi,
    connectInput,
    midiInputs,
    midiOutputs,
    selectedInputId,
    selectedOutputId,
    setSelectedOutputId,
    forwardToDAW,
    setForwardToDAW,
    activeNotes: notesRef.current
  };
}