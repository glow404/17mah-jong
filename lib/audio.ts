export class GameAudio {
  private context: AudioContext | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  async ensure() {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
  }
  private async tone(
    frequency: number,
    duration: number,
    volume: number,
    delay = 0,
    type: OscillatorType = 'sine',
  ) {
    const context = await this.ensure();
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
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
  discard() {
    void this.tone(240, 0.075, 0.09, 0, 'triangle');
    void this.tone(105, 0.1, 0.055, 0.025);
  }
  ron() {
    [392, 523.25, 659.25, 783.99].forEach(
      (frequency, index) => void this.tone(frequency, 0.42, 0.075, index * 0.105, 'triangle'),
    );
  }
  async startMusic() {
    if (this.musicTimer !== null) return;
    await this.ensure();
    const notes = [130.81, 164.81, 196, 246.94, 196, 164.81];
    const play = () => {
      void this.tone(notes[this.musicStep % notes.length], 0.7, 0.018);
      this.musicStep += 1;
    };
    play();
    this.musicTimer = window.setInterval(play, 720);
  }
  stopMusic() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}
