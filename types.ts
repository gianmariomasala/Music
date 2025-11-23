export type SpeakerVoice = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface AudioTrack {
  id: string;
  buffer: AudioBuffer;
  startTime: number;
  label: string;
  type: 'music' | 'voice';
}
