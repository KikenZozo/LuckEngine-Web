// ============================================================================
// LuckEngine-Web — src/audio/AudioManager.js
// ----------------------------------------------------------------------------
// Lecture audio via Web Audio. Reçoit des octets bruts (extraits de voice.PAK /
// SE.PAK / BGM), DÉTECTE le format aux octets magiques, et décode via le
// navigateur (decodeAudioData gère OGG/WAV/MP3/AAC nativement). Si le format
// n'est pas décodable nativement (ATRAC3/AT9/NWA…), on LOGUE les octets magiques
// pour savoir quel décodeur custom écrire ensuite.
//   3 canaux : bgm (boucle), se (one-shot), voice (one-shot, coupe le précédent).
// ============================================================================
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.gain = {};
    this.bgmSource = null;
    this.voiceSource = null;
    this.seSource = null;       // SE ponctuels (one-shot)
    this.seLoopSource = null;   // SE d'ambiance en boucle (higurashi/kaze/ame…)
    this._cache = new Map(); // from -> AudioBuffer (évite de redécoder)
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      for (const [ch, vol] of [["bgm", 0.55], ["se", 0.9], ["voice", 1.0]]) {
        const g = this.ctx.createGain();
        g.gain.value = vol;
        g.connect(this.ctx.destination);
        this.gain[ch] = g;
      }
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  /** À appeler sur un geste utilisateur (clic) pour débloquer l'audio. */
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

  setVolume(channel, v) { if (this.gain[channel]) this.gain[channel].gain.value = v; }

  _detect(b) {
    const s = (i, n) => { let r = ""; for (let k = 0; k < n; k++) r += String.fromCharCode(b[i + k] || 0); return r; };
    if (s(0, 4) === "OggS") return "ogg";
    if (s(0, 4) === "RIFF") { const t = s(8, 4); return t === "WAVE" ? "wav" : ("riff:" + t); }
    if (s(0, 4) === "fLaC") return "flac";
    if (s(0, 3) === "ID3") return "mp3";
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3";
    return "inconnu";
  }

  async _decode(bytes, from) {
    if (this._cache.has(from)) return this._cache.get(from);
    const ctx = this._ensure();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const buf = await ctx.decodeAudioData(ab);
    this._cache.set(from, buf);
    return buf;
  }

  async _play(bytes, from, channel, loop) {
    const fmt = this._detect(bytes);
    let buffer;
    try {
      buffer = await this._decode(bytes, from);
    } catch (e) {
      const hex = [...bytes.slice(0, 12)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
      console.warn(`AUDIO ${channel} ${from}: format "${fmt}" non décodable par le navigateur (octets: ${hex}). Décodeur custom requis.`);
      return null;
    }
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!loop;
    src.connect(this.gain[channel]);
    src.start(0);
    console.log(`AUDIO ${channel} ${from}: OK (${fmt}, ${buffer.duration.toFixed(1)}s${loop ? ", boucle" : ""})`);
    return src;
  }

  /** Détecte le format audio des octets (sans jouer) — pour diagnostic. */
  inspect(bytes) { return this._detect(bytes); }

  async playBgm(bytes, from = "bgm") {
    this._ensure();
    this.stopBgm();
    this.bgmSource = await this._play(bytes, from, "bgm", true);
  }
  async playSe(bytes, from = "se", loop = false) {
    this._ensure();
    if (loop) {
      // SE d'ambiance : remplace la boucle précédente, tourne jusqu'à SE(255)
      this.stopSeLoop();
      this.seLoopSource = await this._play(bytes, from, "se", true);
    } else {
      // SE ponctuel : ne coupe PAS l'ambiance en boucle
      this.seSource = await this._play(bytes, from, "se", false);
    }
  }
  stopSeLoop() { if (this.seLoopSource) { try { this.seLoopSource.stop(); } catch {} this.seLoopSource = null; } }
  stopSe() {
    if (this.seSource) { try { this.seSource.stop(); } catch {} this.seSource = null; }
    this.stopSeLoop(); // SE(255) coupe aussi les ambiances
  }
  async playVoice(bytes, from = "voice") {
    this._ensure();
    this.stopVoice();
    this.voiceSource = await this._play(bytes, from, "voice", false);
  }
  stopBgm() { if (this.bgmSource) { try { this.bgmSource.stop(); } catch {} this.bgmSource = null; } }
  stopVoice() { if (this.voiceSource) { try { this.voiceSource.stop(); } catch {} this.voiceSource = null; } }
}
