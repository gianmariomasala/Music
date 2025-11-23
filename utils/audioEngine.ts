export class AudioEngine {
  private ctx: AudioContext;
  private musicSource: AudioBufferSourceNode | null = null;
  private voiceSource: AudioBufferSourceNode | null = null;
  private masterGain: GainNode;
  
  // Track start time for pause/resume logic
  private startTime: number = 0;
  private pausedAt: number = 0;

  constructor() {
    // Initialize standard AudioContext
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  }

  get context() {
    return this.ctx;
  }

  async decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    // Copy the buffer because decodeAudioData detaches it
    const bufferCopy = arrayBuffer.slice(0);
    return await this.ctx.decodeAudioData(bufferCopy);
  }

  /**
   * Decodes raw PCM data (Int16) into an AudioBuffer.
   * Gemini API returns raw PCM 16-bit 24kHz mono audio.
   */
  async decodeRawPCM(arrayBuffer: ArrayBuffer, sampleRate: number = 24000, numChannels: number = 1): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(arrayBuffer);
    const frameCount = dataInt16.length / numChannels;
    const buffer = this.ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) {
        // Convert Int16 to Float32 [-1.0, 1.0]
        channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
      }
    }
    return buffer;
  }

  // Schedule playback starting at 'offset' (where the playhead is)
  schedulePlayback(
    musicBuffer: AudioBuffer | null, 
    voiceBuffer: AudioBuffer | null, 
    voiceStartTime: number,
    offset: number
  ) {
    this.stop(); // Clear previous sources

    const now = this.ctx.currentTime;
    this.startTime = now - offset; // Anchor point

    // Schedule Music
    if (musicBuffer) {
      if (offset < musicBuffer.duration) {
        this.musicSource = this.ctx.createBufferSource();
        this.musicSource.buffer = musicBuffer;
        this.musicSource.connect(this.masterGain);
        
        // start(when, offset, duration)
        // If offset is positive, we start immediately playing from that offset
        this.musicSource.start(now, offset);
      }
    }

    // Schedule Voice
    if (voiceBuffer) {
      const voiceEnd = voiceStartTime + voiceBuffer.duration;
      
      // Check if the playhead (offset) is before the voice ends
      if (offset < voiceEnd) {
        this.voiceSource = this.ctx.createBufferSource();
        this.voiceSource.buffer = voiceBuffer;
        this.voiceSource.connect(this.masterGain);

        if (offset <= voiceStartTime) {
          // Playhead is before voice starts. Schedule voice to start in future.
          // Wait time = voiceStartTime - offset
          this.voiceSource.start(now + (voiceStartTime - offset), 0);
        } else {
          // Playhead is inside the voice clip. Start immediately from relative position.
          const relativeOffset = offset - voiceStartTime;
          this.voiceSource.start(now, relativeOffset);
        }
      }
    }
  }

  play() {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  stop() {
    if (this.musicSource) {
      try { this.musicSource.stop(); } catch(e) {}
      this.musicSource.disconnect();
      this.musicSource = null;
    }
    if (this.voiceSource) {
      try { this.voiceSource.stop(); } catch(e) {}
      this.voiceSource.disconnect();
      this.voiceSource = null;
    }
  }

  getCurrentTime(): number {
    // Basic approximation of playhead time based on ctx.currentTime
    // In a production app we'd need tighter state sync, but this works for simple visualization
    return this.ctx.currentTime - this.startTime;
  }

  /**
   * Renders the mix to a WAV Blob for download using OfflineAudioContext
   */
  async renderToBlob(
    musicBuffer: AudioBuffer | null, 
    voiceBuffer: AudioBuffer | null, 
    voiceStartTime: number
  ): Promise<Blob> {
    
    // Calculate total duration
    let duration = 0;
    if (musicBuffer) duration = Math.max(duration, musicBuffer.duration);
    if (voiceBuffer) duration = Math.max(duration, voiceStartTime + voiceBuffer.duration);
    
    if (duration === 0) throw new Error("Nothing to render");

    // Use OfflineAudioContext for faster-than-realtime rendering
    const offlineCtx = new OfflineAudioContext(
      2, // stereo
      duration * 44100, // length in samples
      44100 // sample rate
    );

    // Re-create graph in offline context
    if (musicBuffer) {
      const src = offlineCtx.createBufferSource();
      src.buffer = musicBuffer;
      src.connect(offlineCtx.destination);
      src.start(0);
    }

    if (voiceBuffer) {
      const src = offlineCtx.createBufferSource();
      src.buffer = voiceBuffer;
      src.connect(offlineCtx.destination);
      src.start(voiceStartTime);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    return this.bufferToWave(renderedBuffer, renderedBuffer.length);
  }

  // Helper to convert AudioBuffer to WAV Blob
  // Standard WAV header construction
  private bufferToWave(abuffer: AudioBuffer, len: number): Blob {
    let numOfChan = abuffer.numberOfChannels;
    let length = len * numOfChan * 2 + 44;
    let buffer = new ArrayBuffer(length);
    let view = new DataView(buffer);
    let channels = [], i, sample;
    let offset = 0;
    let pos = 0;

    // write WAVE header
    setUint32(0x46464952);                         // "RIFF"
    setUint32(length - 8);                         // file length - 8
    setUint32(0x45564157);                         // "WAVE"

    setUint32(0x20746d66);                         // "fmt " chunk
    setUint32(16);                                 // length = 16
    setUint16(1);                                  // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2);                      // block-align
    setUint16(16);                                 // 16-bit (hardcoded in this example)

    setUint32(0x61746164);                         // "data" - chunk
    setUint32(length - pos - 4);                   // chunk length

    // write interleaved data
    for(i = 0; i < abuffer.numberOfChannels; i++)
      channels.push(abuffer.getChannelData(i));

    while(pos < len) {
      for(i = 0; i < numOfChan; i++) {             // interleave channels
        sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
        view.setInt16(44 + offset, sample, true);          // write 16-bit sample
        offset += 2;
      }
      pos++;
    }

    return new Blob([buffer], {type: "audio/wav"});

    function setUint16(data: number) {
      view.setUint16(pos, data, true);
      pos += 2;
    }

    function setUint32(data: number) {
      view.setUint32(pos, data, true);
      pos += 4;
    }
  }
}