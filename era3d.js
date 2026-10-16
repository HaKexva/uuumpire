/* UUUMPIRE 3D era: from level 12 the same core.js game is drawn as a 3D ballpark from the umpire's
   eye above the catcher, in the same stage box as the pixel canvas. game.js owns the game, the
   HUD texts, the sounds and the loop; this module only draws the scene and animates the players.
   Models: claudeball (MIT), loaded from `assetsBase` (field, stadium, ball, bat, one player rig).
   three.js comes from the import map in index.html.
   Usage (game.js):  const era = await import('./era3d.js'); const e3 = era.createEra3D({ C, game, stage, canvas2d, assetsBase });
                     e3.onEvent(type, e) from the event dispatcher; e3.frame(dt) from the loop while e3.active; e3.show() / e3.hide(). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/';

export function createEra3D({ C, game, stage, canvas2d, assetsBase = '../uuumpire-3d/assets/', firstLevel = 12 }) {
  const G = game.state;

  // ---- px (168x192 scene) -> metres. Lateral: the 33 px plate is 17 in. Vertical: the mid batter's
  // zone (52 px over the cleats .. 24 px) maps onto 1.00 m .. 0.46 m, which is where a real zone sits.
  const M_LAT = C.IN_PER_PX * 0.0254;
  const M_VERT = 1.0 / 52;
  const PLATE_CX = (68 + 101) / 2;
  const latOf = (x) => (x - PLATE_CX) * M_LAT;
  const hgtOf = (y) => (C.BATTER_FEET_Y - y) * M_VERT;
  const MOUND_Z = -18.44;        // rubber front edge (field.glb, rotated so centre field is -z)
  const PLATE_Z = -0.2;          // where the ball is judged: the middle of the plate (apex at 0)
  const BALL_SCALE = (C.BALL_R * M_LAT) / 0.0369; // the rules' ball is bigger than a real one; keep them consistent
  const CATCHER_X = 0.12;        // the catcher sets up this far toward the batter

  // ------------------------------------------------------------
  // Canvas and renderer: a WebGL canvas laid over the pixel canvas, same CSS box, device resolution
  // ------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.id = 'game3d';
  canvas.style.cssText = 'position:absolute;left:0;top:0;display:none;';
  canvas2d.insertAdjacentElement('afterend', canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06082a);
  scene.fog = new THREE.Fog(0x06082a, 90, 220);
  // the stage is portrait (168:192): a tall window on the same width of plate, aimed low so the
  // horizon sits high like the pixel scene's
  const camera = new THREE.PerspectiveCamera(78, 168 / 192, 0.1, 400);
  // the umpire's eye: right above the catcher's helmet, a small step to the open side (the slot);
  // 1.85 m up and 1 m behind the plate is the lowest eye that still sees the bottom of the zone over the helmet
  const CAM = { x: 0.3, y: 1.85, z: 1.0, lookY: 0.3 };
  // the ABS review: the centre-field broadcast camera, long lens, the zone frame face-on
  const ABS_CAM = { pos: new THREE.Vector3(1.6, 2.4, -11.0), look: new THREE.Vector3(0, 0.8, -0.2), fov: 24 };
  let camMode = 'ump';
  function setCam(mode) {
    camMode = mode;
    // the broadcast camera sits on the side away from the batter, or he would stand between it and the plate
    { camera.position.set(camSide * CAM.x, CAM.y, CAM.z); camera.lookAt(0, CAM.lookY, -3); camera.fov = 78; }
    camera.updateProjectionMatrix();
  }
  let camSide = 1;
  camera.position.set(CAM.x, CAM.y, CAM.z);
  camera.lookAt(0, CAM.lookY, -3);

  function fit() {
    const w = canvas2d.clientWidth, h = canvas2d.clientHeight;
    if (!w || !h) return;
    canvas.style.width = canvas2d.style.width; canvas.style.height = canvas2d.style.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(fit).observe(canvas2d);

  // night game under the towers: an environment fill (PBR needs one), a cool sky fill and two warm lamp
  // banks, the main one behind the plate so the batter, catcher and plate are lit toward the umpire
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.9;
  scene.add(new THREE.HemisphereLight(0xd0dcff, 0x30401c, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0d0, 3.2); sun.position.set(-14, 30, 24); scene.add(sun);
  const back = new THREE.DirectionalLight(0xa0b0ff, 1.6); back.position.set(10, 20, -40); scene.add(back);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.near = 1; sc.far = 120; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -30;
  sun.target.position.set(0, 0, -6); scene.add(sun.target);
  const plateLight = new THREE.PointLight(0xfff4e0, 60, 25, 2); plateLight.position.set(1.5, 6, 6); scene.add(plateLight);

  // the field and stadium share an origin at the plate apex with centre field at +z: turn them round
  const world = new THREE.Group(); world.rotation.y = Math.PI; scene.add(world);

  // zone frame (four bars, visible at any resolution), landing marker, ball shadow
  const zoneBox = new THREE.Group(); scene.add(zoneBox);
  const bar = new THREE.MeshBasicMaterial({ color: 0xf8b800, transparent: true, opacity: 1 });
  for (const [sx, sy, px, py] of [[1, 0.018, 0, 0.5], [1, 0.018, 0, -0.5], [0.018, 1, 0.5, 0], [0.018, 1, -0.5, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.02), bar); m.scale.set(sx, sy, 1); m.position.set(px, py, 0); zoneBox.add(m);
  }
  // the reveal: the ball back at the crossing point inside a blinking ring, and the ABS tick to the nearest edge
  const ring = new THREE.Mesh(new THREE.TorusGeometry(C.BALL_R * M_LAT * 1.5, 0.009, 8, 28), new THREE.MeshBasicMaterial({ color: 0xf8b800 })); scene.add(ring);
  const absTick = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xd82800 })); scene.add(absTick);
  let revealBall = null;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(C.BALL_R * M_LAT, 10), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 })); shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  // ------------------------------------------------------------
  // ABS review (the replay): its own clean scene like the ballpark videoboard graphic. Dark field,
  // the plate, the batter's zone as a translucent plane mid-plate, the tracked path as a trail, the
  // ball frozen where it crossed, a tick to the nearest edge. The view sweeps in from behind the mound.
  // ------------------------------------------------------------
  const abs = new THREE.Scene();
  abs.background = new THREE.Color(0x060b22);
  abs.add(new THREE.HemisphereLight(0xc0d0ff, 0x101830, 1.6));
  { const l = new THREE.DirectionalLight(0xffffff, 1.2); l.position.set(-4, 8, -6); abs.add(l); }
  { const grid = new THREE.GridHelper(60, 60, 0x24387a, 0x14224a); grid.position.y = -0.002; abs.add(grid); }
  { // the plate: 17 in wide pentagon, apex toward the catcher, like the field model
    const w = 17 * 0.0254, sh = new THREE.Shape();
    sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, -w / 2); sh.lineTo(0, -w); sh.lineTo(-w / 2, -w / 2); sh.lineTo(-w / 2, 0);
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: 0xe8ecff })); plate.rotation.x = -Math.PI / 2; plate.position.set(0, 0.002, -0.43); abs.add(plate);
    const mound = new THREE.Mesh(new THREE.CircleGeometry(2.7, 32), new THREE.MeshBasicMaterial({ color: 0x1a2a5c })); mound.rotation.x = -Math.PI / 2; mound.position.set(0, 0.001, MOUND_Z + 0.4); abs.add(mound);
  }
  const absZone = new THREE.Group(); abs.add(absZone);
  {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })); absZone.add(plane);
    const fm = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const [sx, sy, px, py] of [[1, 0.02, 0, 0.5], [1, 0.02, 0, -0.5], [0.02, 1, 0.5, 0], [0.02, 1, -0.5, 0]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.012), fm); m.scale.set(sx, sy, 1); m.position.set(px, py, 0); absZone.add(m); }
  }
  const absPath = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })); abs.add(absPath);
  const absBall = new THREE.Mesh(new THREE.SphereGeometry(C.BALL_R * M_LAT, 14, 10), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x404040 })); abs.add(absBall);
  const absComet = []; for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(C.BALL_R * M_LAT * (0.9 - i * 0.07), 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 - i * 0.04 })); m.visible = false; abs.add(m); absComet.push(m); }
  const absMark = new THREE.Mesh(new THREE.SphereGeometry(C.BALL_R * M_LAT, 14, 10), new THREE.MeshBasicMaterial({ color: 0xf8b800 })); abs.add(absMark);
  const absRing = new THREE.Mesh(new THREE.TorusGeometry(C.BALL_R * M_LAT * 1.6, 0.01, 8, 32), new THREE.MeshBasicMaterial({ color: 0xf8b800 })); abs.add(absRing);
  const absReviewTick = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xd82800 })); abs.add(absReviewTick);
  const absShadow = new THREE.Mesh(new THREE.CircleGeometry(C.BALL_R * M_LAT, 10), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })); absShadow.rotation.x = -Math.PI / 2; abs.add(absShadow);
  // the flight is watched from a fixed high seat behind the mound (whole path in view); on arrival the
  // view cuts in to a 3/4 close-up of the zone, aimed a little above it so it sits under the verdict texts
  const ABS_FROM = new THREE.Vector3(1.4, 3.4, MOUND_Z - 3), ABS_FAR_LOOK = new THREE.Vector3(0, 0.9, -4);
  const ABS_TO = new THREE.Vector3(1.6, 1.6, -2.4), ABS_LOOK = new THREE.Vector3(0, 1.25, PLATE_Z);
  let absHold = false, absZoomT = 0;
  const _look = new THREE.Vector3();
  const absHist = [];
  function buildAbsPath(p) {
    const pts = []; for (let i = 0; i <= 60; i++) { const w = worldAt(p, i / 60); pts.push(new THREE.Vector3(w.x, w.y, w.z)); }
    absPath.geometry.dispose(); absPath.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    const z = p.zone;
    absZone.scale.set((z.x1 - z.x0) * M_LAT, (z.y1 - z.y0) * M_VERT, 1); absZone.position.set(0, (hgtOf(z.y0) + hgtOf(z.y1)) / 2, PLATE_Z);
    absHist.length = 0; for (const m of absComet) m.visible = false;
  }
  function renderAbs(p, dt) {
    const tt = G.phase === 'replay' ? Math.min(1, G.t / p.dur) : 1;
    const arrived = G.replayCaught || G.phase !== 'replay';
    if (arrived) absZoomT += dt;
    const k = Math.min(1, absZoomT / 0.35), e = k * k * (3 - 2 * k);
    camera.position.lerpVectors(ABS_FROM, ABS_TO, e); camera.position.x *= camSide;
    camera.lookAt(_look.lerpVectors(ABS_FAR_LOOK, ABS_LOOK, e)); camera.fov = 22 + 16 * e; camera.updateProjectionMatrix();
    const w = worldAt(p, tt);
    absBall.position.set(w.x, w.y, w.z); absBall.visible = !arrived;
    absShadow.position.set(w.x, 0.003, w.z); absShadow.visible = !arrived;
    if (!arrived) { absHist.unshift(new THREE.Vector3(w.x, w.y, w.z)); if (absHist.length > 40) absHist.pop(); }
    absComet.forEach((m, i) => { const h = absHist[(i + 1) * 3]; if (h && !arrived) { m.visible = true; m.position.copy(h); } else m.visible = false; });
    const cross = worldAt(p, 1);
    absMark.visible = absRing.visible = arrived;
    absMark.position.set(cross.x, cross.y, PLATE_Z); absRing.position.set(cross.x, cross.y, PLATE_Z + 0.02);
    const on = Math.floor(G.t * 8) % 2 === 0; const col = p.strike ? 0xf8b800 : 0xfcfcfc;
    absMark.material.color.set(p.strike ? 0xf8b800 : 0xfcfcfc); absRing.material.color.set(on ? col : 0x6c7490);
    const n = nearestEdgePx(p.zone, p.x, p.y); const ex = latOf(n.x), ey = hgtOf(n.y);
    const len = Math.hypot(ex - cross.x, ey - cross.y);
    absReviewTick.visible = arrived && len > 0.005;
    if (absReviewTick.visible) { absReviewTick.position.set((cross.x + ex) / 2, (cross.y + ey) / 2, PLATE_Z + 0.03); absReviewTick.scale.set(len, 0.014, 0.014); absReviewTick.rotation.z = Math.atan2(ey - cross.y, ex - cross.x); }
    renderer.render(abs, camera);
  }

  // glTF materials: shadows on, nothing metal (the skin and leather metalness textures render black)
  function prepTree(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.isMeshStandardMaterial) { m.metalness = 0; m.metalnessMap = null; m.needsUpdate = true; }
      o.frustumCulled = false; // skinned bounds drift with the clips
    });
  }

  // ------------------------------------------------------------
  // Assets (claudeball): players from one GLB, gear per role, clips by name
  // ------------------------------------------------------------
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setKTX2Loader(new KTX2Loader().setTranscoderPath(CDN + 'examples/jsm/libs/basis/').detectSupport(renderer));
  const gltf = (file) => new Promise((ok, fail) => loader.load(assetsBase + file, ok, undefined, fail));

  const A = {};
  let ball = null, pitcher = null, batter = null, catcher = null, gloveHand = null, glovePocket = null, gloveArm = null, gloveForeArm = null;
  const KITS = [ // batter uniforms, six kits like the pixel game
    { uniform_jersey: 0xf8b800, uniform_pants: 0xfcfcfc, helmet: 0x202060 }, { uniform_jersey: 0xd82800, uniform_pants: 0xd8d8d8, helmet: 0x202020 },
    { uniform_jersey: 0x2038ec, uniform_pants: 0xfcfcfc, helmet: 0x2038ec }, { uniform_jersey: 0x00a800, uniform_pants: 0xe8e8d0, helmet: 0x004000 },
    { uniform_jersey: 0x3c3c3c, uniform_pants: 0xbcbcbc, helmet: 0x3c3c3c }, { uniform_jersey: 0xfcfcfc, uniform_pants: 0x5c94fc, helmet: 0x01215b },
  ];

  class Puppet {
    constructor(gear, colors) {
      this.root = SkeletonUtils.clone(A.player.scene);
      prepTree(this.root);
      const keep = new Set(gear);
      this.nodes = new Map();
      const helper = /^(Elbow_Pole|Ball_Grip|Bat_Grip|Glove_Pocket)/; // rig helpers are meshes in the file: never drawn
      this.root.traverse((o) => { this.nodes.set(o.name, o); if (o.isMesh) o.visible = keep.has(o.name) && !helper.test(o.name); });
      this.recolor(colors);
      this.mixer = new THREE.AnimationMixer(this.root);
      this.actions = new Map();
      for (const clip of A.player.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
      this.current = null;
      scene.add(this.root);
    }
    recolor(colors) {
      this.root.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (colors[m.name] === undefined) continue;
          m.color.set(colors[m.name]);
          if (m.name === 'glove' || m.name === 'glove_laces') { m.map = null; m.roughness = 0.9; m.needsUpdate = true; } // leather photo is near-black: flat tan
        }
      });
    }
    play(name, { loop = false, timeScale = 1, fade = 0.12 } = {}) {
      const a = this.actions.get(name);
      if (!a) return null;
      a.reset(); a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true; a.timeScale = timeScale; a.enabled = true; a.setEffectiveWeight(1);
      if (this.current && this.current !== a) this.current.crossFadeTo(a, fade, false);
      a.play();
      this.current = a;
      return a;
    }
    update(dt) { this.mixer.update(dt); }
  }

  async function loadAll() {
    const [player, field, stadium, ballG, batG, gear] = await Promise.all([
      gltf('player_base.glb'), gltf('field.glb'), gltf('stadium.glb'), gltf('ball.glb'), gltf('bat.glb'),
      fetch(assetsBase + 'gear_defaults.json').then((r) => r.json()),
    ]);
    A.player = player;
    prepTree(field.scene); prepTree(stadium.scene); prepTree(ballG.scene); prepTree(batG.scene);
    world.add(field.scene); world.add(stadium.scene);
    ball = ballG.scene; ball.scale.setScalar(BALL_SCALE); scene.add(ball);
    revealBall = ballG.scene.clone(); revealBall.scale.setScalar(BALL_SCALE); scene.add(revealBall);
    const home = { uniform_jersey: 0xfcfcfc, uniform_pants: 0xfcfcfc, uniform_socks: 0x01215b, cap: 0x01215b, helmet: 0x01215b, piping: 0x01215b, uniform_undershirt: 0x01215b, glove: 0xb8793c, glove_laces: 0xe0c090 };
    pitcher = new Puppet(gear.field, home);
    const catcherGear = gear.catcher.filter((n) => n !== 'Gear_Glove' && n !== 'Gear_Glove_Laces').concat(['Gear_Glove_Catcher', 'Gear_Glove_Catcher_Laces']);
    catcher = new Puppet(catcherGear, home);
    batter = new Puppet(gear.batter, KITS[0]);
    const grip = batter.nodes.get('Bat_Grip') || batter.nodes.get('mixamorigRightHand');
    if (grip) grip.add(batG.scene);
    pitcher.root.position.set(0, 0.254, MOUND_Z - 0.05); // on the rubber (clip root = mound top), facing the plate
    catcher.root.position.set(0, 0, 0.72); catcher.root.rotation.y = Math.PI;
    pitcher.play('pitcher_rock', { loop: true });
    catcher.play('catcher_crouch', { loop: true });
    batter.play('batting_stance', { loop: true });
    gloveHand = catcher.nodes.get('mixamorigLeftHand');
    gloveForeArm = catcher.nodes.get('mixamorigLeftForeArm');
    gloveArm = catcher.nodes.get('mixamorigLeftArm');
    glovePocket = catcher.nodes.get('Glove_Pocket_Catcher') || gloveHand;
    gloveMesh = catcher.nodes.get('Gear_Glove_Catcher') || null;
    if (pendingNext) setupPitch(pendingNext);
  }

  // ------------------------------------------------------------
  // Two-bone IK on the glove arm, run after the mixer has posed the catcher: the upper arm and the
  // forearm rotate so the hand lands on `target` (world), blended by k from where the clip put it.
  // Analytic (law of cosines), elbow kept on the side the clip had it; the wrist then turns the pocket
  // toward the pitcher. Nothing stretches; beyond reach the arm points straight at the target.
  // ------------------------------------------------------------
  const _P = new THREE.Vector3(), _ident = new THREE.Quaternion(), _S = new THREE.Vector3(), _E = new THREE.Vector3(), _H = new THREE.Vector3(), _T = new THREE.Vector3(), _t = new THREE.Vector3(), _dir = new THREE.Vector3(), _pole = new THREE.Vector3(), _E2 = new THREE.Vector3(), _from = new THREE.Vector3(), _to = new THREE.Vector3(), _pq = new THREE.Quaternion(), _rot = new THREE.Quaternion();
  function rotateBoneWorld(bone, from, to) {
    _rot.setFromUnitVectors(from, to);
    bone.parent.getWorldQuaternion(_pq);
    bone.quaternion.premultiply(_pq.clone().invert().multiply(_rot).multiply(_pq));
  }
  function pinGlove(target, k) {
    if (k <= 0) return;
    catcher.root.updateMatrixWorld(true);
    gloveArm.getWorldPosition(_S); gloveForeArm.getWorldPosition(_E); gloveHand.getWorldPosition(_H);
    _T.copy(_H).lerp(target, k);
    const a = _E.distanceTo(_S), b = _H.distanceTo(_E);
    _dir.copy(_T).sub(_S);
    const d = Math.min(_dir.length(), (a + b) * 0.999);
    if (d < 1e-4) return;
    _dir.normalize();
    const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    _pole.copy(_E).sub(_S); _pole.addScaledVector(_dir, -_pole.dot(_dir));
    if (_pole.lengthSq() < 1e-6) _pole.set(0, -1, 0).addScaledVector(_dir, _dir.y);
    _pole.normalize();
    _E2.copy(_S).addScaledVector(_dir, a * cosA).addScaledVector(_pole, a * sinA);
    rotateBoneWorld(gloveArm, _from.copy(_E).sub(_S).normalize(), _to.copy(_E2).sub(_S).normalize());
    catcher.root.updateMatrixWorld(true);
    gloveForeArm.getWorldPosition(_E); gloveHand.getWorldPosition(_H);
    rotateBoneWorld(gloveForeArm, _from.copy(_H).sub(_E).normalize(), _to.copy(_T).sub(_E).normalize());
    catcher.root.updateMatrixWorld(true);
    gloveHand.getWorldPosition(_H); glovePocket.getWorldPosition(_P);
    _from.copy(_P).sub(_H).normalize(); _to.set(0, 0.25, -1).normalize();
    _rot.setFromUnitVectors(_from, _to); _rot.slerp(_ident, 1 - k);
    gloveHand.parent.getWorldQuaternion(_pq);
    gloveHand.quaternion.premultiply(_pq.clone().invert().multiply(_rot).multiply(_pq));
    catcher.root.updateMatrixWorld(true);
  }
  // where the ball sits once caught: the centre of the mitt itself (the skinned mesh's posed bounds),
  // nudged a hair toward the pitcher so the ball shows in the pocket opening
  const _bb = new THREE.Box3();
  let gloveMesh = null;
  function ballInGlove(out) {
    if (gloveMesh && gloveMesh.isSkinnedMesh) {
      gloveMesh.computeBoundingBox();
      gloveMesh.boundingBox.getCenter(out).applyMatrix4(gloveMesh.matrixWorld);
      out.z -= 0.03;
      return out;
    }
    gloveHand.getWorldPosition(_H); glovePocket.getWorldPosition(_P);
    return out.copy(_P).addScaledVector(_H.sub(_P).normalize(), 0.0369 * 0.8);
  }

  // ------------------------------------------------------------
  // Flight in 3D: core.js ballPos's shape (linear + break profile + hump + wobble) in metres, from the
  // pitcher's hand to the exact plate point the rules judged. z runs straight, mound to plate.
  // ------------------------------------------------------------
  function release(p) {
    return { lat: (p.hand === 'R' ? -1 : 1) * 0.55, h: p.form === 'SUBMARINE' ? 0.65 : 1.9, z: MOUND_Z + 1.9 };
  }
  function worldAt(p, t) {
    const r = release(p);
    let l = r.lat + (latOf(p.x) - p.bx * M_LAT - r.lat) * t + p.bx * M_LAT * p.fx(t);
    let h = r.h + (hgtOf(p.y) + p.by * M_VERT - r.h) * t - p.by * M_VERT * p.fy(t) + p.hump * M_VERT * Math.sin(Math.PI * t);
    if (p.wob) { l += p.wob.ax * M_LAT * Math.sin(Math.PI * p.wob.nx * t) * t; h += p.wob.ay * M_VERT * Math.sin(Math.PI * p.wob.ny * t) * t; }
    return { x: l, y: h, z: r.z + (PLATE_Z - r.z) * t };
  }

  // ------------------------------------------------------------
  // Events and frames
  // ------------------------------------------------------------
  // animation cues (seconds before the catch): clip event frames from the claudeball asset notes
  const SWING_TS = 2.0, SWING_CONTACT = 0.875 / SWING_TS, CHECK_HOLD = 0.24, CATCH_LEAD = 0.292;
  const PITCH_RELEASE = 0.583; // pitch_*_windup clips release at this time; scaled onto the rules' windup
  let cue = { swing: false, check: false, catch: false, released: false, stepTo: undefined, stepFrom: 0 };
  let gloveK = 0; // how far the glove is pinned to the ball (eases off at the reveal)
  // nearest point of the zone rectangle (px) to the ball centre: inside, the nearest edge; outside, the clamp
  function nearestEdgePx(z, x, y) {
    const inside = x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1;
    if (!inside) return { x: Math.min(Math.max(x, z.x0), z.x1), y: Math.min(Math.max(y, z.y0), z.y1) };
    const d = [[x - z.x0, z.x0, y, 'x'], [z.x1 - x, z.x1, y, 'x'], [y - z.y0, x, z.y0, 'y'], [z.y1 - y, x, z.y1, 'y']].sort((a, b) => a[0] - b[0])[0];
    return { x: d[1], y: d[2] };
  }
  let pendingNext = null;

  function setupPitch(p) {
    if (!batter) { pendingNext = p; return; }
    pendingNext = null;
    cue = { swing: false, check: false, catch: false, released: false, stepTo: undefined, stepFrom: 0 };
    const hb = C.BATTER_H[p.batterSize];
    batter.root.scale.set(p.batterLeft ? -hb : hb, hb, hb); // a lefty is the mirrored righty
    // deep in the box (feet 1.2 m off the plate's centre line) and a step toward the mound, so from the
    // umpire's eye he stands beside the plate instead of over it
    batter.root.position.set(p.batterLeft ? 1.2 : -1.2, 0, PLATE_Z - 0.2);
    batter.root.rotation.y = p.batterLeft ? -Math.PI / 2 : Math.PI / 2;
    batter.recolor(KITS[p.kit % KITS.length]);
    batter.play('batting_stance', { loop: true, fade: 0.3 });
    pitcher.root.scale.x = p.hand === 'R' ? 1 : -1;
    pitcher.play('pitcher_rock', { loop: true, fade: 0.3 });
    catcher.play('catcher_crouch', { loop: true, fade: 0.3 });
    camSide = p.batterLeft ? -1 : 1; // the slot: the side away from the batter
    absHold = false; absZoomT = 0;
    setCam('ump');
    catcher.root.position.x = p.batterLeft ? CATCHER_X : -CATCHER_X;
    const z = p.zone;
    // the batter's own zone (17 in wide, knees to mid-torso): a ball touching its edge is a strike, so the
    // frame is the real zone, not the grown boundary the rules test against the ball's centre
    zoneBox.scale.set((z.x1 - z.x0) * M_LAT, (z.y1 - z.y0) * M_VERT, 1);
    zoneBox.position.set(0, (hgtOf(z.y0) + hgtOf(z.y1)) / 2, PLATE_Z);
  }

  function onEvent(type, e) {
    switch (type) {
      case 'next': setupPitch(e.pitch); break;
      case 'windup': if (pitcher) pitcher.play(G.pitch.form === 'SUBMARINE' ? 'pitch_submarine_windup' : 'pitch_overhand_windup', { timeScale: PITCH_RELEASE / C.TIMING.windup, fade: 0.15 }); break;
      case 'pitch': cue.released = true; break;
      case 'replay': cue.swing = cue.check = cue.catch = false; buildAbsPath(G.pitch); camMode = 'abs'; absHold = true; absZoomT = 0; break;
      case 'replayEnd': break; // the review stays up through the rest of the reveal
    }
  }

  function frame(dt) {
    if (!batter) return;
    const p = G.pitch;
    const ph = G.phase;
    if (p && (ph === 'replay' || (ph === 'reveal' && absHold))) { renderAbs(p, dt); return; } // the ABS review has its own scene and camera
    const flying = (ph === 'flight' || ph === 'replay') && G.ball && !(ph === 'replay' && G.replayCaught);
    const reveal = ph === 'reveal';
    const tt = flying ? Math.min(1, G.t / p.dur) : 1;
    const b = flying ? worldAt(p, tt) : null;
    pitcher.update(dt); batter.update(dt); catcher.update(dt);
    // the glove goes to where the ball will cross (lead-in eases it there), then holds the ball through
    // the call window, drifting with the rules' framing tug; the ball sits in the pocket
    const caught = ph === 'call' || (ph === 'replay' && G.replayCaught);
    if (p && (cue.catch || caught || reveal)) {
      const gx = G.ball ? latOf(G.ball.x) : latOf(p.x), gy = G.ball ? hgtOf(G.ball.y) : hgtOf(p.y);
      const k = caught ? 1 : reveal ? 0 : THREE.MathUtils.clamp(1 - (p.dur - G.t) / CATCH_LEAD, 0, 1);
      gloveK = reveal ? Math.max(0, gloveK - dt * 3) : k * k; // the catcher eases the mitt back once the call is in
      if (cue.stepTo !== undefined && !reveal) { const ease = k * k * (3 - 2 * k); catcher.root.position.x = cue.stepFrom + (cue.stepTo - cue.stepFrom) * ease; }
      pinGlove(_t.set(gx, gy, PLATE_Z + 0.12), gloveK);
    } else gloveK = 0;
    if (flying && b && (cue.released || ph === 'replay')) {
      ball.visible = true; ball.scale.setScalar(BALL_SCALE); ball.position.set(b.x, b.y, b.z); ball.rotation.x += dt * (p.spin + 2) * 2;
      shadow.visible = true; shadow.position.set(b.x, 0.02, b.z); shadow.scale.setScalar(1 + b.y * 0.6);
    } else if (p && caught) {
      ballInGlove(ball.position); ball.scale.setScalar(1); ball.visible = true; shadow.visible = false; // real size: the rules' ball would not fit a mitt
    } else { ball.visible = false; shadow.visible = false; }
    // level 12 keeps the zone up through the pitch as a guide; from 13 it only comes back at the reveal,
    // so the catcher's framing can sell a ball as a strike
    const guide = G.level === firstLevel && (ph === 'windup' || flying || ph === 'call');
    zoneBox.visible = reveal || guide;
    if (camMode === 'abs') setCam('ump');
    bar.opacity = reveal ? 1 : 0.55;
    // reveal: the ball where it really crossed, a ring blinking gold (strike) / white (ball) like the pixel
    // scene, and the ABS tick from the ball to the nearest zone edge when the readout is on
    revealBall.visible = reveal; ring.visible = reveal;
    const showAbs = reveal && G.result && G.result.abs && G.t > 0.3;
    absTick.visible = showAbs;
    if (reveal) {
      const w = worldAt(p, 1);
      revealBall.position.set(w.x, w.y, PLATE_Z); revealBall.rotation.y += dt * 0.8;
      ring.position.set(w.x, w.y, PLATE_Z + 0.02);
      const on = Math.floor(G.t * 6) % 2 === 0; ring.material.color.set(on ? (p.strike ? 0xf8b800 : 0xfcfcfc) : 0x7c7c7c);
      if (showAbs) {
        const n = nearestEdgePx(p.zone, p.x, p.y);
        const ex = latOf(n.x), ey = hgtOf(n.y);
        const len = Math.max(0.01, Math.hypot(ex - w.x, ey - w.y));
        absTick.position.set((w.x + ex) / 2, (w.y + ey) / 2, PLATE_Z + 0.03);
        absTick.scale.set(len, 0.012, 0.012);
        absTick.rotation.z = Math.atan2(ey - w.y, ex - w.x);
      }
    }
    // cues timed back from the catch: the catcher reaches (and side-steps on a wide one), the batter swings or checks
    if (flying) {
      const left = p.dur - G.t;
      if (!cue.catch && left <= CATCH_LEAD) {
        cue.catch = true;
        const h = hgtOf(p.y);
        catcher.play(h > 1.05 ? 'catch_pitch_high' : h < 0.55 ? 'catch_pitch_low' : 'catch_pitch', { fade: 0.08 });
        const base = p.batterLeft ? CATCHER_X : -CATCHER_X;
        cue.stepFrom = catcher.root.position.x;
        cue.stepTo = base + THREE.MathUtils.clamp(latOf(p.x) - base, -0.35, 0.35) * 0.85;
      }
      if (p.swing === 'full' && !cue.swing && left <= SWING_CONTACT) { cue.swing = true; batter.play('swing', { timeScale: SWING_TS, fade: 0.05 }); }
      if (p.swing === 'check' && !cue.check && left <= SWING_CONTACT) { cue.check = true; const a = batter.play('swing', { timeScale: SWING_TS, fade: 0.05 }); setTimeout(() => { if (a) a.paused = true; }, CHECK_HOLD * 1000); }
    }
    renderer.render(scene, camera);
  }

  const api = {
    active: false,
    ready: loadAll(),
    onEvent, frame,
    debug() { return { batter, catcher, pitcher, camera, scene, ball }; },
    show() { if (api.active) return; api.active = true; fit(); canvas.style.display = 'block'; canvas2d.style.visibility = 'hidden'; },
    hide() { if (!api.active) return; api.active = false; canvas.style.display = 'none'; canvas2d.style.visibility = ''; },
  };
  return api;
}
