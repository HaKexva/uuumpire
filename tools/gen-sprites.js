#!/usr/bin/env node
/* Rasterizes the player sprites from simple shapes into the ASCII rows used by sprites.js.
   Usage: node tools/gen-sprites.js          -> prints the sprite arrays
          node tools/gen-sprites.js --write  -> splices them into sprites.js
   Keys: see the header comment in sprites.js. '.' = transparent. */
'use strict';
const fs = require('fs');
const path = require('path');

// A drawing grid. Shapes are given in "design" units; S scales them when rasterizing, so the same
// shapes can produce a bigger sprite with clean (not pixel-doubled) edges. S = 1 is 1:1.
function grid(w0, h0, S = 1) {
  const w = Math.ceil(w0 * S), h = Math.ceil(h0 * S);
  const X = (v) => Math.round(v * S);
  const g = Array.from({ length: h }, () => Array(w).fill('.'));
  const put = (x, y, ch) => { if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = ch; };
  const get = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? g[y][x] : '.');
  const api = {
    w, h, g, get,
    put(x, y, ch) { api.rect(x, y, x, y, ch); },
    // 1-pixel strokes regardless of scale (for inner borders that must stay thin)
    vline(x, y0, y1, ch) { for (let y = X(y0); y < X(y1 + 1); y++) put(X(x), y, ch); },
    hline(x0, x1, y, ch) { for (let x = X(x0); x < X(x1 + 1); x++) put(x, X(y), ch); },
    rect(x0, y0, x1, y1, ch) { for (let y = X(y0); y < X(y1 + 1); y++) for (let x = X(x0); x < X(x1 + 1); x++) put(x, y, ch); },
    ellipse(cx, cy, rx, ry, ch) {
      for (let y = Math.floor((cy - ry) * S); y <= Math.ceil((cy + ry) * S); y++)
        for (let x = Math.floor((cx - rx) * S); x <= Math.ceil((cx + rx) * S); x++) {
          const dx = (x / S - cx) / rx, dy = (y / S - cy) / ry;
          if (dx * dx + dy * dy <= 1.0) put(x, y, ch);
        }
    },
    line(x0, y0, x1, y1, ch, thick = 1) {
      x0 *= S; y0 *= S; x1 *= S; y1 *= S;
      const t = Math.max(1, Math.round(thick * S));
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= steps; i++) {
        const x = x0 + (x1 - x0) * i / steps, y = y0 + (y1 - y0) * i / steps;
        const r = (t - 1) / 2;
        for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) put(Math.round(x + ox), Math.round(y + oy), ch);
      }
    },
    poly(pts0, ch) { // scanline fill
      const pts = pts0.map(([x, y]) => [x * S, y * S]);
      const ys = pts.map((p) => p[1]);
      for (let y = Math.ceil(Math.min(...ys)); y <= Math.floor(Math.max(...ys)); y++) {
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
          const [xa, ya] = pts[i], [xb, yb] = pts[(i + 1) % pts.length];
          if ((ya <= y && yb > y) || (yb <= y && ya > y)) xs.push(xa + (y - ya) * (xb - xa) / (yb - ya));
        }
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2)
          for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) put(x, y, ch);
      }
    },
    // replace ch a with b inside a rect
    recolor(x0, y0, x1, y1, a, b) { for (let y = X(y0); y < X(y1 + 1); y++) for (let x = X(x0); x < X(x1 + 1); x++) if (get(x, y) === a) put(x, y, b); },
    // 1px black outline around everything drawn so far (NES/SFC look)
    outline() {
      const marks = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (get(x, y) !== '.') continue;
        if (get(x - 1, y) !== '.' || get(x + 1, y) !== '.' || get(x, y - 1) !== '.' || get(x, y + 1) !== '.') marks.push([x, y]);
      }
      for (const [x, y] of marks) put(x, y, 'K');
    },
    rows() { return g.map((r) => r.join('')); },
  };
  return api;
}

// ------------------------------------------------------------
// Batter, right-handed, seen from behind the plate (48x67, body in the left 30 columns).
// Stands on the umpire's left in three-quarter front view (chest toward the plate and partly toward us,
// number on the chest), head turned to the pitcher. Posed after the classic plate-umpire's-eye drawing:
// both forearms cross the chest to the hands at the back shoulder, back elbow out behind, legs wide. Four frames:
// stance, check swing (bat tipped forward, held), full swing (bat across the plate), follow-through.
// ------------------------------------------------------------
const BW = 48, BH = 67;
// Same drawing API, every y moved by dy: the crouched stance draws its upper body lower with the same shapes.
function shifted(s, dy) {
  return {
    put: (x, y, ch) => s.put(x, y + dy, ch),
    rect: (x0, y0, x1, y1, ch) => s.rect(x0, y0 + dy, x1, y1 + dy, ch),
    ellipse: (cx, cy, rx, ry, ch) => s.ellipse(cx, cy + dy, rx, ry, ch),
    line: (x0, y0, x1, y1, ch, t) => s.line(x0, y0 + dy, x1, y1 + dy, ch, t),
    poly: (pts, ch) => s.poly(pts.map(([x, y]) => [x, y + dy]), ch),
    recolor: (x0, y0, x1, y1, a, b) => s.recolor(x0, y0 + dy, x1, y1 + dy, a, b),
  };
}
// The umpire stands right behind the catcher, so everything at the plate is drawn 1.4x bigger
// than its design size. The pitcher (far away) stays at 1x. game.js positions assume this.
const NEAR = 1.4;
// Batter heights, as a multiple of the mid batter. game.js scales the strike zone with the same numbers.
const BATTER_SIZES = { short: 0.88, mid: 1, tall: 1.12 };

// Refs: Baseball Stars 2 (Neo Geo) and Clutch Hitter (Sega arcade) behind-the-plate batters.
// Head turned to the pitcher so the face shows in profile, back elbow up and out behind him,
// bat high over the back shoulder, knock-kneed wide stance, front foot toward the plate.
function batterHead(s, cx, cy, turn) {
  s.ellipse(cx, cy, 5.2, 6.2, 'R');                                     // narrow helmet (seen from behind-side)
  s.recolor(cx - 5, cy + 2, cx + 1, cy + 6, 'R', 'r');                 // shadow on the back of the helmet
  s.rect(cx - 3, cy - 4, cx - 2, cy - 4, 'o'); s.rect(cx - 4, cy - 3, cx - 3, cy - 3, 'o'); s.rect(cx - 4, cy - 2, cx - 4, cy - 1, 'o');
  const f = turn ? 1 : 0;                                               // face comes further round as he turns into the pitch
  s.rect(cx + 2 - f, cy + 1, cx + 4 - f, cy + 5, 'R');                  // ear flap (pitcher side)
  s.rect(cx + 3 - f, cy + 5, cx + 4 - f, cy + 5, 'r');
  s.rect(cx + 4 - f, cy + 1, cx + 6, cy + 6, 's');                      // face in profile
  s.put(cx + 7, cy + 3, 's');                                           // nose
  s.rect(cx + 4 - f, cy + 6, cx + 6, cy + 6, 'z');                      // jaw shadow
  s.put(cx + 5, cy + 2, 'K');                                           // eye
  s.rect(cx + 3, cy - 2, cx + 8, cy - 1, 'r'); s.rect(cx + 3, cy - 2, cx + 6, cy - 2, 'R'); // brim toward the pitcher
}

// Torso seen three-quarter from behind: he faces the plate (right), so the chest and belly are the
// right edge, the back (with the number) is toward us. Narrow, with the belly curving out toward
// the plate; the back shoulder (near us) a touch lower than the front one. lean: shoulders toward the plate.
// Torso in three-quarter front view: chest faces the plate (right), the far side (his left, the plate side)
// rounds away. The number goes on the chest below the crossed forearms. lean: shoulders toward the plate.
function batterTorso(s, lean) {
  s.poly([[9 + lean, 19], [27 + lean, 19], [28, 26], [27, 37], [8, 37], [7, 31], [8, 26]], "J");
  s.recolor(7, 19, 9, 37, "J", "j");                                    // back edge rounds off
  s.recolor(26 + lean, 19, 28, 37, "J", "j");                           // and the far shoulder side
  s.rect(8, 37, 27, 38, 'm'); s.rect(18, 37, 19, 38, 'G');              // belt the whole way round + buckle
}

// Stance legs, crouched: the hips sit CROUCH rows lower, the thighs angle out to bent knees and the shins
// drop straight to a wide base. Both cleats point at the plate.
const CROUCH = 3;
function batterLegsStance(s) {
  const y = 37 + CROUCH;                                                // belt line
  s.ellipse(10, y + 5, 4.5, 4, 'W');                                    // hip: the butt rounds out behind him, under the belt
  s.poly([[17, y + 1], [26, y + 1], [30, 50], [22, 50]], 'W');          // front thigh (a step farther: a row higher), knee pushed toward the plate
  s.poly([[22, 50], [30, 50], [29, 58], [22, 58]], 'W');                // front shin
  s.poly([[6, y + 2], [15, y + 2], [19, 52], [11, 52]], 'W');           // back thigh, knee forward
  s.poly([[11, 52], [19, 52], [12, 60], [5, 60]], 'W');                 // back shin kicks back to the heel
  s.recolor(5, y, 7, 60, 'W', 'w'); s.recolor(20, y, 23, 58, 'W', 'w');
  s.line(10, y + 3, 14, 51, 'w'); s.line(21, y + 2, 25, 49, 'w');       // thigh creases
  s.line(12, 52, 18, 52, 'w'); s.line(23, 50, 29, 50, 'w');             // knees
  s.rect(5, 58, 12, 62, 'B'); s.recolor(5, 58, 5, 62, 'B', 'l');        // back stirrup
  s.rect(22, 56, 29, 60, 'B'); s.recolor(22, 56, 22, 60, 'B', 'l');     // front stirrup
  s.rect(3, 62, 16, 64, 'm'); s.rect(3, 63, 16, 63, 'g'); s.rect(15, 62, 16, 63, 'g');   // back cleat: heel behind, toe cap to the plate
  s.rect(20, 60, 33, 62, 'm'); s.rect(20, 61, 33, 61, 'g'); s.rect(32, 60, 33, 61, 'g'); // front cleat, farther: two rows up
}

// Swing legs: hips opened to the pitcher. Front leg braced straight toward the plate, back knee turned in
// and the back heel up, pivoted on the toe.
function batterLegsOpen(s) {
  s.poly([[19, 39], [27, 39], [28, 50], [21, 50]], 'W');                // front thigh
  s.poly([[21, 50], [28, 50], [29, 60], [22, 60]], 'W');                // front shin, straight
  s.ellipse(11.5, 42.5, 4.5, 4, 'W');                                   // hip rounds out behind, under the belt
  s.poly([[8, 39], [17, 39], [18, 49], [12, 49]], 'W');                 // back thigh, knee turned in toward the front leg
  s.poly([[12, 49], [18, 49], [18, 56], [13, 56]], 'W');                // back shin, shorter: heel up
  s.recolor(7, 39, 9, 56, 'W', 'w'); s.recolor(20, 39, 22, 60, 'W', 'w');
  s.line(13, 49, 17, 49, 'w'); s.line(22, 50, 27, 50, 'w');             // knees
  s.rect(13, 54, 18, 58, 'B'); s.recolor(13, 54, 13, 58, 'B', 'l');     // back stirrup
  s.rect(22, 58, 29, 62, 'B'); s.recolor(22, 58, 22, 62, 'B', 'l');     // front stirrup
  s.poly([[13, 58], [18, 58], [20, 63], [16, 63]], 'm'); s.line(17, 59, 19, 62, 'g'); // back foot up on its toe, heel high
  s.rect(21, 62, 33, 64, 'm'); s.rect(21, 63, 33, 63, 'g'); s.rect(32, 62, 33, 63, 'g'); // front cleat planted, toe to the plate
}

// Bat + hands: the bat is drawn first, then two stacked fists on top of its handle so the grip reads
// (fists along the bat, knob just below the lower one), and each forearm ends on a fist.
function batGrip(s, knob, tip) {
  const dx = tip[0] - knob[0], dy = tip[1] - knob[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const fistA = [knob[0] + ux * 3.2, knob[1] + uy * 3.2], fistB = [knob[0] + ux * 7.2, knob[1] + uy * 7.2];
  const bat = () => { s.line(knob[0], knob[1], tip[0], tip[1], 'c', 3); s.line(knob[0] + 0.7, knob[1] - 0.7, tip[0] + 0.7, tip[1] - 0.7, 'b', 1); s.rect(Math.round(knob[0]) - 1, Math.round(knob[1]) - 1, Math.round(knob[0]) + 1, Math.round(knob[1]) + 1, 'b'); };
  const px = -uy, py = ux;                                             // across the bat
  const fists = () => {
    // batting gloves: dark with a knuckle highlight, so the hands never read as part of the jersey
    s.ellipse(fistA[0], fistA[1], 2.2, 2.1, 'm'); s.ellipse(fistB[0], fistB[1], 2.2, 2.1, 'm');
    s.put(Math.round(fistA[0] - px), Math.round(fistA[1] - py), 'g'); s.put(Math.round(fistB[0] - px), Math.round(fistB[1] - py), 'g');
    const mx = (fistA[0] + fistB[0]) / 2, my = (fistA[1] + fistB[1]) / 2;
    s.line(mx - px * 2.4, my - py * 2.4, mx + px * 2.4, my + py * 2.4, 'K', 1);   // gap between the two fists
    const wx = fistA[0] - ux * 2.2, wy = fistA[1] - uy * 2.2;
    s.line(wx - px * 2.2, wy - py * 2.2, wx + px * 2.2, wy + py * 2.2, 'z', 1);   // wrist crease
    s.line(fistB[0] + ux * 2.4, fistB[1] + uy * 2.4, tip[0], tip[1], 'c', 3);     // bat continues above the top fist
    s.line(fistB[0] + ux * 2.4 + 0.7, fistB[1] + uy * 2.4 - 0.7, tip[0] + 0.7, tip[1] - 0.7, 'b', 1);
  };
  return { fistA, fistB, bat, fists };
}

// One arm: a short jersey sleeve from the shoulder to the elbow, then a bare forearm to the fist.
// Each segment gets its own 1px black outline (so it reads even where it crosses the white jersey)
// and a shade line along its lower edge; the elbow is rounded so the two segments join.
// o.noSleeve: the upper arm is hidden behind the body, draw only the forearm from the elbow.
function arm(s, sh, el, fi, o = {}) {
  const sleeve = o.sleeve || 4.3, fore = o.fore || 3;
  const seg = (p, q, ch, shade, thick) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
    let px = -dy / len, py = dx / len;                                   // across the limb
    if (py < 0) { px = -px; py = -py; }                                  // shade goes on the lower side
    s.line(p[0], p[1], q[0], q[1], 'K', thick + 1.5);
    s.line(p[0], p[1], q[0], q[1], ch, thick);
    const off = thick / 2 - 0.6;
    s.line(p[0] + px * off, p[1] + py * off, q[0] + px * off, q[1] + py * off, shade, 1);
  };
  if (!o.noSleeve) {
    seg(sh, el, 'J', 'j', sleeve);
    s.ellipse(el[0], el[1], sleeve / 2 - 0.2, sleeve / 2 - 0.2, 'J');     // sleeve cuff rounds over the elbow
  }
  seg(el, fi, 's', 'z', fore);
  s.ellipse(el[0], el[1], fore / 2 + 0.2, fore / 2 + 0.2, 's');          // elbow
}

function batterStance(sc = 1) {
  const s = grid(BW, BH, NEAR * sc), u = shifted(s, CROUCH);
  const g = batGrip(u, [14, 17], [4, 2]);                               // hands up beside the ear flap, bat nearly upright, tipped back over the shoulder
  g.bat();
  batterTorso(u, 1);
  arm(u, [11, 21], [2, 19], g.fistB, { sleeve: 4.6 });                  // back arm: elbow raised to shoulder height and pointed back, forearm up to the top hand
  arm(u, [26, 20], [25, 30], g.fistA, { sleeve: 3.8, fore: 3 });        // front arm: hangs to an elbow pointing down, forearm up the chest to the bottom hand
  g.fists();
  u.rect(17, 15, 20, 18, 'z');                                          // neck
  batterHead(u, 18, 10, 0);
  batterLegsStance(s);
  s.outline();
  return s.rows();
}

function batterCheck(sc = 1) {                                          // bat tipped toward the pitcher, held
  const s = grid(BW, BH, NEAR * sc), u = shifted(s, CROUCH);
  const g = batGrip(u, [20, 24], [40, 5]);
  batterTorso(u, 1);
  arm(u, [11, 21], [5, 28], g.fistB);                                   // back arm: elbow dropped behind, forearm across to the top hand
  arm(u, [27, 20], [30, 29], g.fistA, { sleeve: 3.8, fore: 3 });        // front arm: elbow down, short forearm up to the bottom hand
  g.bat();
  g.fists();
  u.rect(17, 15, 20, 18, 'z');
  batterHead(u, 18, 10, 1);
  batterLegsStance(s);
  s.outline();
  return s.rows();
}

function batterSwing(sc = 1) {                                          // contact: bat across the plate toward the pitcher, both arms extended
  const s = grid(BW, BH, NEAR * sc);
  const g = batGrip(s, [33, 27], [47, 8]);                              // hands out past the front shoulder; the bat foreshortens toward the pitcher
  batterTorso(s, 2);
  arm(s, [12, 21], [22, 25], g.fistB);                                  // back arm: extended across the chest to the top hand
  arm(s, [27, 20], [31, 25], g.fistA, { sleeve: 3.8, fore: 3 });        // front arm: elbow down, out to the bottom hand
  g.bat();
  g.fists();
  s.rect(19, 15, 22, 18, 'z');
  batterHead(s, 20, 10, 1);
  batterLegsOpen(s);
  s.outline();
  return s.rows();
}

function batterFollow(sc = 1) {                                         // follow-through: hands high at the front shoulder, bat wrapped up over it behind the head
  const s = grid(BW, BH, NEAR * sc);
  const g = batGrip(s, [26, 19], [4, 4]);
  g.bat();                                                              // behind the head: drawn first
  batterTorso(s, 3);
  arm(s, [12, 21], [17, 27], g.fistB);                                  // back arm: across and up to the top hand
  arm(s, [28, 20], [31, 25], g.fistA, { sleeve: 3.8, fore: 3 });        // front arm: folded up to the bottom hand
  s.rect(19, 15, 22, 18, 'z');
  batterHead(s, 20, 10, 1);
  g.fists();                                                            // hands finish in front of the chin
  batterLegsOpen(s);
  s.outline();
  return s.rows();
}

// ------------------------------------------------------------
// Gloves. glove(): a small fielder's glove seen from the back: pad, darker heel, thumb lobe, finger seams.
// mitt(): the catcher's mitt (16x16), round pad with lacing across the fingers and a thumb notch.
// ------------------------------------------------------------
function glove(s, cx, cy, rx, ry) {
  s.ellipse(cx, cy, rx, ry, 'b');
  s.recolor(Math.round(cx), Math.round(cy + 1), Math.round(cx + rx), Math.round(cy + ry), 'b', 'k'); // heel shadow
  s.rect(Math.round(cx - 1), Math.round(cy - ry), Math.round(cx - 1), Math.round(cy - ry + 1), 'c'); // highlight
  s.put(Math.round(cx + 1), Math.round(cy - ry + 1), 'k');                                           // finger seam
  s.ellipse(cx - rx + 0.5, cy + 1, 1.3, 1.6, 'b');                                                   // thumb lobe
  s.put(Math.round(cx - rx + 1.5), Math.round(cy), 'k');
}

function mitt() {
  const s = grid(16, 16, NEAR);
  s.ellipse(8, 7.5, 6.6, 6.4, 'b');
  s.recolor(8, 9, 15, 14, 'b', 'k');                     // heel / shadow side
  s.recolor(2, 12, 7, 14, 'b', 'k');
  for (const fx of [5, 8, 11]) s.rect(fx, 2, fx, 4, 'k');  // finger seams
  s.rect(3, 6, 12, 6, 'c');                               // lace strap across the back
  s.rect(4, 3, 4, 4, 'c'); s.rect(9, 2, 9, 3, 'c');       // highlights
  s.ellipse(2.5, 10, 2, 2.4, 'b');                        // thumb lobe
  s.recolor(1, 11, 4, 12, 'b', 'k');
  s.rect(4, 9, 4, 10, 'K');                               // notch between thumb and pad
  s.outline();
  return s.rows();
}

// ------------------------------------------------------------
// Catcher from behind, crouched. Design size 44x40, drawn at NEAR scale.
// Helmet with mask strap, blue jersey with a 2 on the back, shin guards out to both sides, cleats.
// ------------------------------------------------------------
function catcher() {
  const s = grid(44, 40, NEAR);
  // body: rounded shoulders down to the belt
  s.poly([[9, 11], [34, 11], [41, 16], [42, 23], [1, 23], [2, 16]], 'B');
  s.ellipse(21.5, 13, 13, 4, 'B');
  s.recolor(1, 11, 4, 23, 'B', 'L');                       // lit side
  s.recolor(38, 11, 42, 23, 'B', 'l');                     // shadow side
  // number 2
  s.rect(17, 14, 23, 15, 'W'); s.rect(22, 16, 23, 17, 'W');
  s.rect(20, 18, 21, 18, 'W'); s.rect(19, 19, 20, 19, 'W'); s.rect(18, 20, 19, 20, 'W');
  s.rect(17, 21, 23, 22, 'W');
  // pants + crouch
  s.rect(2, 24, 41, 27, 'g');
  s.rect(1, 28, 6, 30, 'g'); s.rect(37, 28, 42, 30, 'g');
  s.rect(17, 26, 26, 30, 'd');                             // shadow between the legs
  // shin guards (with their own dark edges) and cleats
  for (const gx of [7, 27]) {
    s.rect(gx, 28, gx + 9, 37, 'W');
    s.recolor(gx + 8, 28, gx + 9, 37, 'W', 'w');
    s.rect(gx + 2, 31, gx + 2, 31, 'w'); s.rect(gx + 2, 34, gx + 2, 34, 'w');
    s.vline(gx - 1, 28, 37, 'K'); s.vline(gx + 10, 28, 37, 'K'); s.hline(gx - 1, gx + 10, 28, 'K');
    s.rect(gx, 38, gx + 9, 39, 'm');
  }
  // helmet (back), highlight, mask strap
  s.ellipse(22, 5.5, 8, 5.5, 'N');
  s.rect(16, 2, 17, 3, 'L'); s.rect(15, 3, 15, 4, 'L');
  s.rect(17, 7, 26, 7, 'g'); s.rect(18, 8, 25, 8, 'g'); s.rect(21, 8, 22, 8, 'K');
  s.outline();
  return s.rows();
}

// ------------------------------------------------------------
// Pitcher, front view (he faces the plate), 24x28. Five frames per delivery:
// set, leg kick, cocked (stride + arm back, glove at the batter), release, follow-through.
// Right-hander: throwing arm on the umpire's left. Feet on row 27.
// ------------------------------------------------------------
const PW = 24, PH = 28;
// The pitcher is far away but was reading too small next to the 1.4x plate layer: drawn at 1.3x.
const PITCHER_SCALE = 1.3;

function pitcherHead(s, hx, headY) {                     // hx = left column of the face
  s.ellipse(hx + 3.5, headY + 2, 4.2, 2.8, 'B');
  s.rect(hx, headY + 4, hx + 7, headY + 4, 'l');         // brim
  s.rect(hx + 2, headY, hx + 3, headY + 1, 'L');         // cap highlight
  s.rect(hx, headY + 5, hx + 7, headY + 9, 's');
  s.rect(hx, headY + 9, hx + 7, headY + 9, 'z');
  s.put(hx + 2, headY + 7, 'K'); s.put(hx + 5, headY + 7, 'K');
  s.rect(hx + 3, headY + 10, hx + 4, headY + 10, 'z');
}

function jersey(s, x0, x1, y0, y1, lean = 0) {
  s.poly([[x0, y0], [x1, y0], [x1 - 1 + lean, y1], [x0 + 1 + lean, y1]], 'W');
  s.recolor(x0, y0, x0 + 1, y1, 'W', 'w');
  const mid = Math.round((x0 + x1) / 2);
  s.rect(mid, y0 + 1, mid + 1, y1 - 1, 'w');             // placket
}

function pitcherSet() {
  const s = grid(PW, PH, PITCHER_SCALE);
  jersey(s, 6, 17, 12, 21);
  s.rect(7, 22, 16, 22, 'm');
  s.rect(7, 23, 10, 26, 'g'); s.rect(13, 23, 16, 26, 'g');
  s.recolor(7, 23, 7, 26, 'g', 'd'); s.recolor(13, 23, 13, 26, 'g', 'd');
  s.rect(6, 27, 10, 27, 'K'); s.rect(13, 27, 17, 27, 'K');
  glove(s, 10, 17, 3, 3);   // glove at the belt, hand in it
  s.rect(13, 16, 14, 18, 's');
  pitcherHead(s, 8, 1);
  s.outline();
  return s.rows();
}

function pitcherKick() {                                 // balanced on the back leg, lead knee up
  const s = grid(PW, PH, PITCHER_SCALE);
  jersey(s, 6, 17, 12, 21);
  s.rect(7, 22, 16, 22, 'm');
  s.rect(8, 23, 11, 26, 'g'); s.recolor(8, 23, 8, 26, 'g', 'd'); // back leg, straight
  s.rect(7, 27, 11, 27, 'K');
  s.rect(13, 20, 19, 23, 'g');                           // lead thigh lifted, knee toward us
  s.rect(17, 23, 19, 25, 'g'); s.rect(16, 26, 20, 26, 'K'); // shin hanging, foot
  glove(s, 10, 14, 3, 3);   // glove + hand up at the chest
  s.rect(13, 13, 14, 15, 's');
  pitcherHead(s, 8, 1);
  s.outline();
  return s.rows();
}

function pitcherCock() {                                 // stride, arm cocked back, glove pointing at us
  const s = grid(PW, PH, PITCHER_SCALE);
  jersey(s, 6, 17, 12, 21, 1);
  s.rect(8, 22, 17, 22, 'm');
  s.rect(7, 23, 10, 26, 'g'); s.recolor(7, 23, 7, 26, 'g', 'd');       // back leg
  s.poly([[14, 23], [17, 23], [22, 26], [19, 26]], 'g');              // lead leg out toward us
  s.rect(6, 27, 10, 27, 'K'); s.rect(18, 27, 23, 27, 'K');
  s.line(6, 14, 3, 10, 'W', 3);                                        // upper arm back
  s.line(3, 10, 3, 5, 's', 2);                                         // forearm up behind the head
  s.rect(2, 3, 4, 5, 's');                                             // hand with the ball
  glove(s, 17, 17, 3.5, 3);        // glove thrust at the batter (big, close)
  pitcherHead(s, 8, 1);
  s.outline();
  return s.rows();
}

function pitcherThrow() {                                // release: arm over the top, body tilted to the glove side
  const s = grid(PW, PH, PITCHER_SCALE);
  jersey(s, 7, 18, 12, 21, 1);
  s.rect(9, 22, 18, 22, 'm');
  s.rect(9, 23, 12, 25, 'g'); s.recolor(9, 23, 9, 25, 'g', 'd');       // back leg dragging
  s.rect(8, 26, 12, 26, 'K');
  s.poly([[15, 23], [18, 23], [23, 27], [20, 27]], 'g');              // lead leg planted wide
  s.rect(19, 27, 23, 27, 'K');
  s.line(8, 13, 6, 7, 'W', 3);                                         // arm straight up and over
  s.line(6, 7, 5, 3, 's', 2);
  s.rect(4, 1, 6, 3, 's');                                             // ball hand (release point)
  glove(s, 17, 16, 2.5, 2.5);      // glove tucked in
  pitcherHead(s, 9, 2);
  s.outline();
  return s.rows();
}

function pitcherFollow() {                               // bent forward, arm swung across, back leg kicked up
  const s = grid(PW, PH, PITCHER_SCALE);
  jersey(s, 7, 18, 15, 22, 1);
  s.rect(9, 23, 18, 23, 'm');
  s.rect(10, 24, 13, 25, 'g'); s.rect(9, 26, 13, 26, 'K');            // back foot lifted off the rubber
  s.poly([[15, 24], [18, 24], [23, 27], [20, 27]], 'g');              // lead leg braced
  s.rect(19, 27, 23, 27, 'K');
  s.line(9, 16, 17, 24, 'W', 3);                                       // sleeve across the body
  s.line(14, 21, 19, 25, 's', 2); s.rect(18, 24, 20, 26, 's');         // hand finishing at the far hip
  glove(s, 9, 19, 2.5, 2.5);                                     // glove tucked
  pitcherHead(s, 10, 5);
  s.outline();
  return s.rows();
}

// submarine: same windup, then he drops low and the arm whips under
function pitcherSetUnder() {
  const s = grid(PW, PH, PITCHER_SCALE);
  jersey(s, 5, 18, 15, 22);
  s.rect(6, 23, 17, 23, 'm');
  s.poly([[6, 24], [10, 24], [7, 27], [3, 27]], 'g');
  s.poly([[13, 24], [17, 24], [20, 27], [16, 27]], 'g');
  s.rect(2, 27, 7, 27, 'K'); s.rect(16, 27, 21, 27, 'K');
  glove(s, 10, 19, 3, 2.6);
  s.rect(13, 18, 14, 20, 's');
  pitcherHead(s, 8, 4);
  s.outline();
  return s.rows();
}

function pitcherCockUnder() {                            // dropped low, arm swung back behind the hip
  const s = grid(PW, PH, PITCHER_SCALE);
  jersey(s, 6, 18, 17, 23, 1);
  s.rect(8, 24, 18, 24, 'm');
  s.rect(8, 25, 11, 26, 'g');
  s.poly([[15, 25], [18, 25], [22, 27], [19, 27]], 'g');
  s.rect(7, 27, 11, 27, 'K'); s.rect(18, 27, 23, 27, 'K');
  s.line(7, 19, 2, 20, 'W', 3);                                        // arm straight back, low
  s.line(2, 20, 0, 19, 's', 2);
  glove(s, 17, 19, 3.5, 3);
  pitcherHead(s, 9, 6);
  s.outline();
  return s.rows();
}

function pitcherThrowUnder() {                           // release at the knee, body bent forward
  const s = grid(PW, PH, PITCHER_SCALE);
  jersey(s, 7, 19, 16, 23, 1);
  s.rect(8, 24, 18, 24, 'm');
  s.rect(8, 25, 11, 26, 'g');
  s.poly([[15, 25], [18, 25], [22, 26], [19, 26]], 'g');
  s.rect(7, 27, 11, 27, 'K'); s.rect(18, 27, 22, 27, 'K');
  s.line(10, 18, 6, 23, 'W', 3);                                       // arm sweeping under
  s.line(6, 23, 4, 25, 's', 2);
  s.rect(3, 25, 4, 26, 's');                                           // ball hand (release point)
  glove(s, 18.5, 20, 2.2, 2.4);
  pitcherHead(s, 10, 5);
  s.outline();
  return s.rows();
}

function pitcherFollowUnder() {                          // arm whipped up and across, still low
  const s = grid(PW, PH, PITCHER_SCALE);
  jersey(s, 7, 19, 16, 23, 1);
  s.rect(8, 24, 18, 24, 'm');
  s.rect(9, 25, 12, 25, 'g'); s.rect(8, 26, 12, 26, 'K');
  s.poly([[15, 25], [18, 25], [22, 27], [19, 27]], 'g');
  s.rect(18, 27, 23, 27, 'K');
  s.line(9, 18, 19, 14, 'W', 3);                                       // arm across, finishing high
  s.line(17, 15, 21, 13, 's', 2); s.rect(20, 11, 22, 13, 's');
  glove(s, 9, 21, 2.3, 2.3);
  pitcherHead(s, 10, 5);
  s.outline();
  return s.rows();
}

// The umpire's own left hand with the indicator (clicker), bottom corner of the frame: first-person touch.
function umpHand() {
  const s = grid(26, 14, NEAR);
  s.poly([[13, 5], [25, 3], [25, 13], [13, 13]], "N");                   // navy sleeve coming in from the corner
  s.recolor(13, 10, 25, 13, "N", "l");
  s.rect(24, 3, 25, 13, "w");                                            // shirt cuff
  s.ellipse(8, 8, 6, 4.5, "s");                                          // fist
  s.recolor(2, 9, 14, 12, "s", "z");
  s.rect(3, 1, 9, 5, "K");                                               // indicator
  s.put(4, 2, "W"); s.put(6, 2, "W"); s.put(8, 2, "W"); s.put(4, 4, "W"); s.put(6, 4, "W");
  s.ellipse(11, 5, 2.2, 2, "s");                                         // thumb over it
  s.outline();
  return s.rows();
}

// ------------------------------------------------------------
// Umpire call inset (48x48, bust, facing us). One drawing function, posed by a table: the umpire's
// right arm is on the viewer's left. Strike styles after real MLB "K3 mechanics" (hammer, bow-and-arrow,
// chainsaw, punch-out, disco) plus the Taiwanese windmill; ball styles are the quiet ones.
// ------------------------------------------------------------
function umpBust(pose) {
  const s = grid(48, 48);
  const dx = pose.bx || 0, dy = pose.by || 0;
  const hx = 24 + dx + (pose.hx || 0), hy = 12 + dy + (pose.hy || 0);
  s.poly([[12 + dx, 22 + dy], [36 + dx, 22 + dy], [38 + dx, 40 + dy], [10 + dx, 40 + dy]], 'N'); // shirt
  s.rect(10 + dx, 40 + dy, 38 + dx, 47, 'd');                                                  // pants
  s.rect(16 + dx, 24 + dy, 32 + dx, 36 + dy, 'K');                                             // chest protector
  s.rect(18 + dx, 26 + dy, 20 + dx, 34 + dy, 'm');
  const arm = (sh, el, hd, open) => {
    s.line(sh[0], sh[1], el[0], el[1], 'N', 5);
    s.line(el[0], el[1], hd[0], hd[1], 'N', 5);
    s.ellipse(hd[0], hd[1], open ? 3.3 : 2.8, open ? 2.5 : 2.8, 's');
  };
  if (pose.r) arm([13 + dx, 25 + dy], pose.r[0], pose.r[1], pose.r[2]);
  if (pose.l) arm([35 + dx, 25 + dy], pose.l[0], pose.l[1], pose.l[2]);
  if (pose.brush) { const [bxx, byy] = pose.brush; s.rect(bxx - 3, byy, bxx + 3, byy + 2, 'c'); s.rect(bxx - 1, byy - 2, bxx + 1, byy - 1, 'k'); }
  s.rect(hx - 3, hy + 6, hx + 3, hy + 10, 's');                                                  // neck
  s.ellipse(hx, hy, 7, 7.5, 's');                                                                // face
  s.recolor(hx - 7, hy + 4, hx + 7, hy + 8, 's', 'z');
  s.ellipse(hx, hy - 4, 7.5, 4, 'K'); s.rect(hx - 8, hy - 1, hx + 8, hy, 'd');                   // cap + brim
  if (!pose.blink) { s.put(hx - 3, hy + 1, 'K'); s.put(hx + 3, hy + 1, 'K'); }
  if (pose.mouth) s.rect(hx - 2, hy + 4, hx + 2, hy + 6, 'r'); else s.rect(hx - 2, hy + 5, hx + 2, hy + 5, 'z');
  s.line(hx - 7, hy + 3, hx + 7, hy + 3, 'g'); s.line(hx - 6, hy + 8, hx + 6, hy + 8, 'g');     // mask bars
  s.line(hx - 7, hy - 1, hx - 7, hy + 8, 'g'); s.line(hx + 7, hy - 1, hx + 7, hy + 8, 'g');
  s.outline();
  return s.rows();
}

const KNEES = { r: [[6, 36], [10, 46]], l: [[42, 36], [38, 46]] };
const UMP_POSES = {
  // strike styles
  strike_hammer:   [{ r: [[5, 18], [8, 8]] }, { r: [[4, 24], [9, 17]], mouth: true }],
  strike_bow:      [{ l: [[44, 20], [47, 15], true], r: [[8, 14], [17, 11]] }, { l: [[44, 20], [47, 15], true], r: [[4, 15], [1, 11]], mouth: true }, { l: [[42, 34], [38, 40]], r: [[6, 34], [10, 40]] }],
  strike_chainsaw: [{ r: [[8, 34], [14, 40]], l: [[22, 36], [18, 41]] }, { r: [[4, 20], [4, 10]], l: [[12, 18], [10, 8]], bx: -1, mouth: true }],
  strike_punch:    [{ r: [[8, 30], [18, 27]] }, { r: [[5, 26], [2, 24]], mouth: true }],
  strike_disco:    [{ r: [[9, 12], [12, 2], true], l: [[42, 32], [36, 36]], hx: -1 }, { r: [[9, 12], [12, 2], true], l: [[42, 32], [36, 36]], hx: 1, mouth: true }],
  strike_windmill: [{ r: [[8, 14], [4, 8]] }, { r: [[4, 28], [1, 34]] }, { r: [[14, 38], [20, 44]] }, { r: [[20, 18], [24, 8]] }, { r: [[5, 26], [2, 24]], mouth: true }],
  // ball styles
  ball_stone:  [{ ...KNEES }, { ...KNEES, blink: true }],
  ball_shrug:  [{ r: [[4, 30], [1, 22], true], l: [[44, 30], [47, 22], true], by: -2, hx: 2 }, { r: [[4, 30], [1, 22], true], l: [[44, 30], [47, 22], true], by: -2, hx: -2 }],
  ball_nope:   [{ r: KNEES.r, l: [[42, 30], [36, 30], true] }, { r: KNEES.r, l: [[44, 30], [47, 27], true] }, { r: KNEES.r, l: [[42, 30], [36, 30], true] }],
  ball_shake:  [{ ...KNEES, hx: -3 }, { ...KNEES, hx: 3 }, { ...KNEES, hx: -3 }, { ...KNEES, hx: 0 }],
  ball_duster: [{ by: 6, hy: 2, r: [[8, 40], [12, 46]], brush: [12, 45], l: [[42, 38], [38, 44]] }, { by: 6, hy: 2, r: [[14, 42], [22, 46]], brush: [22, 45], l: [[42, 38], [38, 44]] }],
  ball_bark:   [{ mouth: true, r: KNEES.r, l: [[40, 30], [40, 26], true] }, { mouth: true, r: KNEES.r, l: [[44, 26], [47, 20], true] }],
};
const UMP_OUT = {};
for (const [name, frames] of Object.entries(UMP_POSES)) frames.forEach((p, i) => { UMP_OUT['ump_' + name + '_' + i] = umpBust(p); });

const OUT = {
  ...UMP_OUT,
  mitt: mitt(),
  umpHand: umpHand(),
  catcher: catcher(),
  pitcherSet: pitcherSet(),
  pitcherKick: pitcherKick(),
  pitcherCock: pitcherCock(),
  pitcherThrow: pitcherThrow(),
  pitcherFollow: pitcherFollow(),
  pitcherSetUnder: pitcherSetUnder(),
  pitcherCockUnder: pitcherCockUnder(),
  pitcherThrowUnder: pitcherThrowUnder(),
  pitcherFollowUnder: pitcherFollowUnder(),
  // batter height variants (the strike zone follows: knees to mid-chest). Keys: batter_<size>, batterCheck_<size>...
  ...Object.fromEntries(Object.entries(BATTER_SIZES).flatMap(([size, sc]) => [
    ["batter_" + size, batterStance(sc)], ["batterCheck_" + size, batterCheck(sc)],
    ["batterSwing_" + size, batterSwing(sc)], ["batterFollow_" + size, batterFollow(sc)],
  ])),
};

if (process.argv.includes('--write')) {
  const file = path.join(__dirname, '..', 'sprites.js');
  let src = fs.readFileSync(file, 'utf8');
  for (const [name, rows] of Object.entries(OUT)) {
    const body = rows.map((r) => `    '${r}',`).join('\n');
    const re = new RegExp(`(  ${name}: \\[\\n)[\\s\\S]*?(\\n  \\],)`);
    if (re.test(src)) src = src.replace(re, (m, a, b) => a + body + b);
    else src = src.replace(/\n};\s*$/, `\n  ${name}: [\n${body}\n  ],\n};\n`); // append new sprite
  }
  // drop sprites this generator no longer produces
  for (const old of ["batter", "batterCheck", "batterSwing", "batterFollow"]) {
    src = src.replace(new RegExp(`  ${old}: \\[\\n[\\s\\S]*?\\n  \\],\\n`), "");
  }
  fs.writeFileSync(file, src);
  console.log('sprites.js updated');
} else {
  for (const [name, rows] of Object.entries(OUT)) {
    console.log(`${name} (${rows[0].length}x${rows.length})`);
    console.log(rows.join('\n'));
    console.log();
  }
}
