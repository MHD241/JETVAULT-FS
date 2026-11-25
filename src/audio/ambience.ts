// Sound for the passenger journey, made in the browser (Web Audio, no files): the murmur of a terminal, footsteps, a boarding chime, the hum of a cabin, and spoken
// announcements through the browser's own speech synthesis. One mute switch (remembered). Everything is optional: if audio is unavailable nothing happens.
const KEY = 'jetvault.journeyMuted';

export class Ambience {
  private ctx: AudioContext | null = null; private master: GainNode | null = null; private bed: GainNode | null = null; private src: AudioBufferSourceNode[] = [];
  muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();
  private lastStep = 0; private mode: 'terminal' | 'cabin' | null = null; private lfo: OscillatorNode | null = null;
  /** Creates the audio context: call from a click or key press. */
  init() {
    if (this.ctx) return;
    try { const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; this.ctx = new C(); this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 1; this.master.connect(this.ctx.destination); } catch { this.ctx = null; }
  }
  private noise(kind: 'pink' | 'brown', secs = 4): AudioBuffer {
    const c = this.ctx!, b = c.createBuffer(1, c.sampleRate * secs, c.sampleRate), d = b.getChannelData(0); let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; } }
    return b;
  }
  /** Starts the background sound: 'terminal' (people murmuring, far-off engines) or 'cabin' (engine hum). */
  start(mode: 'terminal' | 'cabin') {
    if (!this.ctx || !this.master || this.mode === mode) return; this.stopBed(); this.mode = mode;
    const c = this.ctx, g = c.createGain(); g.gain.value = 0; this.bed = g; g.connect(this.master);
    const s = c.createBufferSource(); s.buffer = this.noise(mode === 'cabin' ? 'brown' : 'pink'); s.loop = true;
    const f = c.createBiquadFilter(); f.type = mode === 'cabin' ? 'lowpass' : 'bandpass'; f.frequency.value = mode === 'cabin' ? 380 : 520; f.Q.value = mode === 'cabin' ? 0.6 : 0.5;
    s.connect(f); f.connect(g); s.start(); this.src.push(s);
    g.gain.linearRampToValueAtTime(mode === 'cabin' ? 0.22 : 0.16, c.currentTime + 1.5);
    if (mode === 'terminal') { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.23; lg.gain.value = 0.05; l.connect(lg); lg.connect(g.gain); l.start(); this.lfo = l; }   // the murmur swells and fades
  }
  private stopBed() { for (const s of this.src) { try { s.stop(); } catch { /* ignore */ } } this.src = []; try { this.lfo?.stop(); } catch { /* ignore */ } this.lfo = null; this.bed?.disconnect(); this.bed = null; this.mode = null; }
  /** A footstep (call while walking; it limits itself to the pace). */
  step(running: boolean) {
    if (!this.ctx || !this.master) return; const now = this.ctx.currentTime; if (now - this.lastStep < (running ? 0.3 : 0.5)) return; this.lastStep = now;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise('brown', 1); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; const g = c.createGain();
    g.gain.setValueAtTime(0.0, now); g.gain.linearRampToValueAtTime(0.28, now + 0.01); g.gain.exponentialRampToValueAtTime(0.001, now + 0.13); s.connect(f); f.connect(g); g.connect(this.master); s.start(now); s.stop(now + 0.16);
  }
  /** Two-tone chime (boarding, check-in done). */
  chime(up = true) {
    if (!this.ctx || !this.master) return; const c = this.ctx, t = c.currentTime;
    [up ? 659 : 784, up ? 880 : 659].forEach((hz, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = hz; g.gain.setValueAtTime(0, t + i * 0.28); g.gain.linearRampToValueAtTime(0.18, t + i * 0.28 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.28 + 0.9); o.connect(g); g.connect(this.master!); o.start(t + i * 0.28); o.stop(t + i * 0.28 + 1); });
  }
  /** A spoken announcement (the browser's own voice), after a chime. */
  announce(text: string) {
    this.chime(true); if (this.muted) return;
    try { const u = new SpeechSynthesisUtterance(text); u.rate = 0.95; u.pitch = 1.05; u.volume = 0.7; setTimeout(() => { if (!this.muted) window.speechSynthesis?.speak(u); }, 900); } catch { /* ignore */ }
  }
  setMuted(m: boolean) { this.muted = m; try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* ignore */ } if (this.master) this.master.gain.value = m ? 0 : 1; if (m) { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } } }
  stop() { this.stopBed(); try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } try { void this.ctx?.close(); } catch { /* ignore */ } this.ctx = null; this.master = null; }
}
