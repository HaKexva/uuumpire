/* UUUMPIRE music: two original Famicom-style songs (gameplay theme + title entry fanfare)
   and a tiny 2A03-ish synth. The same song data drives the in-game WebAudio player and
   tools/export-midi.js. */
(function (root) {
  'use strict';

  // ------------------------------------------------------------
  // Song data. 8th-note steps, 8 per bar. Tokens: note (c5, f#4), '.' tie, '-' rest.
  // Drums: K kick, S snare, h closed hat, '-' rest. A track's optional `transpose` (semitones)
  // shifts every note of that track (used to tuck the comp an octave under the lead).
  // Chords: C | F | G | C | C | F | G | C || Am | F | G | C | Am | F | G | C
  // ------------------------------------------------------------
  const SONG = {
    title: 'UUUMPIRE Theme (Play Ball!)',
    bpm: 168,
    stepsPerBar: 8,
    tracks: {
      lead: {
        type: 'pulse', duty: 0.25, vol: 0.055, midiProgram: 80,
        bars: [
          'c5 e5 g5 e5 c5 .  g4 .',
          'f4 a4 c5 a4 f4 .  a4 .',
          'g4 b4 d5 b4 g4 .  b4 .',
          'c5 .  e5 .  g5 .  .  -',
          'e5 e5 d5 c5 d5 .  g4 .',
          'f5 f5 e5 d5 e5 .  c5 .',
          'd5 e5 f5 e5 d5 c5 b4 c5',
          'c5 .  .  -  g4 a4 b4 .',
          'a4 c5 e5 c5 a4 .  e5 .',
          'f4 a4 c5 a4 f4 .  c5 .',
          'g4 b4 d5 b4 g4 .  d5 .',
          'e5 .  c5 .  g4 .  .  -',
          'e5 e5 c5 a4 c5 .  e5 .',
          'f5 e5 c5 a4 c5 .  f5 .',
          'g5 f5 e5 d5 c5 b4 a4 b4',
          'c5 .  .  -  g4 a4 b4 .',
        ],
      },
      harmony: {
        type: 'pulse', duty: 0.25, vol: 0.024, midiProgram: 81, transpose: -12,
        bars: [
          'e4 g4 c5 g4 e4 g4 c5 g4',
          'f4 a4 c5 a4 f4 a4 c5 a4',
          'g4 b4 d5 b4 g4 b4 d5 b4',
          'e4 g4 c5 g4 e4 g4 c5 g4',
          'e4 g4 c5 g4 e4 g4 c5 g4',
          'f4 a4 c5 a4 f4 a4 c5 a4',
          'g4 b4 d5 b4 g4 b4 d5 b4',
          'e4 g4 c5 g4 e4 g4 c5 g4',
          'a4 c5 e5 c5 a4 c5 e5 c5',
          'f4 a4 c5 a4 f4 a4 c5 a4',
          'g4 b4 d5 b4 g4 b4 d5 b4',
          'e4 g4 c5 g4 e4 g4 c5 g4',
          'a4 c5 e5 c5 a4 c5 e5 c5',
          'f4 a4 c5 a4 f4 a4 c5 a4',
          'g4 b4 d5 b4 g4 b4 d5 b4',
          'e4 g4 c5 g4 e4 g4 c5 g4',
        ],
      },
      bass: {
        type: 'triangle', vol: 0.09, midiProgram: 38,
        bars: [
          'c3 -  g2 -  c3 -  g2 -',
          'f2 -  c3 -  f2 -  c3 -',
          'g2 -  d3 -  g2 -  d3 -',
          'c3 -  g2 -  c3 -  e3 -',
          'c3 -  g2 -  c3 -  g2 -',
          'f2 -  c3 -  f2 -  c3 -',
          'g2 -  d3 -  g2 -  d3 -',
          'c3 -  g2 -  c3 c3 d3 e3',
          'a2 -  e3 -  a2 -  e3 -',
          'f2 -  c3 -  f2 -  c3 -',
          'g2 -  d3 -  g2 -  d3 -',
          'c3 -  g2 -  c3 -  e3 -',
          'a2 -  e3 -  a2 -  e3 -',
          'f2 -  c3 -  f2 -  c3 -',
          'g2 -  d3 -  g2 -  b2 -',
          'c3 -  g2 -  c3 c3 d3 e3',
        ],
      },
      drums: {
        type: 'noise', vol: 0.035,
        bars: [
          'K h S h K h S h', 'K h S h K h S h', 'K h S h K h S h', 'K h S h K h S S',
          'K h S h K h S h', 'K h S h K h S h', 'K h S h K h S h', 'K h S h K S S S',
          'K h S h K h S h', 'K h S h K h S h', 'K h S h K h S h', 'K h S h K h S S',
          'K h S h K h S h', 'K h S h K h S h', 'K h S h K h S h', 'K h S h K S S S',
        ],
      },
    },
  };

  // ------------------------------------------------------------
  // Entry fanfare (title screen). Original, in the spirit of a Taiwanese ballpark brass-band
  // cheer: march tempo, trumpet call-and-response, snare rolls into the answer. 8 bars, loops.
  // Chords: C | C | F | G | C | Am | F G | C
  // ------------------------------------------------------------
  const ENTRY = {
    title: 'UUUMPIRE Entry (Play Ball Fanfare)',
    bpm: 132,
    stepsPerBar: 8,
    tracks: {
      lead: {
        type: 'pulse', duty: 0.5, vol: 0.06, midiProgram: 56,            // trumpet
        bars: [
          'g4 c5 e5 .  g5 .  e5 .',      // call
          'g5 .  .  .  e5 c5 g4 .',
          'f5 f5 f5 .  e5 d5 c5 .',      // answer
          'd5 .  .  .  g4 a4 b4 .',
          'c5 e5 g5 .  c6 .  g5 .',      // call, higher
          'a5 .  .  .  g5 e5 c5 .',
          'f5 f5 e5 d5 e5 d5 c5 b4',     // run down
          'c5 .  .  .  -  -  -  -',      // hit
        ],
      },
      harmony: {
        type: 'pulse', duty: 0.5, vol: 0.03, midiProgram: 61, transpose: -12, // brass section, an octave under the lead
        bars: [
          'e4 g4 c5 .  e5 .  c5 .',
          'e5 .  .  .  c5 g4 e4 .',
          'a4 a4 a4 .  c5 b4 a4 .',
          'b4 .  .  .  d4 f4 g4 .',
          'e4 g4 c5 .  e5 .  c5 .',
          'c5 .  .  .  e5 c5 a4 .',
          'a4 a4 c5 b4 c5 b4 g4 g4',
          'e5 .  .  .  -  -  -  -',
        ],
      },
      bass: {
        type: 'triangle', vol: 0.09, midiProgram: 58,                   // tuba
        bars: [
          'c3 -  g2 -  c3 -  g2 -',
          'c3 -  g2 -  c3 -  g2 -',
          'f2 -  c3 -  f2 -  c3 -',
          'g2 -  d3 -  g2 -  g2 g2',
          'c3 -  g2 -  c3 -  g2 -',
          'a2 -  e3 -  a2 -  e3 -',
          'f2 -  c3 -  g2 -  d3 -',
          'c3 -  -  -  -  -  -  -',
        ],
      },
      drums: {
        type: 'noise', vol: 0.04,
        bars: [
          'K h S h K h S h', 'K h S h K h S S',
          'K h S h K h S h', 'K S S S S S S S',   // roll into the next call
          'K h S h K h S h', 'K h S h K h S S',
          'K S K S K S S S', 'K S -  -  -  -  -  -',
        ],
      },
    },
  };

  // ------------------------------------------------------------
  // "Take Me Out to the Ball Game" (Norworth / Von Tilzer, 1908, public domain). Chorus, 3/4,
  // 6 steps per bar. Melody after the dtrad transcription (abcnotation.com, key D); oom-pah-pah
  // tuba + brass on the chord tones, waltz drums.
  // ------------------------------------------------------------
  const CHORD = { // root, fifth, third (mid), fifth (mid): comp sits below the melody so it never gets shrill
    D: ['d3', 'a2', 'f#3', 'a3'], A7: ['a2', 'e3', 'c#3', 'g3'], G: ['g2', 'd3', 'b2', 'd3'],
    E7: ['e3', 'b2', 'g#3', 'd3'], B7: ['b2', 'f#3', 'd#3', 'a3'],
  };
  const BALLGAME_CHORDS = [
    'D', 'D', 'A7', 'A7', 'D', 'D', 'A7', 'A7',
    'G', 'D', 'G', 'E7', 'G', 'D', 'A7', 'A7',
    'D', 'D', 'A7', 'A7', 'D', 'D', 'G', 'A7',
    'G', 'G', 'D', 'A7', 'G', 'A7', 'D', 'D',
  ];
  // legato comp: tuba holds the root for beat 1 then the fifth through beats 2-3, brass answers with
  // full quarter-note chord tones on beats 2 and 3 (not clipped 8ths, which came out too staccato)
  const waltzBass = (chords) => chords.map((c) => { const [r, f] = CHORD[c]; return `${r} . ${f} . . .`; });
  const waltzBrass = (chords) => chords.map((c) => { const [, , t, u] = CHORD[c]; return `- - ${t} . ${u} .`; });
  const BALLGAME = {
    title: 'Take Me Out to the Ball Game (chiptune)',
    bpm: 180,
    stepsPerBar: 6,
    tracks: {
      lead: {
        type: 'pulse', duty: 0.5, vol: 0.05, midiProgram: 56,
        bars: [
          'd4 .  .  .  d5 .',  'b4 .  a4 .  f#4 .', 'a4 .  .  .  .  .',  'e4 .  .  .  .  .',   // Take me out to the ball game
          'd4 .  .  .  d5 .',  'b4 .  a4 .  f#4 .', 'a4 .  .  .  .  .',  '.  .  .  .  -  -',   // Take me out with the crowd
          'b4 .  a#4 . b4 .',  'f#4 . g4 .  a4 .',  'b4 .  .  .  g4 .',  'e4 .  .  .  .  .',   // Buy me some peanuts and Cracker Jack
          'b4 .  .  .  b4 .',  'b4 .  c#5 . d5 .',  'e5 .  c#5 . b4 .',  'a4 .  f#4 . e4 .',   // I don't care if I never get back
          'd4 .  .  .  d5 .',  'b4 .  a4 .  f#4 .', 'a4 .  .  .  .  .',  'e4 .  .  .  e4 .',   // Let me root, root, root for the home team
          'd4 .  .  .  e4 .',  'f#4 . g4 .  a4 .',  'b4 .  .  .  .  .',  '.  .  b4 .  c#5 .',  // If they don't win it's a shame
          'd5 .  .  .  .  .',  'd5 .  .  .  .  .',  'd5 .  c#5 . b4 .',  'a4 .  g#4 . a4 .',   // For it's one, two, three strikes you're out
          'b4 .  .  .  .  .',  'c#5 . .  .  .  .',  'd5 .  .  .  .  .',  '.  .  -  -  -  -',   // at the old ball game
        ],
      },
      harmony: { type: 'pulse', duty: 0.5, vol: 0.028, midiProgram: 61, bars: waltzBrass(BALLGAME_CHORDS) },
      bass: { type: 'triangle', vol: 0.09, midiProgram: 58, bars: waltzBass(BALLGAME_CHORDS) },
      drums: {
        type: 'noise', vol: 0.035,
        bars: BALLGAME_CHORDS.map((c, i) => (i % 8 === 7 ? 'K -  S  -  S  S' : 'K -  h  -  h  -')),
      },
    },
  };

  const SONGS = { theme: SONG, entry: ENTRY, ballgame: BALLGAME };

  const NOTE_IDX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  function noteToMidi(tok) {
    const m = /^([a-g])(#?)(\d)$/.exec(tok);
    if (!m) return null;
    return 12 * (parseInt(m[3], 10) + 1) + NOTE_IDX[m[1]] + (m[2] ? 1 : 0);
  }
  const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // Flatten a track into [{step, len, note|hit}] events.
  function trackEvents(track) {
    const steps = track.bars.flatMap((b) => b.trim().split(/\s+/));
    const ev = [];
    for (let i = 0; i < steps.length; i++) {
      const t = steps[i];
      if (t === '-' || t === '.') continue;
      let len = 1;
      while (steps[i + len] === '.') len++;
      if (track.type === 'noise') ev.push({ step: i, len: 1, hit: t });
      else { const n = noteToMidi(t); if (n !== null) ev.push({ step: i, len, note: n + (track.transpose || 0) }); }
    }
    return { events: ev, totalSteps: steps.length };
  }

  // ------------------------------------------------------------
  // WebAudio player
  // ------------------------------------------------------------
  function pulseWave(ctx, duty) {
    const N = 48;
    const real = new Float32Array(N), imag = new Float32Array(N);
    for (let k = 1; k < N; k++) {
      real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      imag[k] = (2 / (k * Math.PI)) * (1 - Math.cos(k * Math.PI * duty));
    }
    return ctx.createPeriodicWave(real, imag);
  }

  // step-indexed event maps for the scheduler
  function buildSong(song) {
    const s = { tracks: {}, totalSteps: 0, stepDur: 60 / song.bpm / 2 };
    for (const name in song.tracks) {
      const te = trackEvents(song.tracks[name]);
      s.tracks[name] = { def: song.tracks[name], byStep: new Map(), total: te.totalSteps };
      for (const e of te.events) {
        if (!s.tracks[name].byStep.has(e.step)) s.tracks[name].byStep.set(e.step, []);
        s.tracks[name].byStep.get(e.step).push(e);
      }
      s.totalSteps = Math.max(s.totalSteps, te.totalSteps);
    }
    return s;
  }

  const Player = {
    ctx: null, master: null, enabled: true, playing: false,
    timer: null, step: 0, nextTime: 0, waves: {}, noiseBuf: null,
    songs: {}, current: 'theme',
    tempo: 1,                        // playback speed multiplier (the game pushes it up with the crowd gauge)
    setTempo(mult) { this.tempo = Math.max(0.5, Math.min(2, mult || 1)); },
    get song() { return this.songs[this.current]; },

    attach(ctx) {
      if (this.ctx) return;
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(ctx.destination);
      // tonal channels go through a gentle lowpass (takes the shrill edge off the pulse harmonics);
      // drums bypass it so the hats keep their sizzle
      this.tone = ctx.createBiquadFilter();
      this.tone.type = 'lowpass'; this.tone.frequency.value = 3800; this.tone.Q.value = 0.5;
      this.tone.connect(this.master);
      // drums get their own, higher lowpass: keeps the hats from hissing without dulling the snare
      this.drumBus = ctx.createBiquadFilter();
      this.drumBus.type = 'lowpass'; this.drumBus.frequency.value = 7000; this.drumBus.Q.value = 0.5;
      this.drumBus.connect(this.master);
      this.waves = { 0.125: pulseWave(ctx, 0.125), 0.25: pulseWave(ctx, 0.25), 0.5: pulseWave(ctx, 0.5) };
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      for (const key in SONGS) this.songs[key] = buildSong(SONGS[key]);
    },

    // register an extra song (same JSON shape as SONG), e.g. one loaded from assets/songs/*.json
    addSong(key, song) {
      SONGS[key] = song;
      if (this.ctx) this.songs[key] = buildSong(song);
    },
    has(key) { return !!SONGS[key]; },

    // start(name): play that song from the top (no-op if it is already the one playing)
    start(name) {
      if (!this.ctx || !this.enabled) return;
      const key = name && this.songs[name] ? name : this.current;
      if (this.playing && key === this.current) return;
      this.stop();
      this.current = key;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.playing = true;
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.05;
      this.timer = setInterval(() => this.schedule(), 25);
    },
    stop() {
      this.playing = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    },
    setEnabled(on) {
      this.enabled = on;
      if (!on) this.stop();
    },

    schedule() {
      const horizon = this.ctx.currentTime + 0.15;
      const s = this.song;
      while (this.nextTime < horizon) {
        for (const name in s.tracks) {
          const tr = s.tracks[name];
          const evs = tr.byStep.get(this.step % tr.total);
          if (evs) for (const e of evs) this.play(tr.def, e, this.nextTime, s.stepDur / this.tempo);
        }
        this.nextTime += s.stepDur / this.tempo;
        this.step = (this.step + 1) % s.totalSteps;
      }
    },

    play(def, e, t, stepDur) {
      const ctx = this.ctx;
      if (def.type === 'noise') return this.drum(e.hit, t, def.vol);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      if (def.type === 'pulse') o.setPeriodicWave(this.waves[def.duty] || this.waves[0.5]);
      else o.type = def.type;
      o.frequency.value = midiToFreq(e.note);
      const dur = e.len * stepDur;
      const rel = Math.min(0.03, dur * 0.2);
      g.gain.setValueAtTime(def.vol, t);
      let level = def.vol;
      if (def.type === 'pulse') { // 2A03-ish decay, as a short ramp rather than a step (a step clicks)
        level = def.vol * 0.7;
        g.gain.setValueAtTime(def.vol, t + dur * 0.5);
        g.gain.linearRampToValueAtTime(level, t + Math.min(dur * 0.5 + 0.015, dur - rel));
      }
      g.gain.setValueAtTime(level, t + dur - rel);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.tone);
      o.start(t); o.stop(t + dur + 0.01);
    },

    drum(hit, t, vol) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      let dur;
      if (hit === 'K') { f.type = 'lowpass'; f.frequency.value = 220; dur = 0.09; vol *= 2.2; }
      else if (hit === 'S') { f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7; dur = 0.11; vol *= 1.4; }
      else { f.type = 'bandpass'; f.frequency.value = 5200; f.Q.value = 1.2; dur = 0.028; vol *= 0.45; } // soft closed hat
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.drumBus);
      src.start(t); src.stop(t + dur + 0.01);
    },
  };

  const api = { SONG, ENTRY, BALLGAME, SONGS, Player, noteToMidi, trackEvents };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UUMusic = api;
})(typeof window !== 'undefined' ? window : globalThis);
