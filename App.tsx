import React, { useState, useEffect, useRef } from 'react';
import { generateSpeech } from './services/geminiService';
import { AudioEngine } from './utils/audioEngine';
import { Play, Pause, Download, Wand2, Upload, Volume2, Mic, Music } from 'lucide-react';
import { SpeakerVoice } from './types';

// Initial state for the default prompt requested by user
const DEFAULT_PROMPT = "Good morning vets!";

const App: React.FC = () => {
  // Application State
  const [engine] = useState(() => new AudioEngine());
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [voiceBuffer, setVoiceBuffer] = useState<AudioBuffer | null>(null);
  const [musicBuffer, setMusicBuffer] = useState<AudioBuffer | null>(null);
  
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selectedVoice, setSelectedVoice] = useState<SpeakerVoice>('Puck');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [voiceStartTime, setVoiceStartTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Canvas Refs for Visualization
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();

  // --- Audio Handling ---

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setBackgroundFile(file);
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await engine.decodeAudio(arrayBuffer);
      setMusicBuffer(audioBuffer);
      
      // Update duration logic
      const newDuration = Math.max(audioBuffer.duration, (voiceBuffer?.duration || 0) + voiceStartTime);
      setDuration(newDuration);
      
      // Default voice to start at the end of music if music is loaded
      if (!voiceStartTime) {
        setVoiceStartTime(audioBuffer.duration);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to load audio file. Please try a valid MP3 or WAV.");
    }
  };

  const handleGenerateVoice = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);

    try {
      const audioData = await generateSpeech(prompt, selectedVoice);
      // Gemini returns raw PCM 16-bit at 24kHz. decodeAudioData fails on this because it lacks a header.
      // We use decodeRawPCM to handle it manually.
      const audioBuffer = await engine.decodeRawPCM(audioData, 24000);
      setVoiceBuffer(audioBuffer);

      // Recalculate duration and placement
      const musicDur = musicBuffer?.duration || 0;
      // Default: Place voice at the very end of the music track
      const startTime = musicDur > 0 ? musicDur : 0; 
      
      setVoiceStartTime(startTime);
      setDuration(Math.max(musicDur, startTime + audioBuffer.duration));
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate speech.");
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlayback = async () => {
    if (isPlaying) {
      engine.stop();
      setIsPlaying(false);
    } else {
      if (!musicBuffer && !voiceBuffer) return;
      
      // Prepare sources
      engine.schedulePlayback(
        musicBuffer, 
        voiceBuffer, 
        voiceStartTime, 
        currentTime
      );
      
      engine.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (isPlaying) {
      // Restart playback from new position
      engine.stop();
      engine.schedulePlayback(musicBuffer, voiceBuffer, voiceStartTime, time);
      engine.play();
    }
  };

  const handleVoicePositionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newStart = parseFloat(e.target.value);
    setVoiceStartTime(newStart);
    // Update total duration if voice pushes past current duration
    const vDur = voiceBuffer?.duration || 0;
    const mDur = musicBuffer?.duration || 0;
    setDuration(Math.max(mDur, newStart + vDur));
    
    if (isPlaying) {
        togglePlayback(); // Stop playback to avoid glitches
    }
  };

  const handleDownload = async () => {
    if (!musicBuffer && !voiceBuffer) return;
    setIsGenerating(true); // Re-use spinner
    try {
      const blob = await engine.renderToBlob(musicBuffer, voiceBuffer, voiceStartTime);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vets-morning-mix.wav';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError("Failed to render audio.");
    } finally {
      setIsGenerating(false);
    }
  };

  // --- Lifecycle & Effects ---

  // Visualization Loop
  useEffect(() => {
    const draw = () => {
      if (isPlaying) {
        // Sync React state with Engine time roughly
        const t = engine.getCurrentTime();
        if (t >= duration) {
           setIsPlaying(false);
           setCurrentTime(0);
           engine.stop();
        } else {
           setCurrentTime(t);
        }
      }

      // Draw simple visualizer
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const width = canvas.width;
          const height = canvas.height;
          ctx.clearRect(0, 0, width, height);

          // Draw Timeline Background
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 0, width, height);

          const scale = width / (duration || 1);

          // Draw Music Block
          if (musicBuffer) {
            ctx.fillStyle = '#3b82f6';
            ctx.fillRect(0, 10, musicBuffer.duration * scale, height / 2 - 15);
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fillText("Music Track", 5, 25);
          }

          // Draw Voice Block
          if (voiceBuffer) {
            const startX = voiceStartTime * scale;
            const w = voiceBuffer.duration * scale;
            ctx.fillStyle = '#ec4899';
            ctx.fillRect(startX, height / 2 + 5, w, height / 2 - 15);
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fillText("Voice", startX + 5, height / 2 + 20);
          }

          // Draw Playhead
          const playheadX = currentTime * scale;
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(playheadX, 0);
          ctx.lineTo(playheadX, height);
          ctx.stroke();
        }
      }
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, duration, currentTime, musicBuffer, voiceBuffer, voiceStartTime, engine]);


  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-brand-500 selection:text-white">
      <div className="max-w-4xl mx-auto px-4 py-8">
        
        {/* Header */}
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-brand-400 to-purple-500 mb-2">
            VetsMorning Studio
          </h1>
          <p className="text-slate-400">
            Mix your daily intro. Add AI speech to the end of any track.
          </p>
        </header>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg mb-6 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          
          {/* Card 1: Music Upload */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400">
                <Music size={24} />
              </div>
              <h2 className="text-lg font-semibold">1. Background Track</h2>
            </div>
            
            <div className="relative group">
              <input 
                type="file" 
                accept="audio/*" 
                onChange={handleFileUpload} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center transition-colors group-hover:border-brand-500 group-hover:bg-slate-700/50">
                {backgroundFile ? (
                  <div className="text-green-400 font-medium truncate">
                    {backgroundFile.name}
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-slate-400">
                    <Upload className="mb-2" size={24} />
                    <span>Click to upload Audio</span>
                    <span className="text-xs text-slate-500 mt-1">MP3, WAV supported</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card 2: Voice Gen */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-pink-500/20 rounded-lg text-pink-400">
                <Mic size={24} />
              </div>
              <h2 className="text-lg font-semibold">2. Generate Voice</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase text-slate-500 font-bold mb-1">Script</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none resize-none h-20"
                  placeholder="Enter text to speak..."
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                   <label className="block text-xs uppercase text-slate-500 font-bold mb-1">Voice</label>
                   <select 
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value as SpeakerVoice)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm outline-none focus:border-brand-500"
                   >
                     {['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'].map(v => (
                       <option key={v} value={v}>{v}</option>
                     ))}
                   </select>
                </div>
                <div className="flex items-end">
                  <button 
                    onClick={handleGenerateVoice}
                    disabled={isGenerating || !prompt}
                    className="bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
                  >
                    {isGenerating ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Wand2 size={16} />
                    )}
                    Generate
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mixer Section */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl mb-24">
           <div className="flex justify-between items-end mb-4">
             <div>
                <h2 className="text-lg font-semibold mb-1">Studio Mixer</h2>
                <p className="text-xs text-slate-400">Drag sliders to adjust timing</p>
             </div>
             <div className="text-right font-mono text-brand-400 text-xl">
               {formatTime(currentTime)} / {formatTime(duration)}
             </div>
           </div>

           {/* Canvas Visualization */}
           <div className="relative w-full h-32 bg-slate-900 rounded-lg overflow-hidden border border-slate-700 mb-6">
              <canvas 
                ref={canvasRef}
                width={800}
                height={128}
                className="w-full h-full"
              />
           </div>

           {/* Controls */}
           <div className="space-y-6">
              
              {/* Voice Positioning Slider */}
              {voiceBuffer && (
                <div className="flex items-center gap-4">
                   <span className="text-xs font-bold text-pink-400 uppercase w-20">Voice Start</span>
                   <input 
                      type="range"
                      min={0}
                      max={duration}
                      step={0.1}
                      value={voiceStartTime}
                      onChange={handleVoicePositionChange}
                      className="flex-1 accent-pink-500 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                   />
                   <span className="text-xs font-mono text-slate-400 w-12 text-right">
                     {voiceStartTime.toFixed(1)}s
                   </span>
                </div>
              )}

              {/* Main Scrubber */}
              <div className="flex items-center gap-4">
                 <span className="text-xs font-bold text-slate-500 uppercase w-20">Seek</span>
                 <input 
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeek}
                    className="flex-1 accent-white h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                 />
              </div>

              {/* Playback Buttons */}
              <div className="flex justify-center gap-4 pt-4 border-t border-slate-700/50">
                 <button 
                  onClick={togglePlayback}
                  disabled={!musicBuffer && !voiceBuffer}
                  className="w-16 h-16 rounded-full bg-brand-500 hover:bg-brand-400 text-white flex items-center justify-center shadow-lg shadow-brand-500/30 transition-all hover:scale-105 disabled:bg-slate-700 disabled:shadow-none disabled:text-slate-500"
                 >
                    {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="ml-1" />}
                 </button>
                 
                 <button 
                    onClick={handleDownload}
                    disabled={!musicBuffer && !voiceBuffer || isGenerating}
                    className="w-16 h-16 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50"
                    title="Download Mix"
                 >
                    <Download size={24} />
                 </button>
              </div>
           </div>
        </div>

      </div>
    </div>
  );
};

// Helper for formatting seconds to MM:SS
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default App;