/* 3D 晶圓廠無塵室（第十章）
 * - 製程機台：依製程區上色的色帶、朝走道的操作螢幕與晶圓盒上下貨口（load port），頂上的三色警示燈 = 狀態
 *   （綠 = 自動化生產、黃 = 人工操作 / 等待、紅 = 停機或中毒）；還沒進廠的位置是地上的黃色膠帶框
 * - 天花板的天車（OHT）軌道與天車，吊著晶圓盒（FOUP）在各 bay 之間搬運；產線停了天車就停
 * - 黃光區的黃色燈光（曝光製程怕一般光線）、穿無塵衣的操作員（手上是公司配發、沒有相機的手持裝置）
 * - 支援區：入口的安檢門（金屬探測）、更衣室的手機置物櫃、風淋室、機台進廠掃毒站、控制室的大螢幕
 * 由 floor3d 在晶圓廠樓層呼叫：M3.fab(ctx) → { sync(st), tick(dt, t), tip(p), dispose(), kinds }
 */
(function (G) {
  'use strict';
  const U = G.U, M3 = G.M3, CAT = G.CAT;
  if (!M3) return;
  const noop = () => {};
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const HGT = { scanner: 2.7, track: 2.1, etch: 2.3, cvd: 2.4, pvd: 2.4, ald: 2.3, furnace: 3.1, rtp: 1.9, implant: 2.6, cmp: 2.1, wet: 1.9, cdsem: 2.1, thick: 1.7, overlay: 1.9, inspect: 2.2, stocker: 3.3 };
  const OHT_Y = 3.2;

  M3.fab = (ctx) => {
    const { api, K, L, root, wx, wz } = ctx;
    if (!L.tools) return null;
    const T = api.T, W = L.W, H = L.H;
    const C = (hex) => K.col(hex);
    const dummy = new T.Object3D();
    const mats = [], geos = [], tags = [];
    const own = (m) => { mats.push(m); return m; };
    const geo = (x) => { geos.push(x); return x; };
    const tag = (text, cls, align, prio) => { const x = api.tag(text, cls, align, prio); tags.push(x); return x; };
    const kbox = (w, hh, d, m) => { const b = K.box(w, hh, d, m); geos.push(b.geometry); return b; };
    const g = new T.Group();
    root.add(g);
    const Fab = G.Fab;
    const unit = geo(new T.BoxGeometry(1, 1, 1));
    const mkInst = (geom, n, mat, pick) => {
      const m = new T.InstancedMesh(geom, mat, Math.max(1, n));
      m.frustumCulled = false;
      if (pick) { m.userData.pick = pick; m.userData.pickPoint = true; } else m.raycast = noop;
      g.add(m);
      return m;
    };
    const setM = (im, i, x, y, z, sx, sy, sz) => { dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); };
    const hide = (im, i) => setM(im, i, 0, -50, 0, 0.001, 0.001, 0.001);
    const cw = (x) => x - W / 2, cz = (y) => y - H / 2;

    /* ---------- 機台 ---------- */
    const tools = L.tools, N = tools.length;
    const TG = tools.map((t) => {
      const x = (wx(t.x0) + wx(t.x1)) / 2, z = (wz(t.y0) + wz(t.y1)) / 2;
      const w = t.x1 - t.x0 + 1 - 0.3, d = t.y1 - t.y0 + 1 - 0.3;
      return { t, x, z, w, d, h: HGT[t.type] || 2.2, face: t.side === 'W' ? 1 : -1 };
    });
    const bodyM = mkInst(unit, N, own(K.std('#ffffff', { metalness: 0.25, roughness: 0.45 })), { kind: 'tool' });
    const bandM = mkInst(unit, N, own(K.std('#ffffff', { metalness: 0.1, roughness: 0.6 })), { kind: 'tool' });
    const scrM = mkInst(unit, N, own(new T.MeshBasicMaterial({ color: 0xffffff })), { kind: 'tool' });
    const portM = mkInst(unit, N * 2, own(K.std('#c3c9ce', { metalness: 0.45, roughness: 0.4 })), null);
    const lampM = mkInst(geo(new T.CylinderGeometry(0.08, 0.08, 0.13, 10)), N * 3, own(new T.MeshBasicMaterial({ color: 0xffffff })), null);
    const poleM = mkInst(unit, N, own(K.std('#5a6167', { metalness: 0.5 })), null);
    const decalM = mkInst(unit, N, own(K.std('#e8c547', { roughness: 0.8 })), { kind: 'slot' });
    TG.forEach((q, i) => {
      const area = CAT.fab.areas[CAT.fab.types[q.t.type].area];
      bodyM.setColorAt(i, C(q.t.type === 'stocker' ? '#cfd5da' : q.t.type === 'scanner' || q.t.type === 'implant' ? '#e6e9ec' : '#f1f3f5'));
      bandM.setColorAt(i, C(area.color));
      scrM.setColorAt(i, C('#1a2228'));
    });
    const LAMP = { g: [C('#1f5b36'), C('#46e27a')], y: [C('#5e4a14'), C('#ffcf3a')], r: [C('#5a1f1c'), C('#ff4d3d')] };
    const SCR = { off: C('#1a2228'), on: C('#8fd3ff'), red: C('#ff4a3d'), amber: C('#f0a63a') };
    let toolSig = '', blinkIdx = [];
    function paintTools() {
      const F = G.S.fab, R = G.R.fab;
      const sig = F.tools.map((x, i) => { const inf = x.st === 'online' ? Fab.info(i) : null; return x.st[0] + (x.down ? 'd' : '') + (inf ? (inf.run ? (inf.eapOk ? 'a' : 'm') : 'x') : ''); }).join('') + (R && R.up ? 'u' : 'n');
      if (sig === toolSig) return;
      toolSig = sig;
      blinkIdx = [];
      TG.forEach((q, i) => {
        const x = F.tools[i];
        const here = x && x.st !== 'coming';
        if (!here) {
          [bodyM, bandM, scrM, poleM].forEach((m) => hide(m, i));
          hide(portM, i * 2); hide(portM, i * 2 + 1);
          for (let k = 0; k < 3; k++) hide(lampM, i * 3 + k);
          setM(decalM, i, q.x, 0.012, q.z, q.w, 0.02, q.d);
          return;
        }
        hide(decalM, i);
        setM(bodyM, i, q.x, q.h / 2, q.z, q.w, q.h, q.d);
        setM(bandM, i, q.x, q.h * 0.74, q.z, q.w + 0.03, 0.2, q.d + 0.03);
        setM(scrM, i, q.x + q.face * (q.w / 2 + 0.012), 1.45, q.z - q.d * 0.22, 0.02, 0.36, Math.min(0.55, q.d * 0.3));
        setM(portM, i * 2, q.x + q.face * (q.w / 2 + 0.2), 0.95, q.z + q.d * 0.12, 0.38, 0.32, 0.42);
        setM(portM, i * 2 + 1, q.x + q.face * (q.w / 2 + 0.2), 0.95, q.z + q.d * 0.36, 0.38, 0.32, 0.42);
        const lx = q.x + q.face * (q.w / 2 - 0.18), lz = q.z + q.d / 2 - 0.22;
        setM(poleM, i, lx, q.h + 0.06, lz, 0.04, 0.12, 0.04);
        /* 三色燈：下綠、中黃、上紅 */
        let on = null, blink = false, scr = SCR.off;
        if (x.down) { on = 'r'; blink = true; scr = SCR.red; }
        else if (x.st === 'online') {
          const inf = Fab.info(i);
          if (!inf.run) { on = 'r'; scr = SCR.amber; } else if (inf.eapOk) { on = 'g'; scr = SCR.on; } else { on = 'y'; scr = SCR.on; }
        } else if (x.st === 'install') on = 'y';
        else { on = 'y'; blink = true; }
        ['g', 'y', 'r'].forEach((c, k) => {
          setM(lampM, i * 3 + k, lx, q.h + 0.18 + k * 0.14, lz, 1, 1, 1);
          lampM.setColorAt(i * 3 + k, LAMP[c][on === c ? 1 : 0]);
        });
        scrM.setColorAt(i, scr);
        if (blink) blinkIdx.push({ i: i * 3 + ['g', 'y', 'r'].indexOf(on), c: on });
      });
      for (const m of [bodyM, bandM, scrM, portM, lampM, poleM, decalM]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    }

    /* ---------- 天車（OHT）軌道與天車 ---------- */
    const railM = own(K.std('#aab2b8', { metalness: 0.6, roughness: 0.35 }));
    for (const r of L.oht) {
      const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
      const b = kbox(r.x1 !== r.x0 ? len : 0.14, 0.1, r.y1 !== r.y0 ? len : 0.14, railM);
      b.position.set(cw((r.x0 + r.x1) / 2), OHT_Y, cz((r.y0 + r.y1) / 2));
      b.userData.pick = { kind: 'oht' };
      g.add(b);
    }
    const spurs = L.oht.filter((r) => !r.main), main = L.oht.find((r) => r.main);
    const NV = spurs.length + 3;
    const vehM = mkInst(unit, NV, own(K.std('#d7dce0', { metalness: 0.4, roughness: 0.4 })), { kind: 'oht' });
    const foupM = mkInst(unit, NV, own(K.std('#f07b2e', { metalness: 0.1, roughness: 0.5 })), { kind: 'oht' });
    const veh = [];
    spurs.forEach((r, k) => veh.push({ r, k, ph: hash(k * 3.1) * 6, sp: 0.25 + hash(k * 1.7) * 0.15, spur: true }));
    for (let k = 0; k < 3; k++) veh.push({ r: main, k: k + spurs.length, ph: k * 2.1, sp: 0.08 + k * 0.015, spur: false });
    let ohtT = 0;

    /* ---------- 黃光區：黃色燈光（曝光製程怕一般光線裡的藍紫光） ---------- */
    const litho = L.bays.find((b) => b.id === 'N1');
    if (litho) {
      const vol = kbox(litho.x1 - litho.x0 + 1, 3.1, litho.y1 - litho.y0 + 1, own(new T.MeshBasicMaterial({ color: C('#f5c842'), transparent: true, opacity: 0.07, depthWrite: false })));
      vol.position.set((wx(litho.x0) + wx(litho.x1)) / 2, 1.55, (wz(litho.y0) + wz(litho.y1)) / 2);
      vol.raycast = noop;
      vol.renderOrder = 2;
      g.add(vol);
      const lampY = own(K.glow('#ffd24a', 1.3));
      for (let z = litho.y0 + 1; z <= litho.y1 - 1; z += 3) { const p = kbox(0.35, 0.05, 1.6, lampY); p.position.set((wx(litho.x0) + wx(litho.x1)) / 2, 3.28, wz(z)); p.raycast = noop; g.add(p); }
      const lt = tag('黃光區（曝光製程怕藍光，照明是黃色的）', 'info', 'center', 0);
      lt.pos.set((wx(litho.x0) + wx(litho.x1)) / 2, 3.9, (wz(litho.y0) + wz(litho.y1)) / 2);
    }

    /* ---------- 支援區：安檢門、手機置物櫃、風淋室、掃毒站、控制室大螢幕 ---------- */
    const room = (flag) => L.rooms.find((r) => r[flag]);
    const metalM = own(K.std('#b8bfc5', { metalness: 0.6, roughness: 0.35 }));
    /* 安檢門：更衣室入口前的金屬探測門 */
    const gateG = new T.Group();
    {
      const gx = wx(5), gz = wz(7) - 0.1;
      for (const dx of [-0.55, 0.55]) { const p = kbox(0.18, 2.2, 0.45, metalM); p.position.set(gx + dx, 1.1, gz); gateG.add(p); }
      const top = kbox(1.3, 0.22, 0.5, metalM); top.position.set(gx, 2.3, gz); gateG.add(top);
      gateG.userData.pick = { kind: 'gate' };
      g.add(gateG);
    }
    const gateLed = new T.Mesh(geo(new T.SphereGeometry(0.07, 10, 8)), own(new T.MeshBasicMaterial({ color: C('#46e27a') })));
    gateLed.position.set(wx(5), 2.45, wz(7) - 0.1);
    gateLed.raycast = noop;
    g.add(gateLed);
    const gateTag = tag('', 'info', 'center', 1);
    gateTag.pos.set(wx(5), 3.1, wz(6));
    /* 手機置物櫃：更衣室的北牆與西牆 */
    const lk = room('lockers');
    const lockerM = own(K.std('#7f98ab', { metalness: 0.35, roughness: 0.5 }));
    const lockG = new T.Group();
    const lockSlots = [];
    if (lk) {
      for (let x = lk.x0 + 1; x <= lk.x1 - 2; x++) if (x < 4 || x > 6) lockSlots.push([wx(x), wz(lk.y0 + 1) - 0.2, 0]);
      for (let y = lk.y0 + 3; y <= lk.y1 - 2; y++) lockSlots.push([wx(lk.x0 + 1) - 0.2, wz(y), 1]);
      for (const [x, z, rot] of lockSlots) {
        const b = kbox(rot ? 0.5 : 0.92, 1.9, rot ? 0.92 : 0.5, lockerM);
        b.position.set(x, 0.95, z);
        lockG.add(b);
      }
      lockG.userData.pick = { kind: 'locker' };
      g.add(lockG);
    }
    const lockLed = mkInst(geo(new T.SphereGeometry(0.035, 8, 6)), lockSlots.length * 4, own(new T.MeshBasicMaterial({ color: C('#46e27a') })), null);
    lockSlots.forEach(([x, z, rot], i) => {
      for (let k = 0; k < 4; k++) {
        const off = (k % 2 ? 0.2 : -0.2), yy = 0.55 + Math.floor(k / 2) * 0.8;
        setM(lockLed, i * 4 + k, x + (rot ? 0.26 : off), yy, z + (rot ? off : 0.26), 1, 1, 1);
      }
    });
    lockLed.count = 0;
    /* 風淋室 */
    const sh = room('shower');
    if (sh) {
      /* 兩側牆上一排排的噴嘴：進無塵室前用高速氣流吹掉身上的灰塵 */
      const nozM = own(K.std('#dfe3e6', { metalness: 0.6 }));
      for (const [zw, dz] of [[wz(sh.y0) + 0.5, 0.05], [wz(sh.y1) - 0.5, -0.05]]) {
        for (let y = 0.6; y <= 2.2; y += 0.4) for (let x = sh.x0 + 1; x <= sh.x1 - 1; x++) { const n = kbox(0.14, 0.07, 0.07, nozM); n.position.set(wx(x), y, zw + dz); n.raycast = noop; g.add(n); }
      }
      const st = tag('風淋室', '', 'center', 0);
      st.pos.set((wx(sh.x0) + wx(sh.x1)) / 2, 2.8, (wz(sh.y0) + wz(sh.y1)) / 2);
    }
    /* 掃毒站：原廠的筆電、USB、安裝光碟先掃過才能帶進廠 */
    const sc = room('scan');
    const kioskG = new T.Group();
    let kioskScr = null;
    if (sc) {
      const kx = (wx(sc.x0) + wx(sc.x1)) / 2, kz = (wz(sc.y0) + wz(sc.y1)) / 2;
      const body = kbox(0.7, 1.5, 0.5, own(K.std('#e9ecef', { metalness: 0.3, roughness: 0.5 })));
      body.position.set(kx - 1.2, 0.75, kz);
      kioskScr = new T.Mesh(geo(new T.PlaneGeometry(0.5, 0.4)), own(new T.MeshBasicMaterial({ color: C('#46e27a') })));
      kioskScr.position.set(kx - 1.2, 1.25, kz + 0.255);
      const table = kbox(1.4, 0.06, 0.7, own(K.std('#d9d3c5', { roughness: 0.6 })));
      table.position.set(kx + 0.6, 0.75, kz);
      const laptop = kbox(0.45, 0.03, 0.32, own(K.std('#2b3238', { metalness: 0.4 })));
      laptop.position.set(kx + 0.45, 0.8, kz);
      const usb = kbox(0.12, 0.04, 0.05, own(K.std('#f2c14e')));
      usb.position.set(kx + 0.95, 0.8, kz + 0.1);
      kioskG.add(body, kioskScr, table, laptop, usb);
      kioskG.userData.pick = { kind: 'kiosk' };
      g.add(kioskG);
    }
    const kioskTag = tag('', 'info', 'center', 1);
    if (sc) kioskTag.pos.set((wx(sc.x0) + wx(sc.x1)) / 2, 2.6, (wz(sc.y0) + wz(sc.y1)) / 2);
    /* 控制室：MES / 天車監控的大螢幕 */
    const cr = room('control');
    let wallScr = null;
    if (cr) {
      const wallT = K.makeTex(512, 160, (c) => {
        K.D.rect(c, 0, 0, 512, 160, '#0d141a');
        K.D.txt(c, 'MES · WIP · OHT', 256, 30, 22, '#8fd3ff', 'center', 700);
        for (let k = 0; k < 8; k++) K.D.rect(c, 20 + k * 60, 60, 48, 70, k % 3 ? '#1f5b36' : '#2a4a6a');
      }, 1);
      wallScr = new T.Mesh(geo(new T.PlaneGeometry(6, 1.9)), own(K.texMat(wallT, { metalness: 0, roughness: 0.5, emissive: C('#ffffff'), emissiveIntensity: 0.35 })));
      wallScr.position.set((wx(cr.x0) + wx(cr.x1)) / 2, 1.9, wz(cr.y0 + 1) - 0.35);
      wallScr.userData.pick = { kind: 'vwall' };
      g.add(wallScr);
      geos.push(wallT);
    }

    /* ---------- 操作員（無塵衣）：在主走道與 bay 裡走來走去 ---------- */
    const WALK = 26;
    const bodyG = geo(new T.CylinderGeometry(0.17, 0.21, 1.0, 10)); bodyG.translate(0, 0.9, 0);
    const headG = geo(new T.SphereGeometry(0.14, 12, 9)); headG.translate(0, 1.55, 0);
    const visorG = geo(new T.BoxGeometry(0.2, 0.07, 0.04)); visorG.translate(0, 1.57, 0.12);
    const devG = geo(new T.BoxGeometry(0.12, 0.17, 0.02)); devG.translate(0, 1.18, 0.26);
    const suitM = own(K.std('#f4f6f8', { roughness: 0.85 }));
    const pB = mkInst(bodyG, WALK, suitM, { kind: 'fabop' });
    const pH = mkInst(headG, WALK, suitM, { kind: 'fabop' });
    const pV = mkInst(visorG, WALK, own(K.std('#2b3a48', { metalness: 0.4, roughness: 0.3 })), null);
    const pD = mkInst(devG, WALK, own(new T.MeshBasicMaterial({ color: 0xffffff })), null);
    const AISLE = 17.5;
    const bayX = L.bays.map((b) => ({ x: b.x0 + 5, y0: b.north ? b.y0 + 1 : b.y0 + 1, y1: b.north ? b.y1 : b.y1 - 1 }));
    const randPt = () => {
      if (Math.random() < 0.3) return [17.5 + Math.random() * 52, AISLE];
      const b = bayX[Math.floor(Math.random() * bayX.length)];
      return [b.x + (Math.random() - 0.5) * 2.4, b.y0 + Math.random() * (b.y1 - b.y0)];
    };
    const walkers = [];
    function route(a, b) {
      const pts = [a];
      if (Math.abs(a[1] - AISLE) > 0.3) pts.push([a[0], AISLE]);
      if (Math.abs(b[1] - AISLE) > 0.3) pts.push([b[0], AISLE]);
      pts.push(b);
      const segs = [];
      let len = 0;
      for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); len += d; }
      return { pts, segs, len, s: 0 };
    }
    const newWalker = (from) => { const a = from || randPt(); const w = route(a, randPt()); w.v = 0.7 + Math.random() * 0.4; return w; };
    const tmp = [0, 0, 0];
    function posOn(w, out) {
      let d = w.s;
      for (let i = 0; i < w.segs.length; i++) {
        if (d <= w.segs[i] || i === w.segs.length - 1) {
          const k = w.segs[i] > 0 ? U.clamp(d / w.segs[i], 0, 1) : 1;
          const a = w.pts[i], b = w.pts[i + 1];
          out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = Math.atan2(b[0] - a[0], b[1] - a[1]);
          return out;
        }
        d -= w.segs[i];
      }
      return out;
    }
    const DEV = { hand: C('#46e27a'), phone: C('#20262b') };

    let prodK = 0, wantWalk = 0, phone = 'allow', hand = 0;
    return {
      kinds: ['tool', 'slot', 'oht', 'gate', 'locker', 'kiosk', 'vwall', 'fabop'],
      sync(st) {
        const s = G.S, F = s.fab;
        if (!F) return;
        paintTools();
        const R = G.R.fab;
        prodK = R && R.rate > 0 ? U.clamp(R.rate / CAT.fab.wspd, 0.25, 1) : 0;
        phone = F.phone; hand = F.hand;
        const present = st ? st.present || 0 : 0;
        wantWalk = Math.min(WALK, Math.round(present / 5));
        /* 安檢門與置物櫃：買了才出現；禁止手機時置物櫃亮燈（手機在裡面充電） */
        const gateOn = F.gate > 0, gateReady = Fab.gateReady();
        gateG.visible = gateOn; gateLed.visible = gateReady; lockG.visible = gateOn;
        gateLed.material.color.copy(C(F.phone === 'ban' ? '#46e27a' : '#f0a63a'));
        lockLed.count = gateReady && F.phone === 'ban' ? lockSlots.length * 4 : 0;
        gateTag.set(!gateOn ? '（還沒有安檢門：私人手機可以直接帶進無塵室）' : !gateReady ? '安檢門與置物櫃施工中' : F.phone === 'ban' ? '安檢門 · 私人手機一律鎖在置物櫃' : '安檢門已裝好，但還允許帶手機進去', !gateOn || F.phone !== 'ban' ? 'warn' : 'info');
        kioskG.visible = F.kiosk > 0;
        if (kioskScr) kioskScr.material.color.copy(C(Fab.kioskReady() ? '#46e27a' : '#f0a63a'));
        const c = Fab.counts();
        kioskTag.set(F.kiosk > 0 ? (Fab.kioskReady() ? `機台進廠掃毒站${c.scan ? ` · 排隊 ${c.scan} 台` : ''}` : '機台進廠掃毒站（施工中）') : `（還沒有掃毒站${c.scan ? `：${c.scan} 台機台在等` : ''}）`, F.kiosk > 0 ? 'info' : c.scan ? 'warn' : '');
      },
      tick(dt, t) {
        const s = G.S, speed = Math.max(1, Math.min(4, s.speed || 1));
        /* 三色燈閃爍 */
        if (blinkIdx.length) {
          const on = Math.sin(t * 6) > 0;
          for (const b of blinkIdx) lampM.setColorAt(b.i, LAMP[b.c][on ? 1 : 0]);
          lampM.instanceColor.needsUpdate = true;
        }
        /* 天車：產線在跑才動，吊著晶圓盒 */
        ohtT += dt * prodK * Math.min(speed, 2.5);
        veh.forEach((v, i) => {
          const r = v.r;
          const u = 0.5 - 0.5 * Math.cos(ohtT * v.sp * 2 * Math.PI * 0.35 + v.ph);
          const x = r.x0 + (r.x1 - r.x0) * u, y = r.y0 + (r.y1 - r.y0) * u;
          const along = r.x1 !== r.x0;
          setM(vehM, i, cw(x), OHT_Y - 0.28, cz(y), along ? 0.7 : 0.5, 0.36, along ? 0.5 : 0.7);
          const loaded = Math.sin(ohtT * v.sp * 2 * Math.PI * 0.35 + v.ph) > 0;
          if (loaded) setM(foupM, i, cw(x), OHT_Y - 0.66, cz(y), 0.38, 0.34, 0.42); else hide(foupM, i);
        });
        vehM.instanceMatrix.needsUpdate = true; foupM.instanceMatrix.needsUpdate = true;
        /* 操作員 */
        while (walkers.length < wantWalk) { const w = newWalker(); w.s = Math.random() * w.len * 0.8; walkers.push(w); }
        if (walkers.length > wantWalk) walkers.length = wantWalk;
        const devC = phone === 'ban' ? (hand > 0 ? DEV.hand : null) : DEV.phone;
        walkers.forEach((w, i) => {
          w.s += w.v * dt * Math.min(speed, 2.5);
          if (w.s >= w.len) { walkers[i] = newWalker(w.pts[w.pts.length - 1]); return; }
          posOn(w, tmp);
          dummy.position.set(cw(tmp[0]), 0, cz(tmp[1])); dummy.rotation.set(0, tmp[2], 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
          pB.setMatrixAt(i, dummy.matrix); pH.setMatrixAt(i, dummy.matrix); pV.setMatrixAt(i, dummy.matrix);
          if (devC) { pD.setMatrixAt(i, dummy.matrix); pD.setColorAt(i, devC); } else { dummy.scale.set(0.001, 0.001, 0.001); dummy.updateMatrix(); pD.setMatrixAt(i, dummy.matrix); }
        });
        pB.count = pH.count = pV.count = pD.count = walkers.length;
        for (const m of [pB, pH, pV, pD]) m.instanceMatrix.needsUpdate = true;
        if (pD.instanceColor) pD.instanceColor.needsUpdate = true;
      },
      tip(p) {
        const s = G.S, F = s.fab;
        if (p.kind === 'tool' || p.kind === 'slot') {
          const i = p.inst;
          if (i === undefined || !F.tools[i]) return null;
          const inf = Fab.info(i), x = F.tools[i];
          if (x.st === 'coming') return [`預留機台位置：${inf.name}`, x.at ? `預計 ${U.stamp(x.at)} 進廠` : '還沒排定進廠時間', `${inf.area} · 要 ${inf.def.ports} 個交換器埠`];
          return [inf.name, `${inf.area} · ${inf.slot.bay} · ${inf.status}`, `機台電腦：${inf.def.os}`, `${inf.def.ports} 個埠 · FDC ${inf.def.fdc} Mbps · 進廠掃毒：${x.caught ? '抓到惡意程式並清除' : x.scan === 'ok' ? '通過' : x.scan === 'skip' ? '⚠ 略過' : '還沒掃'}`];
        }
        if (p.kind === 'oht') return ['天車（OHT）', '沿著天花板的軌道搬運晶圓盒（FOUP，一盒 25 片）', '由 MES 的搬運系統（MCS）派車：MES 一停、產線一停，天車也停下來'];
        if (p.kind === 'gate') return ['安檢門（金屬探測）+ 保全', F.phone === 'ban' ? '✓ 私人手機、隨身碟、有相機的裝置一律不能帶進去' : '⚠ 目前允許帶私人手機進無塵室', '製程配方與機台畫面是公司最高機密'];
        if (p.kind === 'locker') return ['手機置物櫃', F.phone === 'ban' ? '✓ 私人手機鎖在這裡（亮燈 = 正在充電）' : '目前沒有強制使用', `公司配發的無相機手持裝置：${F.hand} / ${Fab.handNeed()} 台`];
        if (p.kind === 'kiosk') return ['機台進廠掃毒站（SEMI E188）', Fab.kioskReady() ? '✓ 原廠的筆電、USB、安裝光碟與機台電腦都要先掃過' : '施工中', '機台大多是不能更新的舊 Windows：病毒一進廠就很難清乾淨'];
        if (p.kind === 'vwall') { const R = G.R.fab; return ['FAB 控制室的大螢幕', R ? `產能 ${U.num(Math.round(R.rate))} 片 / 日 · 良率 ${U.pct(R.yield, 1)}` : '尚未量產', 'MES 的在製品（WIP）、機台狀態與天車派車']; }
        if (p.kind === 'fabop') return ['操作員（無塵衣）', F.phone === 'ban' ? (F.hand > 0 ? '手上是公司配發、沒有相機的手持裝置（綠色螢幕）：查批號、叫天車' : '⚠ 沒有手持裝置：要走回控制室才查得到 MES') : '⚠ 手上拿的是私人手機：可以拍照、開熱點', '無塵衣、口罩與頭套：人是無塵室最大的微粒來源'];
        return null;
      },
      dispose() {
        for (const x of tags) x.remove();
        for (const m of mats) m.dispose();
        for (const x of geos) x.dispose();
      },
    };
  };
})(window.G = window.G || {});
