type AudioChannel = 'music' | 'effects';

/** Web Audio wrapper with separate buses and an immediate master mute. */
export class GameAudio {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private muted = false;
  private musicVolume = 0.65;
  private effectsVolume = 0.8;
  private readonly voices = new Set<OscillatorNode>();

  async ensure() {
    if (!this.context) {
      this.context = new AudioContext();
      this.masterGain = this.context.createGain();
      this.musicBus = this.context.createGain();
      this.effectsBus = this.context.createGain();
      this.musicBus.connect(this.masterGain);
      this.effectsBus.connect(this.masterGain);
      this.masterGain.connect(this.context.destination);
      this.syncGains();
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain && this.context) {
      const now = this.context.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(muted ? 0 : 1, now);
    }
    if (muted) {
      this.stopMusic();
      for (const voice of this.voices) {
        try {
          voice.stop();
        } catch {
          // A voice may have ended between the set iteration and stop call.
        }
      }
      this.voices.clear();
    }
  }

  setVolumes(music: number, effects: number) {
    this.musicVolume = this.clamp(music);
    this.effectsVolume = this.clamp(effects);
    this.syncGains();
  }

  private clamp(value: number) {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  }

  private syncGains() {
    if (!this.context || !this.masterGain || !this.musicBus || !this.effectsBus) return;
    const now = this.context.currentTime;
    this.masterGain.gain.setValueAtTime(this.muted ? 0 : 1, now);
    this.musicBus.gain.setValueAtTime(this.musicVolume, now);
    this.effectsBus.gain.setValueAtTime(this.effectsVolume, now);
  }

  private async tone(
    frequency: number,
    duration: number,
    volume: number,
    delay = 0,
    type: OscillatorType = 'sine',
    channel: AudioChannel = 'effects',
  ) {
    if (this.muted || (channel === 'music' ? this.musicVolume : this.effectsVolume) === 0) return;
    const context = await this.ensure();
    if (this.muted) return;
    const destination = channel === 'music' ? this.musicBus : this.effectsBus;
    if (!destination) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(55, frequency * 0.78),
      start + duration,
    );
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(destination);
    this.voices.add(oscillator);
    oscillator.onended = () => this.voices.delete(oscillator);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  discard() {
    if (this.muted || this.effectsVolume === 0) return;
    void this.tone(240, 0.075, 0.09, 0, 'triangle');
    void this.tone(105, 0.1, 0.055, 0.025);
  }

  ron() {
    if (this.muted || this.effectsVolume === 0) return;
    [392, 523.25, 659.25, 783.99].forEach(
      (frequency, index) => void this.tone(frequency, 0.42, 0.075, index * 0.105, 'triangle'),
    );
  }

  async startMusic() {
    if (this.muted || this.musicVolume === 0 || this.musicTimer !== null) return;
    await this.ensure();
    if (this.muted || this.musicVolume === 0) return;
    const notes = [130.81, 164.81, 196, 246.94, 196, 164.81];
    const play = () => {
      if (!this.muted && this.musicVolume > 0)
        void this.tone(notes[this.musicStep % notes.length], 0.7, 0.018, 0, 'sine', 'music');
      this.musicStep += 1;
    };
    play();
    this.musicTimer = window.setInterval(play, 720);
  }

  stopMusic() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  dispose() {
    this.stopMusic();
    this.setMuted(true);
    if (this.context) void this.context.close();
    this.context = null;
    this.masterGain = null;
    this.musicBus = null;
    this.effectsBus = null;
  }
}
