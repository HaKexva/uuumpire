#!/usr/bin/env node
/* Import a single-melody Standard MIDI File (e.g. a flutetunes.com tune) into the song format used by
   music.js: 8th-note steps, note tokens like c5 / f#4, '.' = tie, '-' = rest. Adds a simple
   auto-comp (bass + brass on a per-bar I/IV/V/vi chord guess) and a drum pattern.

   Usage: node tools/import-midi.js in.mid out.json --title "Name" [--bpm 150] [--transpose -2]
          [--bars 0:32] [--lead-duty 0.5] [--octave -1]
   Output JSON: { title, bpm, stepsPerBar, source, tracks: { lead, harmony, bass, drums } } */
'use strict';
const fs = require('fs');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) a[t.slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else a._.push(t);
  }
  return a;
}

// ---- SMF parsing --------------------------------------------------------
function readVlq(buf, p) { let v = 0, b; do { b = buf[p.i++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; }
function parseMidi(buf) {
  if (buf.toString('latin1', 0, 4) !== 'MThd') throw new Error('not a MIDI file');
  const ppq = buf.readUInt16BE(12);
  const ntracks = buf.readUInt16BE(10);
  let pos = 8 + buf.readUInt32BE(4);
  const tracks = [];
  let tempo = 500000, timeSig = [4, 4];
  for (let t = 0; t < ntracks; t++) {
    if (buf.toString('latin1', pos, pos + 4) !== 'MTrk') throw new Error('bad track header');
    const len = buf.readUInt32BE(pos + 4);
    const end = pos + 8 + len;
    const p = { i: pos + 8 };
    let tick = 0, status = 0;
    const notes = [], open = {};
    let name = '';
    while (p.i < end) {
      tick += readVlq(buf, p);
      let b = buf[p.i];
      if (b === 0xff) {
        const type = buf[p.i + 1]; p.i += 2;
        const l = readVlq(buf, p);
        const data = buf.subarray(p.i, p.i + l); p.i += l;
        if (type === 0x51) tempo = (data[0] << 16) | (data[1] << 8) | data[2];
        else if (type === 0x58) timeSig = [data[0], Math.pow(2, data[1])];
        else if (type === 0x03) name = data.toString('latin1');
        continue;
      }
      if (b === 0xf0 || b === 0xf7) { p.i++; const l = readVlq(buf, p); p.i += l; continue; }
      if (b & 0x80) { status = b; p.i++; }
      const hi = status & 0xf0;
      if (hi === 0x90 || hi === 0x80) {
        const note = buf[p.i], vel = buf[p.i + 1]; p.i += 2;
        if (hi === 0x90 && vel > 0) open[note] = tick;
        else if (open[note] !== undefined) { notes.push({ note, start: open[note], end: tick }); delete open[note]; }
      } else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) p.i += 2;
      else if (hi === 0xc0 || hi === 0xd0) p.i += 1;
    }
    tracks.push({ name, notes });
    pos = end;
  }
  return { ppq, tempo, timeSig, tracks };
}

// ---- grid conversion -----------------------------------------------------
const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const tok = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

function main() {
  const a = parseArgs(process.argv);
  const [inPath, outPath] = a._;
  if (!inPath || !outPath) { console.error('usage: import-midi.js in.mid out.json --title "Name" [--bpm N] [--transpose N] [--bars a:b] [--octave N]'); process.exit(1); }
  const midi = parseMidi(fs.readFileSync(inPath));
  const melody = midi.tracks.filter((t) => t.notes.length).sort((x, y) => y.notes.length - x.notes.length)[0];
  if (!melody) throw new Error('no notes');
  const step = midi.ppq / 2;                          // 8th note
  const beatsPerBar = midi.timeSig[0] * (4 / midi.timeSig[1]);
  const stepsPerBar = Math.round(beatsPerBar * 2);
  const transpose = (parseInt(a.transpose || '0', 10) || 0) + (parseInt(a.octave || '0', 10) || 0) * 12;

  // monophonic: keep the highest note when two overlap at a step
  const totalSteps = Math.ceil(Math.max(...melody.notes.map((n) => n.end)) / step);
  const nBars = Math.ceil(totalSteps / stepsPerBar);
  const grid = new Array(nBars * stepsPerBar).fill('-');
  const sorted = melody.notes.slice().sort((x, y) => x.start - y.start || y.note - x.note);
  for (const n of sorted) {
    const s0 = Math.round(n.start / step), s1 = Math.max(s0 + 1, Math.round(n.end / step));
    if (grid[s0] !== '-' && grid[s0] !== '.') continue;   // already a note starting here (lower one lost)
    grid[s0] = tok(n.note + transpose);
    for (let s = s0 + 1; s < s1 && s < grid.length; s++) if (grid[s] === '-') grid[s] = '.';
  }
  let bars = [];
  for (let b = 0; b < nBars; b++) bars.push(grid.slice(b * stepsPerBar, (b + 1) * stepsPerBar));
  if (a.bars) { const [x, y] = a.bars.split(':').map(Number); bars = bars.slice(x, y); }
  // drop a leading all-rest bar and trailing all-rest bars
  while (bars.length && bars[0].every((t) => t === '-')) bars.shift();
  while (bars.length && bars[bars.length - 1].every((t) => t === '-' || t === '.')) bars.pop();

  // ---- key + per-bar chord guess (I, IV, V, vi; major keys only) ----
  const pcs = new Array(12).fill(0);
  for (const bar of bars) for (const t of bar) if (t !== '-' && t !== '.') pcs[NAMES.indexOf(t.replace(/\d+$/, ''))]++;
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  let key = 0, best = -1;
  for (let k = 0; k < 12; k++) { let s = 0; for (const d of MAJOR) s += pcs[(k + d) % 12]; s += pcs[k] * 0.5; if (s > best) { best = s; key = k; } }
  const CHORDS = { I: [0, 4, 7], IV: [5, 9, 0], V: [7, 11, 2], vi: [9, 0, 4] };
  const chordOf = (bar) => {
    let bestC = 'I', bestS = -1;
    for (const c in CHORDS) {
      let s = c === 'I' ? 0.3 : 0;
      bar.forEach((t, i) => {
        if (t === '-' || t === '.') return;
        const pc = (NAMES.indexOf(t.replace(/\d+$/, '')) - key + 12) % 12;
        if (CHORDS[c].includes(pc)) s += i % 2 === 0 ? 1 : 0.5;     // on-beat notes count more
      });
      if (s > bestS) { bestS = s; bestC = c; }
    }
    return bestC;
  };
  const chords = bars.map(chordOf);
  const root = (c, oct) => tok(key + CHORDS[c][0] + 12 * (oct + 1) - (key + CHORDS[c][0] >= 12 ? 12 : 0));
  const fifth = (c, oct) => tok(key + CHORDS[c][2] + 12 * (oct + 1) - (key + CHORDS[c][2] >= 12 ? 12 : 0));
  const third = (c, oct) => tok(key + CHORDS[c][1] + 12 * (oct + 1) - (key + CHORDS[c][1] >= 12 ? 12 : 0));

  const waltz = stepsPerBar === 6;
  const bass = chords.map((c) => (waltz ? `${root(c, 2)} . ${fifth(c, 2)} . . .` : `${root(c, 2)} - ${fifth(c, 2)} - ${root(c, 2)} - ${fifth(c, 2)} -`));
  const harmony = chords.map((c) => (waltz ? `- - ${third(c, 3)} . ${fifth(c, 3)} .` : `- ${third(c, 3)} - ${fifth(c, 3)} - ${third(c, 3)} - ${fifth(c, 3)}`));
  const drums = chords.map((c, i) => (waltz ? (i % 8 === 7 ? 'K -  S  -  S  S' : 'K -  h  -  h  -') : (i % 4 === 3 ? 'K h S h K h S S' : 'K h S h K h S h')));

  const bpm = parseInt(a.bpm || '0', 10) || Math.round(60000000 / midi.tempo);
  const song = {
    title: a.title || melody.name || inPath,
    bpm, stepsPerBar, key: NAMES[key].toUpperCase(),
    source: a.source || '',
    tracks: {
      lead: { type: 'pulse', duty: parseFloat(a['lead-duty'] || '0.5'), vol: 0.05, midiProgram: 56, bars: bars.map((b) => b.join(' ')) },
      harmony: { type: 'pulse', duty: 0.5, vol: 0.028, midiProgram: 61, bars: harmony },
      bass: { type: 'triangle', vol: 0.09, midiProgram: 58, bars: bass },
      drums: { type: 'noise', vol: 0.035, bars: drums },
    },
  };
  fs.writeFileSync(outPath, JSON.stringify(song, null, 1) + '\n');
  console.log(`${outPath}: ${bars.length} bars, ${stepsPerBar} steps/bar, ${bpm} bpm, key ${song.key}, chords ${chords.slice(0, 8).join(' ')}...`);
}

main();
