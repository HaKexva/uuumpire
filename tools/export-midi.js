#!/usr/bin/env node
/* Export a song from music.js as a Standard MIDI File (format 1).
   Usage: node tools/export-midi.js [theme|entry|ballgame] [out.mid]
   Default output: assets/uuumpire-<song>.mid */
'use strict';
const fs = require('fs');
const path = require('path');
const { SONGS, trackEvents } = require("../music.js");

const PPQ = 96;
const STEP_TICKS = PPQ / 2; // 8th-note steps
const DRUM_NOTES = { K: 36, S: 38, h: 42 };

function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
function str(s) { return Array.from(Buffer.from(s, 'latin1')); }
function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function u16(n) { return [(n >>> 8) & 255, n & 255]; }
function chunk(id, data) { return [...str(id), ...u32(data.length), ...data]; }

function buildTrack(events, { channel, program, name }) {
  // events: [{tick, type:'on'|'off', note, vel}]
  const out = [];
  let last = 0;
  const push = (tick, bytes) => { out.push(...vlq(tick - last), ...bytes); last = tick; };
  push(0, [0xff, 0x03, name.length, ...str(name)]);
  if (program !== undefined) push(0, [0xc0 | channel, program]);
  events.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 1));
  for (const e of events) push(e.tick, [(e.type === 'on' ? 0x90 : 0x80) | channel, e.note, e.vel]);
  push(last, [0xff, 0x2f, 0x00]);
  return out;
}

function main() {
  const key = SONGS[process.argv[2]] ? process.argv[2] : "theme";
  const SONG = SONGS[key];
  const outPath = (SONGS[process.argv[2]] ? process.argv[3] : process.argv[2]) || path.join(__dirname, "..", "assets", `uuumpire-${key}.mid`);
  const tracks = [];

  // tempo/meta track
  const usPerQuarter = Math.round(60000000 / SONG.bpm);
  const meta = [
    ...vlq(0), 0xff, 0x03, SONG.title.length, ...str(SONG.title),
    ...vlq(0), 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255,
    ...vlq(0), 0xff, 0x58, 0x04, (SONG.stepsPerBar || 8) / 2, 2, 24, 8, // time signature from the step grid (8 -> 4/4, 6 -> 3/4)
    ...vlq(0), 0xff, 0x2f, 0x00,
  ];
  tracks.push(meta);

  let ch = 0;
  for (const name in SONG.tracks) {
    const def = SONG.tracks[name];
    const { events } = trackEvents(def);
    const list = [];
    if (def.type === 'noise') {
      for (const e of events) {
        const n = DRUM_NOTES[e.hit]; if (!n) continue;
        list.push({ tick: e.step * STEP_TICKS, type: 'on', note: n, vel: e.hit === 'h' ? 70 : 100 });
        list.push({ tick: e.step * STEP_TICKS + STEP_TICKS / 2, type: 'off', note: n, vel: 0 });
      }
      tracks.push(buildTrack(list, { channel: 9, name }));
    } else {
      for (const e of events) {
        list.push({ tick: e.step * STEP_TICKS, type: 'on', note: e.note, vel: 96 });
        list.push({ tick: (e.step + e.len) * STEP_TICKS - 2, type: 'off', note: e.note, vel: 0 });
      }
      tracks.push(buildTrack(list, { channel: ch++, program: def.midiProgram || 80, name }));
    }
  }

  const bytes = [
    ...chunk('MThd', [...u16(1), ...u16(tracks.length), ...u16(PPQ)]),
    ...tracks.flatMap((t) => chunk('MTrk', t)),
  ];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(bytes));
  console.log('wrote', outPath, bytes.length, 'bytes,', tracks.length, 'tracks');
}

main();
