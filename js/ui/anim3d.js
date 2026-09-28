/* 知識庫的 3D 原理動畫：光纖全反射、PoE 供電、防火牆 HA 切換、冷熱通道、Wi-Fi 穿牆衰減
 * 每個動畫都是一個模型：{ obj, notes, view, anim(dt, t), caption() }，由 3D 檢視器每幀更新。
 */
(function (G) {
  'use strict';
  const U = G.U, M3 = G.M3;
  const reg = (id, name, cap, fn) => M3.register(id, fn, { name, cap });
  const vec = (a) => new (M3.T().Vector3)(a[0], a[1], a[2]);

  /** 簡單的粒子流：rate 個 / 秒，從 from() 飛到 to()（二次曲線），life 秒 */
  function stream(P, o) {
    const list = [];
    let acc = 0;
    const tmp = [0, 0, 0];
    return {
      on: true,
      tick(dt) {
        acc += dt * (this.on ? o.rate : 0);
        while (acc >= 1) { acc -= 1; const a = o.from(), b = o.to(); list.push({ t: 0, life: o.life * U.rand(0.85, 1.15), a, b, m: o.mid ? o.mid(a, b) : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] }); }
        for (let i = list.length - 1; i >= 0; i--) {
          const q = list[i];
          q.t += dt / q.life;
          if (q.t >= 1) { list.splice(i, 1); continue; }
          const u = 1 - q.t;
          for (let k = 0; k < 3; k++) tmp[k] = u * u * q.a[k] + 2 * u * q.t * q.m[k] + q.t * q.t * q.b[k];
          P.push(tmp[0], tmp[1], tmp[2], o.color, (o.alpha || 0.8) * Math.min(1, q.t / 0.15) * Math.min(1, (1 - q.t) / 0.25), o.size || 1);
        }
      },
    };
  }

  /* ================= 光纖：全反射與模態色散 ================= */
  reg('anim-fiber', '動畫：光在光纖裡怎麼跑', '多模光纖的光以不同角度反射前進，抵達時間不一致，所以距離較短；單模光纖纖芯極細，光幾乎直線前進，可傳 10 公里以上。', () => {
    const T = M3.T(), K = M3.kit, fx = M3.fx;
    const g = new T.Group();
    const L0 = -6, L1 = 6;
    /* 淺色背景上，透明玻璃與淡藍光點會看不見：改用較深、較不透明的顏色 */
    const dark = fx.isDark();
    const glass = K.std(dark ? '#bfe6ff' : '#5f9fc2', { transparent: true, opacity: dark ? 0.16 : 0.3, roughness: 0.08, metalness: 0, depthWrite: false });
    const coreM = K.std(dark ? '#e9fbff' : '#2f86b4', { transparent: true, opacity: dark ? 0.32 : 0.4, roughness: 0.05, metalness: 0, depthWrite: false, emissive: K.col('#3a8fb0'), emissiveIntensity: 0.25 });
    const fibers = [{ y: 1.7, core: 0.3, jacket: '#2fc6b8' }, { y: -1.7, core: 0.07, jacket: '#f2c14e' }];
    for (const f of fibers) {
      g.add(K.cylX(0.62, 0.62, L0, L1, glass, f.y, 0, 48));
      g.add(K.cylX(f.core, f.core, L0, L1, coreM, f.y, 0, 32));
      g.add(K.cylX(0.82, 0.82, L0 - 2.2, L0, K.std(f.jacket, { roughness: 0.5, metalness: 0.05 }), f.y, 0, 40));
      g.add(K.cylX(0.66, 0.66, L0 - 0.02, L0 + 0.08, K.std('#f4f6f7', { roughness: 0.4, metalness: 0.05 }), f.y, 0, 40));
      f.det = K.cylX(0.66, 0.66, L1, L1 + 0.14, K.glow('#9ff3ff', 0.15), f.y, 0, 40);
      g.add(f.det);
      f.flash = 0;
    }
    const zig = (y, amp, half) => {
      if (!half) return [[L0, y, 0], [L1, y, 0]];
      const pts = [[L0, y, 0]];
      let x = L0 + half / 2, s = 1;
      while (x < L1) { pts.push([x, y + s * amp, 0]); x += half; s = -s; }
      const last = pts[pts.length - 1];
      const fr = (L1 - last[0]) / half;
      pts.push([L1, y + (last[1] - y) * (1 - 2 * fr), 0]);
      return pts;
    };
    const modes = [
      { f: 0, pts: zig(1.7, 0, 0) }, { f: 0, pts: zig(1.7, 0.27, 1.3) }, { f: 0, pts: zig(1.7, 0.27, 0.5) },
      { f: 1, pts: zig(-1.7, 0, 0) },
    ];
    const lineM = new T.LineBasicMaterial({ color: K.col(dark ? '#7fe3ff' : '#1d6f99'), transparent: true, opacity: dark ? 0.3 : 0.45 });
    for (const m of modes) {
      m.path = fx.path(m.pts);
      g.add(new T.Line(new T.BufferGeometry().setFromPoints(m.pts.map(vec)), lineM));
    }
    const P = fx.points(300, 0.5);
    g.add(P.obj);
    const LIGHT = fx.rgb(dark ? '#c4f6ff' : '#e0730b');
    let pulses = [], next = 0.3;
    const SPEED = 3.0;
    const pos = [0, 0, 0];
    const notes = [
      K.note([L0 - 1.1, 1.7 + 0.82, 0], [0, 1, 0], 'OM4 多模（水藍色）：纖芯 50µm，光以不同角度前進'),
      K.note([L0 - 1.1, -1.7 - 0.82, 0], [0, 0, 1], 'OS2 單模（黃色）：纖芯只有 9µm，光幾乎直線前進'),
      K.note([-1, 1.7 + 0.62, 0], [0, 1, 0], '包層：折射率較低，光碰到交界就全反射回纖芯'),
      K.note([L1 + 0.14, 1.7, 0], [1, 0, 0], '多模：同一個脈衝分批抵達 → 距離受限'),
      K.note([L1 + 0.14, -1.7, 0], [1, 0, 0], '單模：脈衝整齊抵達 → 可傳 10 公里以上'),
    ];
    return {
      obj: g, notes, view: { yaw: 0.22, pitch: 0.2 }, themed: true,
      caption: () => '光在纖芯與包層的交界不斷「全反射」前進（示意圖，尺寸已放大）',
      anim(dt, t) {
        if (t >= next) { next = t + 2.4; for (const m of modes) pulses.push({ m, t0: t }); }
        P.begin();
        pulses = pulses.filter((q) => {
          const d = (t - q.t0) * SPEED;
          if (d >= q.m.path.len) { fibers[q.m.f].flash = 1; return false; }
          for (let k = 0; k < 8; k++) {
            const dd = d - k * 0.12;
            if (dd < 0) break;
            q.m.path.at(dd / q.m.path.len, pos);
            P.push(pos[0], pos[1], pos[2], LIGHT, k ? (1 - k / 8) * 0.6 : 1, k ? 1 - k * 0.08 : 1.35);
          }
          return true;
        });
        P.end();
        for (const f of fibers) { f.flash = Math.max(0, f.flash - dt * 2.4); f.det.material.emissiveIntensity = 0.15 + f.flash * 2.4; }
      },
    };
  });

  /* ================= PoE：一條線同時送電與資料 ================= */
  reg('anim-poe', '動畫：PoE 同時送電與資料', '交換器透過同一條網路線送出電力（橘）與資料（藍）；AP 不需要另外拉電源線。', () => {
    const T = M3.T(), K = M3.kit, fx = M3.fx;
    const g = new T.Group();
    const sw = M3.build('AX-48P');
    sw.obj.position.set(-3.4, 0, 0);
    g.add(sw.obj);
    const ap = M3.build('AP-600');
    const AP = [3.6, 3.2, -0.6];
    ap.obj.position.set(AP[0], AP[1], AP[2]);
    g.add(ap.obj);
    const pn = sw.notes.find((n) => n.text.indexOf('PoE+（') >= 0) || sw.notes[0];
    const S = [pn.p.x - 3.4 - 1.1, pn.p.y + 0.07, pn.p.z + 0.02];
    const E = [AP[0], AP[1] - 1.24, AP[2] - 1.805];
    const pts = [S, [S[0], S[1] - 0.05, S[2] + 0.6], [S[0] + 0.9, S[1] - 0.7, S[2] + 1.4], [0.8, -0.8, 1.3], [3.1, 0.2, -0.6], [E[0], E[1] - 0.7, E[2] + 0.1], E];
    const curve = new T.CatmullRomCurve3(pts.map(vec));
    g.add(new T.Mesh(new T.TubeGeometry(curve, 160, 0.045, 10, false), K.std('#2f6fd6', { roughness: 0.6 })));
    const path = fx.path(curve.getSpacedPoints(200));
    const ledM = K.glow('#46e27a', 1.6);
    const led = new T.Mesh(new T.TorusGeometry(0.1, 0.022, 10, 40), ledM);
    led.rotation.x = -Math.PI / 2;
    led.position.set(AP[0], AP[1] + 0.228, AP[2] - 0.132);
    g.add(led);
    const portM = K.glow('#ffb13b', 1.4);
    const port = new T.Mesh(new T.SphereGeometry(0.06, 12, 10), portM);
    port.position.set(S[0], S[1] + 0.1, S[2] + 0.03);
    g.add(port);
    const P = fx.points(260, 0.2);
    g.add(P.obj);
    const dark = fx.isDark();
    const BLUE = fx.rgb(dark ? '#7cc0ff' : '#1f6fd1'), ORANGE = fx.rgb(dark ? '#ffb13b' : '#e07b00');
    const C_OFF = K.col('#2a3036'), C_AMB = K.col('#ffb13b'), C_GRN = K.col('#46e27a');
    const data = [], power = [];
    let acc = 0, pacc = 0, phase = 0;
    const pos = [0, 0, 0];
    const mid = path.at(0.45);
    const notes = [
      K.note(S, [0, 0, 1], 'PoE+ 交換器埠：每埠最多 30W，整台預算 740W'),
      K.note(mid, [0, 0, 1], 'Cat6 網路線：資料與電力走同一條線'),
      K.note([AP[0] + 0.6, AP[1] + 0.23, AP[2] + 0.4], [0, 1, 0], 'AP 不需要插座，靠網路線供電'),
    ];
    const CAPS = ['① AP 接上網路線，還沒開機', '② 交換器偵測到 PoE 裝置，開始透過網路線送電（橘）', '③ AP 開機完成：同一條線同時傳資料（藍）與電力（橘）'];
    return {
      obj: g, notes, view: { yaw: 0.3, pitch: 0.32 }, themed: true,
      caption: () => CAPS[phase],
      anim(dt, t) {
        const c = t % 10;
        phase = c < 1.2 ? 0 : c < 4 ? 1 : 2;
        pacc += dt * (phase >= 1 ? 3.2 : 0);
        while (pacc >= 1) { pacc -= 1; power.push(0); }
        acc += dt * (phase === 2 ? 9 : 0);
        while (acc >= 1) { acc -= 1; data.push(Math.random() < 0.6 ? { u: 0, d: 1 } : { u: 1, d: -1 }); }
        P.begin();
        for (let i = power.length - 1; i >= 0; i--) {
          power[i] += dt * 0.32;
          if (power[i] >= 1) { power.splice(i, 1); continue; }
          path.at(power[i], pos);
          P.push(pos[0], pos[1], pos[2], ORANGE, 0.55, 2.4);
        }
        for (let i = data.length - 1; i >= 0; i--) {
          const q = data[i];
          q.u += dt * 0.45 * q.d;
          if (q.u > 1 || q.u < 0) { data.splice(i, 1); continue; }
          path.at(q.u, pos);
          P.push(pos[0], pos[1], pos[2], BLUE, 0.95, 1);
        }
        P.end();
        if (phase === 0) { power.length = 0; data.length = 0; }
        ledM.color.copy(phase === 0 ? C_OFF : phase === 1 ? C_AMB : C_GRN);
        ledM.emissive.copy(ledM.color);
        ledM.emissiveIntensity = phase === 0 ? 0 : phase === 1 ? (Math.sin(t * 9) > 0 ? 1.6 : 0.2) : 1.6;
        portM.emissiveIntensity = phase === 0 ? 0 : 1.4;
      },
    };
  });

  /* ================= 防火牆 HA：主備自動切換 ================= */
  reg('anim-ha', '動畫：防火牆 HA 自動切換', '兩台防火牆以心跳線互相監看：Active 故障時，Standby 在數秒內接手，連線狀態已同步。', () => {
    const T = M3.T(), K = M3.kit, fx = M3.fx;
    const g = new T.Group();
    const sp = Object.assign({ model: 'SG-3000' }, K.SPEC['SG-3000']);
    const A = K.chassis(sp), B = K.chassis(Object.assign({}, sp, { sticker: false }));
    const hU = sp.u * 0.4445;
    A.obj.position.y = hU / 2 + 0.05;
    B.obj.position.y = -hU / 2 - 0.05;
    g.add(A.obj, B.obj);
    const zF = A.dims[2] / 200;
    const ha = A.regions.front.find((n) => n.text.indexOf('HA') >= 0);
    const hx = ha ? ha.p.x : -0.5, hy = ha ? ha.p.y : 0, hz = zF + 0.003;
    const ys = [A.obj.position.y, B.obj.position.y];
    const haPts = [[hx, hy + ys[0], hz], [hx + 0.1, hy + ys[0], hz + 0.35], [hx + 0.35, 0, hz + 0.55], [hx + 0.1, hy + ys[1], hz + 0.35], [hx, hy + ys[1], hz]];
    g.add(K.tube(haPts, 0.03, K.std('#e84a4a', { roughness: 0.5 }), 48));
    const haPath = fx.path(new T.CatmullRomCurve3(haPts.map(vec)).getSpacedPoints(80));
    const flowPath = (y) => fx.path([[-6.4, y, zF + 1.3], [-4.2, y, zF + 0.9], [-1.6, y, zF + 0.1], [1.6, y, zF + 0.1], [4.2, y, zF + 0.9], [6.4, y, zF + 1.3]]);
    const paths = [flowPath(ys[0]), flowPath(ys[1])];
    const lineM = new T.LineBasicMaterial({ color: K.col('#5aa9f0'), transparent: true, opacity: 0.25 });
    for (const p of paths) g.add(new T.Line(new T.BufferGeometry().setFromPoints(p.pts.map(vec)), lineM));
    /* 狀態牌（Canvas 貼圖，狀態改變時重畫） */
    const badge = ys.map((y) => {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 80;
      const tex = new T.CanvasTexture(c);
      tex.encoding = T.sRGBEncoding;
      const s = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      s.scale.set(1.9, 0.475, 1);
      s.position.set(-3.75, y, zF + 0.2);
      s.renderOrder = 10;
      g.add(s);
      return { c, tex, st: null };
    });
    const COLORS = { active: '#2fae66', standby: '#3b7fd1', failed: '#d23835' };
    const TEXT = { active: 'ACTIVE', standby: 'STANDBY', failed: '故障' };
    const setBadge = (i, st) => {
      const b = badge[i];
      if (b.st === st) return;
      b.st = st;
      const x = b.c.getContext('2d');
      x.clearRect(0, 0, 320, 80);
      K.D.rr(x, 4, 4, 312, 72, 16, COLORS[st]);
      K.D.txt(x, (i ? 'B  ' : 'A  ') + TEXT[st], 160, 42, 34, '#ffffff', 'center', 800);
      b.tex.needsUpdate = true;
    };
    const bars = ys.map((y) => {
      const m = K.glow('#46e27a', 1.5);
      const bar = K.box(0.07, hU * 0.72, 0.03, m);
      bar.position.set(-2.44, y, zF + 0.02);
      g.add(bar);
      return m;
    });
    const P = fx.points(260, 0.24);
    g.add(P.obj);
    const dark = fx.isDark();
    const CYAN = fx.rgb(dark ? '#7fd8ff' : '#1478c8'), RED = fx.rgb(dark ? '#ff6b6b' : '#d62828');
    let flow = [], beats = [], facc = 0, bacc = 0, cap = '';
    const pos = [0, 0, 0];
    const name = ['防火牆 A', '防火牆 B'];
    const notes = [
      K.note([-6.4, ys[0], zF + 1.3], [0, 0, 1], '外部（網際網路）'),
      K.note([6.4, ys[1], zF + 1.3], [0, 0, 1], '內部（公司網路）'),
      K.note([hx + 0.35, 0, hz + 0.55], [0, 0, 1], 'HA 心跳線：互相確認對方還活著，並同步連線狀態'),
    ];
    return {
      obj: g, notes, view: { yaw: 0.3, pitch: 0.22 }, themed: true,
      caption: () => cap,
      anim(dt, t) {
        const cyc = Math.floor(t / 12), ph = t - cyc * 12;
        const act = cyc % 2, oth = 1 - act;
        const st = [null, null];
        let via = act, hb = true;
        if (ph < 5) { st[act] = 'active'; st[oth] = 'standby'; cap = `正常：${name[act]} 處理所有流量，${name[oth]} 透過心跳線監看`; }
        else if (ph < 6.2) { st[act] = 'failed'; st[oth] = 'standby'; via = -1; hb = false; cap = `${name[act]} 故障！${name[oth]} 收不到心跳……`; }
        else if (ph < 10) { st[act] = 'failed'; st[oth] = 'active'; via = oth; hb = false; cap = `${name[oth]} 在數秒內接手成為 Active，連線已同步，使用者幾乎無感`; }
        else { st[act] = 'standby'; st[oth] = 'active'; via = oth; cap = `${name[act]} 修復後成為 Standby，隨時準備再接手`; }
        for (let i = 0; i < 2; i++) {
          setBadge(i, st[i]);
          bars[i].color.set(COLORS[st[i]]).convertSRGBToLinear();
          bars[i].emissive.copy(bars[i].color);
          bars[i].emissiveIntensity = st[i] === 'failed' ? (Math.sin(t * 10) > 0 ? 1.8 : 0.15) : 1.5;
        }
        facc += dt * (via >= 0 ? 7 : 0);
        while (facc >= 1) { facc -= 1; flow.push({ i: via, u: 0 }); }
        bacc += dt * (hb ? 1.8 : 0);
        while (bacc >= 1) { bacc -= 1; beats.push({ u: 0, d: 1 }, { u: 1, d: -1 }); }
        P.begin();
        flow = flow.filter((q) => {
          q.u += dt * 0.2;
          if (q.u >= 1 || st[q.i] === 'failed') return false;
          paths[q.i].at(q.u, pos);
          P.push(pos[0], pos[1], pos[2], CYAN, 0.9, 1);
          return true;
        });
        beats = beats.filter((q) => {
          q.u += dt * 1.3 * q.d;
          if (q.u > 1 || q.u < 0 || !hb) return false;
          haPath.at(q.u, pos);
          P.push(pos[0], pos[1], pos[2], RED, 0.95, 0.8);
          return true;
        });
        P.end();
      },
    };
  });

  /* ================= 冷熱通道 ================= */
  reg('anim-aisle', '動畫：冷熱通道', '機櫃背對背排列：冷風從地板出風口送到機櫃正面（冷通道），熱風從背面排出（熱通道），再被精密空調吸回冷卻。', () => {
    const T = M3.T(), K = M3.kit, fx = M3.fx, R = K.RACK;
    const g = new T.Group();
    const ROW = 11, XS = [-6.3, 0, 6.3];
    const floorT = K.makeTex(600, 600, (c) => { K.D.rect(c, 0, 0, 600, 600, '#2c353c'); K.D.rr(c, 8, 8, 584, 584, 8, '#3a444c'); }, 1);
    floorT.wrapS = floorT.wrapT = T.RepeatWrapping;
    floorT.repeat.set(34 / 6, 46 / 6);
    const floor = K.plane(34, 46, K.texMat(floorT, { metalness: 0.1, roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(-4, 0, 0);
    g.add(floor);
    const perfT = K.makeTex(600, 600, (c) => {
      K.D.rect(c, 0, 0, 600, 600, '#56626b');
      for (let y = 40; y < 580; y += 26) for (let x = 40; x < 580; x += 26) K.D.circ(c, x, y, 8, '#1a2126');
    }, 1);
    for (const sz of [1, -1]) for (const x of XS) {
      const t = K.plane(5.8, 5.8, K.texMat(perfT, { metalness: 0.2, roughness: 0.7 }));
      t.rotation.x = -Math.PI / 2;
      t.position.set(x, 0.02, sz * (ROW + R.D / 2 + 3.2));
      g.add(t);
    }
    const protos = { 'SV-1U': M3.build('SV-1U'), 'SV-2U': M3.build('SV-2U') };
    const fill = [['SV-2U', 14], ['SV-2U', 16], ['SV-1U', 19], ['SV-1U', 20], ['SV-1U', 21], ['SV-2U', 24], ['SV-1U', 27], ['SV-1U', 28]];
    const blankM = K.std('#16191c', { metalness: 0.4, roughness: 0.55 });
    const blankG = new T.BoxGeometry(4.4, R.UH - 0.012, 0.02);
    let blankNote = null;
    for (const sz of [1, -1]) for (const x of XS) {
      const rk = K.rackFrame();
      const used = new Set();
      for (const [id, u] of fill) {
        const pr = protos[id], o = pr.obj.clone();
        const mu = K.SPEC[id].u;
        o.position.set(0, R.U0 + (u - 1) * R.UH + mu * R.UH / 2, R.zRail + 0.03 - pr.dims[2] / 200);
        rk.add(o);
        for (let k = 0; k < mu; k++) used.add(u + k);
      }
      for (let u = 1; u <= 42; u++) {
        if (used.has(u)) continue;
        const b = new T.Mesh(blankG, blankM);
        b.position.set(0, R.U0 + (u - 0.5) * R.UH, R.zRail + 0.03);
        rk.add(b);
        if (!blankNote && sz === 1 && x === XS[2] && u === 33) blankNote = [x, R.U0 + (u - 0.5) * R.UH, sz * ROW + R.zRail + 0.05];
      }
      rk.position.set(x, 0, sz * ROW);
      if (sz < 0) rk.rotation.y = Math.PI;
      g.add(rk);
    }
    const crac = M3.build('CRAC-25');
    crac.obj.position.set(-17, 19.5 / 2, 0);
    crac.obj.rotation.y = Math.PI / 2;
    g.add(crac.obj);
    const racks = [];
    for (const sz of [1, -1]) for (const x of XS) racks.push({ x, y0: R.U0 + 13 * R.UH, y1: R.U0 + 30 * R.UH, front: sz * (ROW + R.D / 2), back: sz * (ROW - R.D / 2), dir: sz, heat: 0.75, on: true });
    const air = fx.airflow({ n: 520, size: 0.95, ceil: 25, racks: () => racks, cooling: () => 1, warm: () => 0.35 });
    g.add(air.obj);
    const P = fx.points(200, 1.0);
    g.add(P.obj);
    const COLD = fx.rgb('#5fc4ff'), HOT = fx.rgb('#ff7a45');
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const supply = stream(P, { rate: 10, life: 2.2, color: COLD, alpha: 0.7, size: 0.9,
      from: () => [-12.4, 0.6, U.rand(-3, 3)], to: () => { const sz = Math.random() < 0.5 ? 1 : -1; return [pick(XS) + U.rand(-2.5, 2.5), 0.35, sz * (ROW + R.D / 2 + U.rand(2, 4.5))]; },
      mid: (a, b) => [(a[0] + b[0]) / 2, 0.35, b[2] * 0.8] });
    const ret = stream(P, { rate: 9, life: 2.4, color: HOT, alpha: 0.6, size: 0.95,
      from: () => [pick(XS) + U.rand(-2.5, 2.5), 25, U.rand(-4, 4)], to: () => [-15.5, 19.8, U.rand(-2.5, 2.5)],
      mid: (a, b) => [(a[0] + b[0]) / 2, 27, (a[2] + b[2]) / 2] });
    const notes = [
      K.note([XS[2], 13, ROW + R.D / 2 + 2.5], [0, 0, 1], '冷通道：機櫃正面朝這裡，吸入冷風'),
      K.note([0, 22, 0], [0, 1, 0], '熱通道：機櫃背對背，熱風集中往上排出'),
      K.note([XS[0], 0.05, ROW + R.D / 2 + 3.2], [0, 1, 0], '開孔地板：空調的冷風從地板下送上來'),
      K.note([-17 + 4.46, 12, 0], [1, 0, 0], '精密空調：從上方吸回熱風，冷卻後再送出'),
    ];
    if (blankNote) notes.push(K.note(blankNote, [0, 0, 1], '盲板：封住空位，避免熱風繞回正面'));
    return {
      obj: g, notes, view: { yaw: 0.95, pitch: 0.48 },
      caption: () => '冷風從正面進、熱風從背面出，冷熱不混合，空調效率才高',
      anim(dt) {
        air.tick(dt);
        P.begin(); supply.tick(dt); ret.tick(dt); P.end();
      },
    };
  });

  /* ================= Wi-Fi：距離與牆壁衰減 ================= */
  reg('anim-wifi', '動畫：Wi-Fi 訊號穿牆衰減', '訊號強度 RSSI = 發射功率 − 距離損耗 − 牆壁衰減。玻璃約 2 dB、輕隔間約 4 dB、鋼筋混凝土約 12 dB。', () => {
    const T = M3.T(), K = M3.kit, fx = M3.fx;
    const g = new T.Group();
    const X0 = -3, X1 = 21, ZH = 6, APH = 3;
    const WALLS = [{ x: 5, db: 2, th: 0.12, color: '#9fd4ff', op: 0.3, name: '玻璃隔間：約 −2 dB' }, { x: 10, db: 4, th: 0.2, color: '#d6dade', op: 0.92, name: '輕隔間：約 −4 dB' }, { x: 15, db: 12, th: 0.42, color: '#8f969b', op: 1, name: '鋼筋混凝土：約 −12 dB' }];
    const loss = (x) => WALLS.reduce((s, w) => s + (x > w.x ? w.db : 0), 0);
    const rssi = (x, z) => 20 - (46 + 33 * Math.log10(Math.max(1, Math.hypot(x, z, APH)))) - loss(x);
    const colOf = (r) => (r >= -60 ? '#46d17f' : r >= -67 ? '#b5d94a' : r >= -75 ? '#f0a63a' : '#f25f5c');
    const floorT = K.makeTex((X1 - X0) * 10, ZH * 20, (c, W, H) => {
      K.D.rect(c, 0, 0, W, H, '#232c33');
      for (let px = 0; px < W; px += 2) for (let pz = 0; pz < H; pz += 2) {
        const x = X0 + px / 10, z = -ZH + pz / 10;
        c.fillStyle = colOf(rssi(x, z));
        c.globalAlpha = 0.34;
        c.fillRect(px, pz, 2, 2);
      }
      c.globalAlpha = 0.25;
      for (let x = 0; x <= W; x += 10) K.D.rect(c, x, 0, 0.5, H, '#0e151b');
      for (let z = 0; z <= H; z += 10) K.D.rect(c, 0, z, W, 0.5, '#0e151b');
      c.globalAlpha = 1;
    }, 4);
    const floor = K.plane(X1 - X0, ZH * 2, K.texMat(floorT, { metalness: 0.05, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((X0 + X1) / 2, 0, 0);
    g.add(floor);
    for (const w of WALLS) {
      const m = K.std(w.color, { transparent: w.op < 1, opacity: w.op, roughness: w.op < 1 ? 0.1 : 0.8, metalness: 0.05, depthWrite: w.op >= 1 });
      const wall = K.box(w.th, 3.2, ZH * 2, m);
      wall.position.set(w.x, 1.6, 0);
      g.add(wall);
    }
    const ap = M3.build('AP-600');
    ap.obj.scale.setScalar(0.5);
    ap.obj.position.set(0, APH, 0);
    g.add(ap.obj);
    const pole = K.cylY(0.03, 0.6, K.std('#9aa3aa', { metalness: 0.6 }), 10);
    pole.position.set(0, APH + 0.35, 0);
    g.add(pole);
    const probes = [3, 7.5, 12.5, 18].map((x) => {
      const r = Math.round(rssi(x, 0));
      const d = K.cylY(0.32, 0.08, K.glow(colOf(r), 0.9), 28);
      d.position.set(x, 0.05, 0);
      g.add(d);
      return { x, r };
    });
    const WORD = (r) => (r >= -60 ? '極佳' : r >= -67 ? '良好' : r >= -75 ? '勉強可用（語音建議 ≥ −67）' : '幾乎斷線');
    const CC = {};
    const rgbOf = (r) => { const hx = colOf(r); return CC[hx] || (CC[hx] = fx.rgb(hx)); };
    const P = fx.points(900, 0.22);
    g.add(P.obj);
    const waves = [];
    let next = 0;
    const notes = [
      K.note([0, APH + 0.1, 0], [0, 1, 0], 'AP：訊號往四周發射，距離越遠越弱'),
      ...WALLS.map((w) => K.note([w.x, 3.2, -ZH * 0.55], [0, 1, 0], w.name)),
      ...probes.map((p) => K.note([p.x, 0.1, 0.6], [0, 1, 0], `${String(p.r).replace('-', '−')} dBm ${WORD(p.r)}`)),
    ];
    return {
      obj: g, notes, view: { yaw: 0.32, pitch: 0.62 },
      caption: () => 'RSSI = 發射功率 − 距離造成的損耗 − 牆壁衰減',
      anim(dt, t) {
        if (t >= next) { next = t + 0.75; waves.push({ r: 0.3 }); }
        P.begin();
        for (let i = waves.length - 1; i >= 0; i--) {
          const w = waves[i];
          w.r += dt * 6.5;
          if (w.r > 21.5) { waves.splice(i, 1); continue; }
          const n = Math.min(90, 12 + Math.floor(w.r * 5));
          for (let k = 0; k <= n; k++) {
            const a = -1.3 + 2.6 * k / n;
            const x = w.r * Math.cos(a), z = w.r * Math.sin(a);
            if (x < X0 || x > X1 || Math.abs(z) > ZH) continue;
            const r = rssi(x, z);
            const al = U.clamp((r + 92) / 45, 0.04, 1);
            P.push(x, 0.12, z, rgbOf(r), al, 1);
          }
        }
        P.end();
      },
    };
  });
})(window.G = window.G || {});
