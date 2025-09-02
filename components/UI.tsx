import React from 'react';
import type { VisualizerMode } from '../types';

interface UIProps {
  mode: VisualizerMode;
  setMode: (mode: VisualizerMode) => void;
  initMidi: () => void;
  connectInput: (id: string) => void;
  midiInputs: MIDIInput[];
  midiOutputs: MIDIOutput[];
  selectedInputId: string;
  selectedOutputId: string;
  setSelectedOutputId: (id: string) => void;
  forwardToDAW: boolean;
  setForwardToDAW: (value: boolean) => void;
}

const UIButton: React.FC<{
  onClick: () => void;
  isActive: boolean;
  children: React.ReactNode;
}> = ({ onClick, isActive, children }) => {
  const baseClasses = "py-2 px-4 rounded-lg border-none cursor-pointer font-semibold text-sm transition-all shadow-md";
  const activeClasses = "bg-gradient-to-r from-purple-600 to-pink-500 text-white";
  const inactiveClasses = "bg-black/20 text-gray-300 hover:bg-black/40 hover:text-white";

  return (
    <button onClick={onClick} className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses}`}>
      {children}
    </button>
  );
};

export const UI: React.FC<UIProps> = ({
  mode,
  setMode,
  initMidi,
  connectInput,
  midiInputs,
  midiOutputs,
  selectedInputId,
  selectedOutputId,
  setSelectedOutputId,
  forwardToDAW,
  setForwardToDAW,
}) => {
  return (
    <>
      {/* Top Left Controls */}
      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2 items-center">
        <UIButton onClick={() => setMode('bubbles')} isActive={mode === 'bubbles'}>Bubbles</UIButton>
        <UIButton onClick={() => setMode('waves')} isActive={mode === 'waves'}>Waves</UIButton>
        <UIButton onClick={() => setMode('plasma')} isActive={mode === 'plasma'}>Plasma</UIButton>
        <UIButton onClick={() => setMode('trees')} isActive={mode === 'trees'}>Trees</UIButton>
        <UIButton onClick={() => setMode('water')} isActive={mode === 'water'}>Water</UIButton>
      </div>

      {/* Top Right Controls */}
      <div className="absolute right-4 top-4 z-10 min-w-[260px] bg-black/40 backdrop-blur-sm p-4 rounded-lg flex flex-col gap-3 border border-white/10 shadow-xl">
        <UIButton onClick={initMidi} isActive={false}>{midiInputs.length > 0 ? "Rescan MIDI Devices" : "Connect MIDI"}</UIButton>
        <div>
          <label className="text-gray-300 text-xs mb-1 block font-medium">MIDI Input</label>
          <select 
            value={selectedInputId} 
            onChange={(e) => connectInput(e.target.value)} 
            className="w-full bg-gray-800 border border-gray-600 text-gray-200 text-sm rounded-md p-2 focus:ring-purple-500 focus:border-purple-500"
            disabled={midiInputs.length === 0}
          >
            <option value="">All Inputs</option>
            {midiInputs.map((input) => (
              <option key={input.id} value={input.id}>{input.name || input.manufacturer || `Input ${input.id}`}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-gray-300 text-xs mb-1 block font-medium">MIDI Output (for DAW Forwarding)</label>
          <select 
            value={selectedOutputId} 
            onChange={(e) => setSelectedOutputId(e.target.value)} 
            className="w-full bg-gray-800 border border-gray-600 text-gray-200 text-sm rounded-md p-2 focus:ring-purple-500 focus:border-purple-500"
            disabled={midiOutputs.length === 0}
          >
            <option value="">None</option>
            {midiOutputs.map((output) => (
              <option key={output.id} value={output.id}>{output.name || output.manufacturer || `Output ${output.id}`}</option>
            ))}
          </select>
        </div>
        <label className="text-gray-300 text-sm flex items-center gap-2 cursor-pointer select-none">
          <input 
            type="checkbox" 
            checked={forwardToDAW} 
            onChange={(e) => setForwardToDAW(e.target.checked)}
            className="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
          />
          Forward to DAW
        </label>
      </div>

      {/* Bottom Info Text */}
      <div className="absolute left-4 bottom-4 z-10 text-gray-400 text-xs bg-black/30 p-2 rounded">
        Hold notes to sustain visuals. Release to trigger flourishes.
      </div>
    </>
  );
};
