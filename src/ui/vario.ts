// Audio variometer for gliders: beeps while climbing (faster and higher with the climb rate)
// and a low tone in strong sink. Starts on the first user gesture; V toggles the sound.

export class Vario {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private osc: OscillatorNode | null = null;
  private timer = 0;
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyV') this.enabled = !this.enabled; });
  }

  private ensure() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.gain = this.ctx.createGain(); this.gain.gain.value = 0; this.gain.connect(this.ctx.destination);
      this.osc = this.ctx.createOscillator(); this.osc.type = 'sine'; this.osc.connect(this.gain); this.osc.start();
    } catch { this.ctx = null; }
  }

  update(active: boolean, climb: number, dt: number) {
    if (!active || !this.enabled) { if (this.gain) this.gain.gain.value = 0; return; }
    this.ensure();
    if (!this.ctx || !this.gain || !this.osc) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const t = this.ctx.currentTime;
    this.timer -= dt;
    if (climb > 0.3) {
      this.osc.frequency.setTargetAtTime(480 + 90 * Math.min(climb, 6), t, 0.01);
      if (this.timer <= 0) {
        this.timer = Math.max(0.16, 0.8 - 0.1 * climb);
        this.gain.gain.cancelScheduledValues(t);
        this.gain.gain.setValueAtTime(0.12, t);
        this.gain.gain.exponentialRampToValueAtTime(0.0008, t + Math.min(0.22, this.timer * 0.6));
      }
    } else if (climb < -2.5) {
      this.osc.frequency.setTargetAtTime(220, t, 0.05);
      this.gain.gain.setTargetAtTime(0.05, t, 0.1);
    } else {
      this.gain.gain.setTargetAtTime(0, t, 0.05);
    }
  }
}
