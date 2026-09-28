/* 3D 機房：依玩家實際的機櫃與上架位置即時呈現
 * 設備狀態燈、機櫃用電與斷路器跳脫、冷熱通道氣流、停電 / UPS / 過熱。
 * 點選設備或機櫃會同步到右側的設備面板；選好倉庫裡的設備後，可以直接點機櫃中亮起的空位上架。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, M3 = G.M3;
  const PER_ROW = 5, PITCH = 6.4, ROW = 11;
  const ROOM = { x0: -31, x1: 22, z0: -27, z1: 27, h: 30 };

  /** opts: { height, sel() → {rack, dev, armed}, onDev(id), onRack(id), onSlot(rack, u) } */
  M3.room = (opts) => M3.stage({ height: opts.height, label: '3D 機房', create: (api) => createRoom(api, opts) });

  function createRoom(api, opts) {
    const T = api.T, K = M3.kit, fx = M3.fx, R = K.RACK;
    const root = new T.Group();
    const C = (hex) => K.col(hex);

    /* ---- 固定的房間 ---- */
    const floorT = K.makeTex(600, 600, (c) => { K.D.rect(c, 0, 0, 600, 600, '#29323a'); K.D.rr(c, 7, 7, 586, 586, 8, '#37424a'); }, 1);
    floorT.wrapS = floorT.wrapT = T.RepeatWrapping;
    floorT.repeat.set((ROOM.x1 - ROOM.x0) / 6, (ROOM.z1 - ROOM.z0) / 6);
    const floor = K.plane(ROOM.x1 - ROOM.x0, ROOM.z1 - ROOM.z0, K.texMat(floorT, { metalness: 0.1, roughness: 0.82 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((ROOM.x0 + ROOM.x1) / 2, 0, 0);
    root.add(floor);
    const wallM = K.std('#1d262d', { metalness: 0.05, roughness: 0.9 });
    const back = K.plane(ROOM.x1 - ROOM.x0, ROOM.h, wallM);
    back.position.set((ROOM.x0 + ROOM.x1) / 2, ROOM.h / 2, ROOM.z0);
    root.add(back);
    const left = K.plane(ROOM.z1 - ROOM.z0, ROOM.h, wallM);
    left.rotation.y = Math.PI / 2;
    left.position.set(ROOM.x0, ROOM.h / 2, 0);
    root.add(left);
    const signT = K.makeTex(900, 160, (c) => {
      K.D.rr(c, 0, 0, 900, 160, 18, '#12191e', '#2fc6b8', 5);
      K.D.txt(c, 'B1  主機房  MDF', 450, 84, 74, '#dce7ec', 'center', 800);
    }, 1.5);
    const sign = K.plane(9, 1.6, K.texMat(signT, { metalness: 0, roughness: 0.6 }));
    sign.position.set(4, 25.5, ROOM.z0 + 0.05);
    root.add(sign);
    const perfT = K.makeTex(600, 600, (c) => {
      K.D.rect(c, 0, 0, 600, 600, '#4c5860');
      for (let y = 40; y < 580; y += 26) for (let x = 40; x < 580; x += 26) K.D.circ(c, x, y, 8, '#161c21');
    }, 1);
    const perfM = K.texMat(perfT, { metalness: 0.2, roughness: 0.7 });
    const trayM = K.std('#394148', { metalness: 0.5, roughness: 0.5 });

    /* ---- 共用材質 ---- */
    const M = {
      ok: K.glow('#3fe07a', 1.7), warn: K.glow('#ffb13b', 1.7), bad: K.glow('#ff5a4f', 1.9), off: K.std('#20262b'),
      sel: new T.LineBasicMaterial({ color: C('#2fc6b8') }), rackSel: new T.LineBasicMaterial({ color: C('#2fc6b8'), transparent: true, opacity: 0.7 }),
      slot: new T.MeshBasicMaterial({ color: C('#2fc6b8'), transparent: true, opacity: 0.3, depthWrite: false, side: T.DoubleSide }),
      ghost: new T.MeshBasicMaterial({ color: C('#5aa9f0'), transparent: true, opacity: 0.16, depthWrite: false }),
      beacon: K.glow('#ff5a4f', 2),
      copper: K.std('#c8773a', { metalness: 0.9, roughness: 0.3 }),
      coolS: K.std('#2f86d6', { roughness: 0.4, metalness: 0.2 }), coolR: K.std('#d94a3a', { roughness: 0.4, metalness: 0.2 }),
      glass: K.std('#9fd3ee', { transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.1, depthWrite: false }),
      vesda: K.std('#d23a2c', { roughness: 0.45, metalness: 0.1 }), sensor: K.std('#f4f6f7', { roughness: 0.5 }),
      rope: K.std('#f2c14e', { roughness: 0.6 }),
      nozzle: K.std('#b9c0c6', { metalness: 0.8, roughness: 0.3 }),
      emsScreen: new T.MeshBasicMaterial({ map: K.makeTex(300, 190, (c) => {
        K.D.rect(c, 0, 0, 300, 190, '#0b1419');
        K.D.txt(c, '環境監控 EMS', 12, 20, 16, '#e9edf0', 'left', 800);
        [['溫度', '#46d17f'], ['濕度', '#46d17f'], ['漏水', '#46d17f'], ['煙霧', '#46d17f'], ['門禁', '#5aa9f0'], ['電力', '#46d17f']].forEach(([k, col], i) => {
          const x = 12 + (i % 3) * 96, y = 40 + Math.floor(i / 3) * 72;
          K.D.rr(c, x, y, 86, 62, 6, '#12222a', col, 2);
          K.D.txt(c, k, x + 43, y + 31, 18, col, 'center', 800);
        });
      }, 2) }),
      water: new T.MeshBasicMaterial({ color: C('#4aa8ff'), transparent: true, opacity: 0.4, depthWrite: false }),
      coolant: new T.MeshBasicMaterial({ color: C('#56e3ff'), transparent: true, opacity: 0.45, depthWrite: false }),
    };
    const ledG = new T.BoxGeometry(0.11, 0.11, 0.05);
    const busG = new T.BoxGeometry(0.28, 17.6, 0.1), manG = new T.CylinderGeometry(0.14, 0.14, 17, 12);

    /* ---- 設備原型（每種型號建一次，之後複製） ---- */
    const protos = new Map();
    const proto = (model) => {
      if (!protos.has(model)) {
        if (K.SPEC[model]) protos.set(model, K.chassis(Object.assign({ model }, K.SPEC[model], { lite: true, sticker: false })));
        else protos.set(model, M3.build(model));
      }
      return protos.get(model);
    };

    /* ---- 動態內容 ---- */
    const racksG = new T.Group(), facG = new T.Group(), selG = new T.Group(), slotG = new T.Group(), decoG = new T.Group();
    root.add(decoG, racksG, facG, selG, slotG);
    const frameBox = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ visible: false }));
    frameBox.raycast = () => {};
    root.add(frameBox);
    let rackInfo = [], devInfo = new Map(), facInfo = [], sigR = '', sigF = '', selSig = '', slotSig = '';
    const tags = { racks: [], fac: [], alert: api.tag('', 'bad') };
    tags.alert.pos.set(4, 28, ROOM.z0 + 1);
    tags.alert.show = false;

    const rackPos = (i, n) => {
      const row = i < PER_ROW ? 0 : 1;
      const inRow = row === 0 ? Math.min(PER_ROW, n) : n - PER_ROW;
      const k = i % PER_ROW;
      return { x: (k - (inRow - 1) / 2) * PITCH, z: row === 0 ? ROW : -ROW, dir: row === 0 ? 1 : -1 };
    };
    function buildRacks() {
      const s = G.S;
      for (const o of racksG.children.slice()) racksG.remove(o);
      for (const o of decoG.children.slice()) { decoG.remove(o); if (o.geometry && o.userData.own) o.geometry.dispose(); }
      for (const t of tags.racks) t.remove();
      tags.racks = [];
      rackInfo = [];
      devInfo = new Map();
      const n = s.racks.length;
      s.racks.forEach((r, i) => {
        const p = rackPos(i, n);
        const g = K.rackFrame();
        g.position.set(p.x, 0, p.z);
        if (p.dir < 0) g.rotation.y = Math.PI;
        g.userData.pick = { kind: 'rack', id: r.id };
        racksG.add(g);
        /* AI 機櫃：背面兩條 54V 銅排 + 藍（供）紅（回）液冷歧管 */
        if (r.type === 'ai') {
          const zb = -R.D / 2 + 0.55;
          for (const x of [-0.35, 0.35]) { const bar = new T.Mesh(busG, M.copper); bar.position.set(x, R.U0 + 8.8, zb); g.add(bar); }
          for (const [x, m] of [[-2.1, M.coolS], [2.1, M.coolR]]) { const pipe = new T.Mesh(manG, m); pipe.position.set(x, R.U0 + 8.5, zb); g.add(pipe); }
        }
        const tag = api.tag(r.id, 'ok');
        tag.pos.set(p.x, R.H + 1.2 + (i % 2) * 1.6, p.z + p.dir * 2);
        tags.racks.push(tag);
        rackInfo.push({ id: r.id, g, p, tag, ai: r.type === 'ai' });
        const tile = new T.Mesh(new T.PlaneGeometry(5.8, 5.8), perfM);
        tile.userData.own = true;
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(p.x, 0.02, p.z + p.dir * (R.D / 2 + 3.2));
        decoG.add(tile);
      });
      for (const row of [0, 1]) {
        const xs = rackInfo.filter((ri) => (row === 0 ? ri.p.dir > 0 : ri.p.dir < 0)).map((ri) => ri.p.x);
        if (!xs.length) continue;
        const len = Math.max(...xs) - Math.min(...xs) + PITCH;
        const tray = new T.Mesh(new T.BoxGeometry(len, 0.18, 2.2), trayM);
        tray.userData.own = true;
        tray.position.set((Math.max(...xs) + Math.min(...xs)) / 2, R.H + 2.6, row === 0 ? ROW - 2 : -ROW + 2);
        decoG.add(tray);
      }
      for (const d of Object.values(s.devices)) {
        if (!d.rack || d.host) continue;
        const ri = rackInfo.find((x) => x.id === d.rack);
        if (!ri) continue;
        const m = CAT.devices[d.model];
        const pr = proto(d.model);
        const o = pr.obj.clone();
        const depth = pr.dims ? pr.dims[2] / 100 : 4;
        const y = R.U0 + (d.u - 1) * R.UH + m.u * R.UH / 2;
        o.position.set(0, y, R.zRail + 0.03 - depth / 2);
        o.userData.pick = { kind: 'dev', id: d.id };
        ri.g.add(o);
        const led = new T.Mesh(ledG, M.off);
        led.position.set(-2.33, y + m.u * R.UH / 2 - 0.16, R.zRail + 0.075);
        ri.g.add(led);
        devInfo.set(d.id, { o, led, y, h: m.u * R.UH, depth, ri, blink: 0 });
      }
      const b = new T.Box3();
      if (rackInfo.length) {
        for (const ri of rackInfo) b.expandByPoint(new T.Vector3(ri.p.x - R.W / 2, 0, ri.p.z - R.D / 2)).expandByPoint(new T.Vector3(ri.p.x + R.W / 2, R.H + 3, ri.p.z + R.D / 2));
        b.expandByScalar(4);
        b.min.x = Math.min(b.min.x, -16); b.max.x = Math.max(b.max.x, 16);
        if (b.max.z - b.min.z < 26) { const cz = (b.max.z + b.min.z) / 2; b.min.z = cz - 13; b.max.z = cz + 13; }
      } else b.set(new T.Vector3(ROOM.x0, 0, ROOM.z0), new T.Vector3(ROOM.x1, 20, ROOM.z1));
      frameBox.position.copy(b.getCenter(new T.Vector3()));
      frameBox.scale.copy(b.getSize(new T.Vector3()));
      frameBox.updateMatrixWorld(true);
      selSig = ''; slotSig = '';
    }
    function buildFacilities() {
      const s = G.S;
      for (const o of facG.children.slice()) { facG.remove(o); if (o.userData.ownGeo) o.geometry.dispose(); }
      for (const t of tags.fac) t.remove();
      tags.fac = [];
      facInfo = [];
      let zc = 21, upsX = 17, cduZ = -2;
      /* 機櫃排的範圍（通道封閉、VESDA 取樣管、漏水偵測線、液冷管路都跟著機櫃走） */
      const xs = rackInfo.map((ri) => ri.p.x);
      const rx0 = xs.length ? Math.min(...xs) - R.W / 2 - 0.6 : -8, rx1 = xs.length ? Math.max(...xs) + R.W / 2 + 0.6 : 8;
      const ownMesh = (geo, mat) => { const o = new T.Mesh(geo, mat); o.userData.ownGeo = true; o.raycast = () => {}; return o; };
      const pipeAlong = (pts, r, mat) => { const o = fx.tubeAlong(pts, r, mat); o.userData.ownGeo = true; o.raycast = () => {}; facG.add(o); return o; };
      for (const r of s.room) {
        const m = CAT.room[r.model];
        let g, size;
        if (m.kind === 'cdu') {
          g = proto('CDU-100').obj.clone();
          g.position.set(ROOM.x1 - 3.1, 9.75, cduZ);
          size = [6, 19.5, 12];
          /* 冷卻液管路：CDU 頂部 → 天花板 → 每座 AI 機櫃背面的歧管（藍送、紅回） */
          const top = 19.5 + 1.5;
          for (const ri of rackInfo.filter((x) => x.ai)) {
            const rearZ = ri.p.z - ri.p.dir * (R.D / 2 - 0.55);
            [[-2.1, M.coolS, -0.5], [2.1, M.coolR, 0.5]].forEach(([dx, mat, off]) => {
              const x = ri.p.x + dx * ri.p.dir;
              pipeAlong([[ROOM.x1 - 3.1 + off, top, cduZ - 1.5], [ROOM.x1 - 3.1 + off, R.H + 4.4 + off * 0.4, cduZ - 1.5], [x, R.H + 4.4 + off * 0.4, cduZ - 1.5], [x, R.H + 4.4 + off * 0.4, rearZ], [x, R.H + 0.2, rearZ]], 0.16, mat);
            });
          }
          cduZ += 13;
        } else if (r.model === 'GAS-FS') {
          g = proto('GAS-FS').obj.clone();
          g.scale.setScalar(0.9);
          g.position.set(-8, 0, ROOM.z0 + 2);
          size = [12, 16, 3];
          /* 天花板上的噴頭 */
          for (const x of [rx0 + 3, (rx0 + rx1) / 2, rx1 - 3]) for (const z of [-11, 0, 11]) {
            const nz = ownMesh(new T.CylinderGeometry(0.25, 0.35, 0.5, 12), M.nozzle);
            nz.position.set(x, ROOM.h - 1.2, z);
            facG.add(nz);
          }
        } else if (r.model === 'VESDA') {
          g = proto('VESDA').obj.clone();
          g.scale.setScalar(0.8);
          g.position.set(6, 10, ROOM.z0 + 0.6);
          size = [4, 5, 1.2];
          /* 取樣管沿著天花板跑過每一排機櫃上方 */
          const y = ROOM.h - 2.2;
          pipeAlong([[6, 13.5, ROOM.z0 + 0.4], [6, y, ROOM.z0 + 0.4], [6, y, -11], [rx0, y, -11]], 0.16, M.vesda);
          pipeAlong([[6, y, -11], [rx1, y, -11]], 0.16, M.vesda);
          pipeAlong([[rx0, y, -11], [rx0, y, 11], [rx1, y, 11]], 0.16, M.vesda);
        } else if (r.model === 'EMS-1') {
          /* 牆上的監控面板（完整模型在「3D 外觀」裡看） */
          g = new T.Group();
          const scr = ownMesh(new T.BoxGeometry(3.2, 2.1, 0.2), K.std('#1b2024', { metalness: 0.4 }));
          scr.material.userData = { own: true };
          scr.userData.ownMat = true;
          g.add(scr);
          const face = ownMesh(new T.PlaneGeometry(3, 1.9), M.emsScreen);
          face.position.z = 0.11;
          g.add(face);
          g.position.set(-16, 12, ROOM.z0 + 0.2);
          size = [3.2, 2.1, 0.3];
          /* 每座機櫃進風口一個溫濕度感測器，地板上繞一圈漏水偵測線 */
          for (const ri of rackInfo) {
            const sn = ownMesh(new T.BoxGeometry(0.5, 0.7, 0.2), M.sensor);
            sn.position.set(ri.p.x + 2.2, R.H - 3, ri.p.z + ri.p.dir * (R.D / 2 + 0.12));
            facG.add(sn);
          }
          const z0 = -ROW - R.D / 2 - 1.2, z1 = ROW + R.D / 2 + 1.2;
          pipeAlong([[rx0 - 1, 0.1, z0], [rx1 + 1, 0.1, z0], [rx1 + 1, 0.1, z1], [rx0 - 1, 0.1, z1], [rx0 - 1, 0.1, z0 + 0.3]], 0.07, M.rope);
        } else if (r.model === 'CONTAIN') {
          /* 兩排機櫃中間（背對背的熱通道）加上頂板與兩端的門 */
          g = new T.Group();
          const w = rx1 - rx0, d = (ROW - R.D / 2) * 2 + 0.4;
          const roof = ownMesh(new T.BoxGeometry(w, 0.15, d), M.glass);
          roof.position.set((rx0 + rx1) / 2, R.H + 0.3, 0);
          g.add(roof);
          for (const x of [rx0 - 0.1, rx1 + 0.1]) {
            const door = ownMesh(new T.BoxGeometry(0.12, R.H, d), M.glass);
            door.position.set(x, R.H / 2, 0);
            g.add(door);
            const fr = ownMesh(new T.BoxGeometry(0.25, 0.25, d), K.std('#59636b', { metalness: 0.6 }));
            fr.userData.ownMat = true;
            fr.position.set(x, R.H, 0);
            g.add(fr);
          }
          facG.add(g);
          const tagC = api.tag('', 'info');
          tagC.pos.set((rx0 + rx1) / 2, R.H + 2, 0);
          tagC.show = false;
          tags.fac.push(tagC);
          const none = new T.Object3D();
          none.visible = false;
          facInfo.push({ r, g, tag: tagC, ghost: none, bc: none, plain: true });
          continue;
        } else if (m.kind === 'cooling' && r.model !== 'AC-8') {
          const pr = proto(r.model);
          g = pr.obj.clone();
          const w = r.model === 'CRAC-60' ? 17 : 8.5;
          g.rotation.y = Math.PI / 2;
          g.position.set(ROOM.x0 + 4.45 + 0.4, 9.75, zc - w / 2);
          size = [8.9, 19.5, w];
          zc -= w + 1.4;
        } else if (m.kind === 'ups') {
          g = proto(r.model).obj.clone();
          g.position.set(upsX, 9.75, ROOM.z0 + 4.5 + 0.4);
          size = [6, 19.5, 9];
          upsX -= 7;
        } else if (r.model === 'AC-8') {
          g = new T.Group();
          g.add(K.box(9, 3, 2.4, K.std('#eef1f3', { metalness: 0.05, roughness: 0.5 })));
          const vent = K.box(8.2, 0.5, 0.1, K.std('#9aa3aa'));
          vent.position.set(0, -1.1, 1.22);
          g.add(vent);
          g.position.set(-16, 23, ROOM.z0 + 1.3);
          size = [9, 3, 2.4];
        } else continue;
        g.userData.pick = { kind: 'fac', id: r.id };
        facG.add(g);
        const tag = api.tag('', 'warn');
        tag.pos.set(g.position.x, g.position.y + size[1] / 2 + 1.2, g.position.z);
        tag.show = false;
        tags.fac.push(tag);
        const ghost = new T.Mesh(new T.BoxGeometry(size[0] + 0.3, size[1] + 0.3, size[2] + 0.3), M.ghost);
        ghost.userData.ownGeo = true;
        ghost.position.copy(g.position);
        ghost.rotation.copy(g.rotation);
        ghost.visible = false;
        facG.add(ghost);
        const bc = new T.Mesh(new T.CylinderGeometry(0.35, 0.35, 0.5, 16), M.beacon);
        bc.userData.ownGeo = true;
        bc.position.set(g.position.x, g.position.y + size[1] / 2 + 0.3, g.position.z);
        bc.visible = false;
        facG.add(bc);
        facInfo.push({ r, g, tag, ghost, bc });
      }
    }

    /* ---- 燈光：停電時變暗、紅色警示燈 ---- */
    const lights = api.scene.children.filter((o) => o.isLight);
    const base = lights.map((l) => l.intensity);
    const alarm = new T.PointLight(0xff3b30, 0, 80);
    alarm.position.set(4, 26, ROOM.z0 + 3);
    root.add(alarm);
    const heatL = new T.PointLight(0xff7a3d, 0, 70);
    heatL.position.set(0, 18, 0);
    root.add(heatL);

    /* ---- 氣流 ---- */
    const air = fx.airflow({
      n: 520, size: 0.95, ceil: 26,
      racks: () => {
        const fac = G.R.fac;
        return rackInfo.map((ri) => {
          const fr = fac && fac.racks[ri.id];
          /* AI 機櫃的熱大多由液冷帶走，吹進熱通道的只有剩下的部分 */
          const air = fr ? fr.load - (fr.liquid || 0) : 0;
          const on = !!fac && !G.Net.rackDown(ri.id) && air > 0;
          return { x: ri.p.x, y0: R.U0 + 2 * R.UH, y1: R.U0 + 40 * R.UH, front: ri.p.z + ri.p.dir * R.D / 2, back: ri.p.z - ri.p.dir * R.D / 2, dir: ri.p.dir, heat: U.clamp(air / CAT.rack.powerLimit, 0.12, 1), on };
        });
      },
      cooling: () => { const f = G.R.fac; if (!f || !f.coolingOn || f.coolCap <= 0) return 0; return U.clamp(f.coolCap / Math.max(f.heat, 3), 0.25, 1); },
      warm: () => U.clamp((G.S.temp - 21) / 14, 0, 1),
      /* 拉近看設備時，氣流淡出，不擋住面板 */
      alpha: () => U.clamp((api.zoomRatio() - 0.18) / 0.35, 0, 1),
    });
    root.add(air.obj);

    /* ---- 接線：遊戲裡真實的連線，從設備的埠拉到機櫃上方的線槽 ---- */
    const cableG = new T.Group();
    root.add(cableG);
    const CP = fx.points(1200, 0.5);
    root.add(CP.obj);
    const TRAY_Y = R.H + 2.95;
    const trayZ = (row) => (row === 0 ? ROW - 2 : -ROW + 2);
    const EXIT = { riser: new T.Vector3(ROOM.x0 + 7, ROOM.h - 2, ROOM.z0 + 0.35), isp: new T.Vector3(ROOM.x0 + 0.35, R.H + 4.5, -5) };
    const plateM = K.std('#59636b', { metalness: 0.5, roughness: 0.5 });
    const riserPlate = K.box(3.4, 1.4, 0.3, plateM);
    riserPlate.position.set(EXIT.riser.x, EXIT.riser.y, ROOM.z0 + 0.15);
    const ispPlate = K.box(0.3, 1.4, 2.6, plateM);
    ispPlate.position.set(ROOM.x0 + 0.15, EXIT.isp.y, EXIT.isp.z);
    root.add(riserPlate, ispPlate);
    const exitTags = { riser: api.tag('↑ 往各樓層（弱電豎井）', 'info'), isp: api.tag('ISP 專線進線', 'info') };
    exitTags.riser.pos.set(EXIT.riser.x, EXIT.riser.y + 1.5, EXIT.riser.z + 0.4);
    exitTags.isp.pos.set(EXIT.isp.x + 0.4, EXIT.isp.y + 1.5, EXIT.isp.z);
    let cables = [], sigL = '';
    let dark = fx.isDark();
    const cabMats = new Map();
    const cabMat = (hex, mode) => {
      const k = hex + mode;
      if (!cabMats.has(k)) {
        cabMats.set(k, mode === 'ghost' ? K.std(hex, { transparent: true, opacity: 0.3, depthWrite: false })
          : mode === 'hot' ? K.std(hex, { roughness: 0.5, emissive: C('#ff7a1a'), emissiveIntensity: 0.9 })
            : K.std(hex, { roughness: 0.55, metalness: 0.1, emissive: C(hex), emissiveIntensity: 0.12 }));
      }
      return cabMats.get(k);
    };
    const cableCols = (cb) => { const base = fx.rgb(cb.hex); cb.c1 = dark ? fx.mix(base, [1, 1, 1], 0.55) : fx.mix(base, [0, 0, 0], 0.2); cb.c2 = dark ? base : fx.mix(base, [0, 0, 0], 0.4); };
    const offTheme = G.bus.on('theme', () => { dark = fx.isDark(); for (const cb of cables) cableCols(cb); });

    /** 設備的連接埠在哪一面、哪個位置（交換器多在前面板；伺服器的網卡在背面） */
    const portSpot = new Map();
    function portOf(model) {
      if (portSpot.has(model)) return portSpot.get(model);
      const rg = proto(model).regions || { front: [], rear: [] };
      const isPort = (t) => /SFP|QSFP|RJ45|1G|網卡|介面|上行|埠/.test(t) && !/Console|MGMT|BMC|管理埠|HA/.test(t);
      let r = (rg.front || []).find((n) => isPort(n.text)), face = 'front';
      if (!r) { r = (rg.rear || []).find((n) => isPort(n.text)); face = 'rear'; }
      const spot = r ? { x: r.p.x, y: r.p.y, z: r.p.z, face } : { x: 1.2, y: 0, z: 2, face: 'front' };
      portSpot.set(model, spot);
      return spot;
    }
    const perDev = new Map();
    /** 設備端：埠的位置、往外拉出一點、往上到線槽高度（世界座標） */
    function devEnd(id) {
      const di = devInfo.get(id), d = G.S.devices[id];
      if (!di || !d) return null;
      const sp = portOf(d.model);
      const k = perDev.get(id) || 0;
      perDev.set(id, k + 1);
      const zc = R.zRail + 0.03 - di.depth / 2;
      const out = sp.face === 'front' ? 1 : -1;
      di.ri.g.updateMatrixWorld(true);
      const x = U.clamp(sp.x + ((k % 7) - 3) * 0.13, -2.05, 2.05);
      const y = di.y + sp.y + (Math.floor(k / 7) % 2) * 0.08;
      const L = (dz, yy) => di.ri.g.localToWorld(new T.Vector3(x, yy === undefined ? y : yy, zc + sp.z + out * dz));
      return { a: L(0.03), b: L(0.55), up: L(0.55, TRAY_Y - 0.5), row: di.ri.p.dir > 0 ? 0 : 1, face: sp.face, ri: di.ri };
    }
    const V3 = (v) => [v.x, v.y, v.z];
    function buildCables() {
      const s = G.S;
      for (const o of cableG.children.slice()) { cableG.remove(o); o.geometry.dispose(); }
      cables = [];
      perDev.clear();
      let lane = 0, anyFloor = false, anyIsp = false;
      const route = (E, tail, mid) => {
        const lx = ((lane % 7) - 3) * 0.16, ly = (Math.floor(lane / 7) % 4) * 0.13;
        lane++;
        const pts = [V3(E.a), V3(E.b), V3(E.up), [E.up.x, TRAY_Y + ly, trayZ(E.row) + lx]];
        for (const p of mid(lx, ly)) pts.push(p);
        for (const p of tail) pts.push(p);
        return pts;
      };
      for (const l of Object.values(s.links)) {
        const fa = l.a.startsWith('F:'), fb = l.b.startsWith('F:');
        let pts = null, smooth = false;
        if (fa || fb) {
          const E = devEnd(fa ? l.b : l.a);
          if (!E) continue;
          anyFloor = true;
          pts = route(E, [], (lx, ly) => [[EXIT.riser.x + lx, TRAY_Y + ly, trayZ(E.row) + lx], [EXIT.riser.x + lx, TRAY_Y + ly, ROOM.z0 + 0.6], [EXIT.riser.x + lx, EXIT.riser.y - 0.3, ROOM.z0 + 0.6]]);
        } else {
          const A = devEnd(l.a), B = devEnd(l.b);
          if (!A || !B) continue;
          if (A.ri === B.ri && A.face === 'front' && B.face === 'front') {
            const dz = A.b.clone().sub(A.a).normalize().multiplyScalar(0.7);
            pts = [V3(A.a), V3(A.b), [(A.b.x + B.b.x) / 2 + 0.3, (A.b.y + B.b.y) / 2, (A.b.z + B.b.z) / 2 + dz.z], V3(B.b), V3(B.a)];
            smooth = true;
          } else {
            pts = route(A, [V3(B.up), V3(B.b), V3(B.a)], (lx, ly) => (A.row !== B.row ? [[A.up.x, TRAY_Y + ly, trayZ(B.row) + lx], [B.up.x, TRAY_Y + ly, trayZ(B.row) + lx]] : [[B.up.x, TRAY_Y + ly, trayZ(A.row) + lx]]));
          }
        }
        const hex = CAT.cables[l.cable].color;
        const mesh = smooth ? K.tube(pts, 0.075, cabMat(hex, 'ok'), 40, 6) : fx.tubeAlong(pts, 0.075, cabMat(hex, 'ok'));
        mesh.userData.pick = { kind: 'link', id: l.id };
        cableG.add(mesh);
        const cb = { l, hex, mesh, path: fx.path(smooth ? new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(p[0], p[1], p[2]))).getPoints(30) : pts), ab: 0, ba: 0, on: false };
        cableCols(cb);
        cables.push(cb);
      }
      for (const c of s.isp) {
        const E = c.router && devEnd(c.router);
        if (!E) continue;
        anyIsp = true;
        const pts = route(E, [], (lx, ly) => [[ROOM.x0 + 2 + lx, TRAY_Y + ly, trayZ(E.row) + lx], [ROOM.x0 + 2 + lx, TRAY_Y + ly, EXIT.isp.z + lx], [ROOM.x0 + 0.6, EXIT.isp.y - 0.2, EXIT.isp.z + lx]]);
        const mesh = fx.tubeAlong(pts, 0.085, cabMat('#f2c14e', 'ok'));
        mesh.userData.pick = { kind: 'isp', id: c.id };
        cableG.add(mesh);
        const cb = { isp: c, hex: '#f2c14e', mesh, path: fx.path(pts), ab: 0, ba: 0, on: false };
        cableCols(cb);
        cables.push(cb);
      }
      exitTags.riser.show = anyFloor;
      exitTags.isp.show = anyIsp;
    }
    function syncCables() {
      const s = G.S, sim = G.R.sim || { links: {}, isp: {} };
      const sig = sigR + '#' + Object.values(s.links).map((l) => `${l.id}:${l.a}:${l.b}:${l.cable}`).join(',') + '#' + s.isp.map((c) => c.id + ':' + c.router).join(',');
      if (sig !== sigL) { sigL = sig; buildCables(); }
      for (const cb of cables) {
        if (cb.l) {
          const l = cb.l, ls = sim.links[l.id];
          const building = G.Net.linkBuilding(l), up = G.Net.linkUp(l);
          cb.on = up;
          cb.ab = ls && ls.cap ? ls.ab / ls.cap : 0;
          cb.ba = ls && ls.cap ? ls.ba / ls.cap : 0;
          cb.mesh.material = building ? cabMat('#8a96a0', 'ghost') : l.status !== 'up' ? cabMat('#f25f5c', 'ok') : Math.max(cb.ab, cb.ba) >= 0.9 ? cabMat(cb.hex, 'hot') : cabMat(cb.hex, 'ok');
          /* 連到樓層的線：從機房看出去，流量往樓層 = a→b 或 b→a */
          if (l.a.startsWith('F:')) { const t = cb.ab; cb.ab = cb.ba; cb.ba = t; }
        } else {
          const c = cb.isp, st = sim.isp[c.id];
          cb.on = !!(st && st.up);
          cb.ab = st && st.cap ? st.out / st.cap : 0;
          cb.ba = st && st.cap ? st.in / st.cap : 0;
          cb.mesh.material = c.outage ? cabMat('#f25f5c', 'ok') : !cb.on ? cabMat('#8a96a0', 'ghost') : cabMat(cb.hex, 'ok');
        }
      }
    }
    const tmpP = [0, 0, 0];
    function tickCables(t) {
      CP.begin();
      for (const cb of cables) {
        if (!cb.on) continue;
        const L = cb.path.len;
        const na = cb.ab > 0.0005 ? Math.min(6, 1 + Math.round(cb.ab * 6)) : 0;
        const nb = cb.ba > 0.0005 ? Math.min(6, 1 + Math.round(cb.ba * 6)) : 0;
        const va = (30 + cb.ab * 80) / L, vb = (30 + cb.ba * 80) / L;
        for (let i = 0; i < na; i++) { cb.path.at((t * va + i / na) % 1, tmpP); CP.push(tmpP[0], tmpP[1], tmpP[2], cb.c1, 0.95, 1); }
        for (let i = 0; i < nb; i++) { cb.path.at(1 - ((t * vb + i / nb + 0.5 / nb) % 1), tmpP); CP.push(tmpP[0], tmpP[1], tmpP[2], cb.c2, 0.8, 0.8); }
      }
      CP.end();
    }

    /* ---- 事件臨場感：故障設備冒煙、機房過熱的熱浪、UPS 供電中的琥珀警示光 ---- */
    const FX = fx.emitter(520, 1.4);
    root.add(FX.obj);
    const fxState = {};
    const SMOKE0 = fx.rgb('#a3abb1'), SMOKE1 = fx.rgb('#4a5258'), HEAT0 = fx.rgb('#ff9a4a'), HEAT1 = fx.rgb('#ff3b30');
    const FLAME0 = fx.rgb('#ffe08a'), FLAME1 = fx.rgb('#ff3b30'), GAS0 = fx.rgb('#f4f7f9'), GAS1 = fx.rgb('#c9d3da');
    const WATER0 = fx.rgb('#bfe6ff'), WATER1 = fx.rgb('#4aa8ff'), COOL0 = fx.rgb('#56e3ff');
    const upsLight = new T.PointLight(0xffb13b, 0, 45);
    root.add(upsLight);
    const fireL = new T.PointLight(0xff7a1a, 0, 60);
    fireL.position.set(0, 12, 0);
    root.add(fireL);
    const tmpV = new T.Vector3();
    function tickFx(dt, t) {
      const s = G.S, fac = G.R.fac;
      for (const [id, di] of devInfo) {
        const d = s.devices[id];
        if (!d || d.status !== 'failed') continue;
        const k = FX.rate(fxState, 'smk' + id, 6, dt);
        for (let i = 0; i < k; i++) {
          di.ri.g.localToWorld(tmpV.set(U.rand(-1.8, 1.8), di.y + di.h / 2 + 0.1, R.zRail + 0.25));
          FX.emit([tmpV.x, tmpV.y, tmpV.z], { v: [0, 3.2, 0.5 * di.ri.p.dir], spread: 1.3, life: 2.8, c0: SMOKE0, c1: SMOKE1, s0: 0.7, s1: 2.8, a: 0.55 });
        }
      }
      if (s.temp >= 30 && rackInfo.length) {
        const k = FX.rate(fxState, 'heat', Math.min(30, (s.temp - 29) * 3), dt);
        for (let i = 0; i < k; i++) {
          const ri = rackInfo[Math.floor(Math.random() * rackInfo.length)];
          FX.emit([ri.p.x + U.rand(-3, 3), R.H + 0.4, ri.p.z - ri.p.dir * U.rand(1, 6)], { v: [0, 2.2, 0], spread: 1, life: 3, c0: HEAT0, c1: HEAT1, s0: 1.2, s1: 3.4, a: 0.28 });
        }
      }
      const ups = facInfo.find((fi) => CAT.room[fi.r.model].kind === 'ups' && fi.g.visible);
      if (ups) upsLight.position.set(ups.g.position.x, 14, ups.g.position.z + 7);
      upsLight.intensity = fac && fac.onBattery && ups ? (Math.sin(t * 4) > 0 ? 2.2 : 0.5) : 0;
      /* 火警：冒煙 → 起火 → 滅火（氣體霧 / 灑水）；漏水與冷卻液滴落 */
      let fireLight = 0;
      for (const inc of s.incidents) {
        if (inc.status !== 'active') continue;
        const d = inc.data;
        if (inc.type === 'dc-fire') {
          const di = devInfo.get(d.dev);
          if (!di) continue;
          di.ri.g.localToWorld(tmpV.set(U.rand(-1.5, 1.5), di.y + di.h / 2 + 0.2, R.zRail - 1.5));
          const src = [tmpV.x, tmpV.y, tmpV.z];
          if (d.stage === 'smoke') {
            const k = FX.rate(fxState, 'fs' + inc.id, 3, dt);
            for (let i = 0; i < k; i++) FX.emit(src, { v: [0, 1.4, 0], spread: 0.5, life: 3.2, c0: SMOKE0, c1: SMOKE1, s0: 0.5, s1: 1.8, a: 0.2 });
          } else if (d.stage === 'fire') {
            const age = s.time - (d.fireTime || s.time);
            if (age <= 3) {
              fireLight = 1;
              fireL.position.set(src[0], src[1] + 2, src[2]);
              let k = FX.rate(fxState, 'fl' + inc.id, 45, dt);
              for (let i = 0; i < k; i++) FX.emit(src, { v: [0, 4, 0], spread: 1.6, life: 0.7, c0: FLAME0, c1: FLAME1, s0: 1.2, s1: 0.3, a: 0.95 });
              k = FX.rate(fxState, 'fk' + inc.id, 10, dt);
              for (let i = 0; i < k; i++) FX.emit(src, { v: [0, 3, 0], spread: 1.2, life: 3, c0: SMOKE1, c1: SMOKE1, s0: 1, s1: 3.6, a: 0.45 });
            }
            if (age <= 6) {
              if (d.suppress === 'gas') {
                const k = FX.rate(fxState, 'gas' + inc.id, 55, dt);
                for (let i = 0; i < k; i++) FX.emit([U.rand(ROOM.x0 + 2, ROOM.x1 - 2), U.rand(0.4, 5), U.rand(ROOM.z0 + 2, ROOM.z1 - 6)], { v: [U.rand(-0.6, 0.6), 0.5, U.rand(-0.6, 0.6)], spread: 1.2, life: 3.4, c0: GAS0, c1: GAS1, s0: 2, s1: 5, a: 0.3 });
              } else {
                const wet = rackInfo.filter((ri) => (d.suppress === 'wet' ? Math.abs(rackInfo.indexOf(ri) - rackInfo.findIndex((x) => x.id === d.rack)) <= 1 : ri.id === d.rack));
                for (const ri of wet) {
                  const k = FX.rate(fxState, 'wt' + inc.id + ri.id, 40, dt);
                  for (let i = 0; i < k; i++) FX.emit([ri.p.x + U.rand(-3, 3), ROOM.h - 1.5, ri.p.z + U.rand(-5, 5)], { v: [0, -16, 0], spread: 0.4, life: 1.6, c0: WATER0, c1: WATER1, s0: 0.35, s1: 0.3, a: 0.8 });
                }
              }
            }
          }
        } else if (inc.type === 'water-leak' && !d.fixed && /天花板|管線|水管/.test(d.src || '')) {
          const ri = rackInfo.find((x) => x.id === d.rack);
          if (!ri) continue;
          const k = FX.rate(fxState, 'dr' + inc.id, 8, dt);
          for (let i = 0; i < k; i++) FX.emit([ri.p.x + U.rand(-2, 2), ROOM.h - 1.5, ri.p.z + U.rand(-3, 3)], { v: [0, -12, 0], spread: 0.3, life: 2.2, c0: WATER0, c1: WATER1, s0: 0.3, s1: 0.28, a: 0.75 });
        } else if (inc.type === 'cdu-leak') {
          const fi = facInfo.find((x) => x.r.id === d.unit);
          if (!fi) continue;
          const k = FX.rate(fxState, 'cl' + inc.id, 6, dt);
          for (let i = 0; i < k; i++) FX.emit([fi.g.position.x + U.rand(-2, 2), 21, fi.g.position.z - 1.5 + U.rand(-0.5, 0.5)], { v: [0, -9, 0], spread: 0.3, life: 2.4, c0: COOL0, c1: COOL0, s0: 0.3, s1: 0.28, a: 0.8 });
        }
      }
      fireL.intensity = fireLight ? 2 + Math.sin(t * 17) * 0.8 : 0;
      FX.tick(dt);
    }
    /* 地上的積水 / 冷卻液（依事件每半秒更新一次） */
    const puddleG = new T.CircleGeometry(1, 36);
    puddleG.rotateX(-Math.PI / 2);
    const puddles = [];
    for (let i = 0; i < 6; i++) { const p = new T.Mesh(puddleG, M.water); p.visible = false; p.raycast = () => {}; p.renderOrder = 1; root.add(p); puddles.push(p); }
    function syncPuddles() {
      const s = G.S;
      let n = 0;
      const put = (x, z, r, mat) => { if (n >= puddles.length) return; const p = puddles[n++]; p.position.set(x, 0.06 + n * 0.004, z); p.scale.setScalar(r); p.material = mat; p.visible = true; };
      for (const inc of s.incidents) {
        if (inc.status !== 'active') continue;
        const d = inc.data;
        if (inc.type === 'dc-fire' && d.stage === 'fire' && d.suppress !== 'gas' && !d.cleaned) {
          const i0 = rackInfo.findIndex((x) => x.id === d.rack);
          rackInfo.forEach((ri, i) => { if (d.suppress === 'wet' ? Math.abs(i - i0) <= 1 : i === i0) put(ri.p.x, ri.p.z, 4.5, M.water); });
        } else if (inc.type === 'water-leak' && !d.fixed) {
          const ri = rackInfo.find((x) => x.id === d.rack);
          if (ri) put(ri.p.x + 1.5, ri.p.z + ri.p.dir * 2, Math.min(7, 1.5 + (s.time - inc.startedAt) * 0.1), M.water);
        } else if (inc.type === 'cdu-leak') {
          const fi = facInfo.find((x) => x.r.id === d.unit);
          if (fi) put(fi.g.position.x - 3, fi.g.position.z, Math.min(5, 1.2 + (s.time - inc.startedAt) * 0.06), M.coolant);
        }
      }
      for (let i = n; i < puddles.length; i++) puddles[i].visible = false;
    }

    /* ---- 狀態同步 ---- */
    const devState = (d) => {
      const fac = G.R.fac;
      if (d.status === 'failed' || d.status === 'rma' || d.encrypted) return 'bad';
      if (fac && G.Net.rackDown(d.rack)) return 'off';
      if (G.S.time < (d.bootUntil || 0)) return 'warn';
      return 'ok';
    };
    function syncSel() {
      const sel = opts.sel ? opts.sel() : {};
      const sig = [sel.rack, sel.dev, sel.armed, sigR].join('|');
      if (sig === selSig) return;
      selSig = sig;
      for (const o of selG.children.slice()) { selG.remove(o); o.geometry.dispose(); }
      const ri = rackInfo.find((x) => x.id === sel.rack);
      if (ri) {
        const e = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(R.W + 0.3, R.H + 0.3, R.D + 0.3)), M.rackSel);
        e.position.set(ri.p.x, R.H / 2, ri.p.z);
        selG.add(e);
      }
      const di = sel.dev && devInfo.get(sel.dev);
      if (di) {
        const e = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(5.1, di.h + 0.12, di.depth + 0.25)), M.sel);
        e.position.set(0, di.y, R.zRail + 0.03 - di.depth / 2);
        di.ri.g.updateMatrixWorld(true);
        e.applyMatrix4(di.ri.g.matrixWorld);
        selG.add(e);
      }
      /* 上架空位 */
      for (const o of slotG.children.slice()) { slotG.remove(o); o.geometry.dispose(); }
      const s = G.S, ad = sel.armed && s.devices[sel.armed];
      if (ad && !ad.rack && ri) {
        const m = CAT.devices[ad.model];
        for (let u = 1; u <= CAT.rack.units - m.u + 1; u++) {
          if (!G.Act.fits(ri.id, u, m.u)) continue;
          const pl = new T.Mesh(new T.PlaneGeometry(4.5, R.UH * 0.86), M.slot);
          pl.position.set(0, R.U0 + (u - 0.5) * R.UH, R.zRail + 0.12);
          pl.userData.pick = { kind: 'slot', rack: ri.id, u };
          ri.g.updateMatrixWorld(true);
          pl.applyMatrix4(ri.g.matrixWorld);
          slotG.add(pl);
        }
      }
    }
    let alertTxt = '';
    function sync(first) {
      const s = G.S, fac = G.R.fac;
      const sR = s.racks.map((r) => r.id).join(',') + '|' + Object.values(s.devices).filter((d) => d.rack).map((d) => `${d.id}:${d.model}:${d.rack}:${d.u}`).join(',');
      if (sR !== sigR) { sigR = sR; buildRacks(); if (!first) api.refit(); }
      syncCables();
      const sF = s.room.map((r) => r.id + ':' + r.model).join(',') + '|' + sigR;
      if (sF !== sigF) { sigF = sF; buildFacilities(); }
      for (const [id, di] of devInfo) {
        const d = s.devices[id];
        if (!d) continue;
        const st = devState(d);
        di.led.material = M[st];
        di.blink = st === 'bad' ? 4 : st === 'warn' ? 2 : 0;
      }
      for (const ri of rackInfo) {
        const fr = fac && fac.racks[ri.id];
        const load = fr ? fr.load : 0, lim = fr ? fr.limit : CAT.rack.powerLimit;
        const trip = fac && fac.rackTripped[ri.id], down = G.Net.rackDown(ri.id);
        const txt = trip ? `${ri.id} ⚡跳電` : ri.ai ? (down && load > 0 ? `${ri.id} AI ⚡斷電` : `${ri.id} AI ${(load / 1000).toFixed(1)}/${(lim / 1000).toFixed(0)}kW`) : `${ri.id} ${(load / 1000).toFixed(1)}kW`;
        ri.tag.set(txt, trip || load > lim || (ri.ai && down && load > 0) ? 'bad' : load > lim * 0.85 || (ri.ai && fr && load > fr.n1) ? 'warn' : 'ok');
      }
      for (const fi of facInfo) {
        const building = s.time < (fi.r.readyAt || 0);
        const gone = fi.r.status === 'discharged';
        fi.g.visible = !building;
        fi.ghost.visible = building;
        fi.bc.visible = fi.r.status === 'failed' || gone;
        fi.tag.show = building || fi.r.status === 'failed' || gone;
        if (fi.tag.show) fi.tag.set(building ? `安裝中 ${U.dur(fi.r.readyAt - s.time)}` : gone ? '氣體已釋放：需補充鋼瓶' : `${CAT.room[fi.r.model].name} 故障`, building ? 'info' : 'bad');
      }
      syncSel();
      let a = '', ac = 'bad';
      if (fac) {
        if (!fac.mdfPowered) a = fac.fireCut ? '機房緊急斷電（消防 / EPO）' : fac.overheat ? '機房過熱！設備緊急關機' : '機房斷電！';
        else if (fac.onBattery || fac.onBBU) { a = `市電中斷 · ${fac.onBattery ? `UPS 供電中 ${Math.round(s.power.upsCharge * 100)}%` : ''}${fac.onBattery && fac.onBBU ? '、' : ''}${fac.onBBU ? 'AI 機櫃由 BBU 供電' : ''}`; ac = 'warn'; }
        else if (fac.genRunning) { a = '市電中斷 · 發電機運轉中'; ac = 'warn'; }
        else if (s.temp >= 35) a = `機房溫度 ${s.temp.toFixed(1)}°C：設備開始故障`;
        else if (s.temp >= 27) { a = `機房溫度偏高 ${s.temp.toFixed(1)}°C`; ac = 'warn'; }
        else if (fac.liquidHeat > 0 && fac.thermal < 0.98) a = '液冷不足：GPU 過熱降頻中';
      }
      /* 火警與漏水：比一般告警更優先 */
      for (const inc of s.incidents) {
        if (inc.status !== 'active') continue;
        const d = inc.data;
        if (inc.type === 'dc-fire' && d.stage === 'fire') {
          const age = s.time - (d.fireTime || s.time);
          a = age <= 6 ? `🔥 機櫃 ${d.rack} 起火！${d.suppress === 'gas' ? '潔淨氣體滅火中' : '灑水頭動作中'}` : `機櫃 ${d.rack} 火災後：等待清理、更換受損設備`;
          ac = 'bad';
          break;
        }
        if (inc.type === 'dc-fire' && inc.detected) { a = `💨 VESDA：機櫃 ${d.rack} 附近偵測到煙霧`; ac = 'bad'; break; }
        if (inc.type === 'water-leak' && inc.detected && !d.fixed) { a = `💧 機房漏水：機櫃 ${d.rack} 附近積水`; ac = 'bad'; }
        if (inc.type === 'cdu-leak' && inc.detected) { a = '💧 CDU 冷卻液洩漏'; ac = 'bad'; }
      }
      syncPuddles();
      if (!s.racks.length) { a = '機房裡還沒有機櫃：先在上方採購 42U 機櫃'; ac = 'info'; }
      if (a !== alertTxt) { alertTxt = a; tags.alert.set(a, ac); tags.alert.show = !!a; }
      const dim = fac && !fac.mdfPowered ? 0.35 : fac && (fac.onBattery || fac.genRunning) ? 0.7 : 1;
      lights.forEach((l, i) => { l.intensity = base[i] * dim; });
      heatL.intensity = U.clamp((s.temp - 26) / 12, 0, 1) * 1.6;
    }

    return {
      obj: root, frame: frameBox, view: { yaw: 0.55, pitch: 0.42, fill: 0.92 },
      sync,
      animating: () => true,
      tick(dt, t) {
        air.tick(dt);
        tickCables(t);
        tickFx(dt, t);
        for (const di of devInfo.values()) if (di.blink) di.led.visible = Math.sin(t * Math.PI * di.blink) > -0.2;
        else if (!di.led.visible) di.led.visible = true;
        for (const fi of facInfo) if (fi.bc.visible) fi.bc.material.emissiveIntensity = Math.sin(t * 8) > 0 ? 2.2 : 0.2;
        const fac = G.R.fac;
        alarm.intensity = fac && !fac.mdfPowered ? (Math.sin(t * 5) > 0 ? 2.2 : 0.3) : 0;
        M.slot.opacity = 0.2 + 0.15 * (0.5 + 0.5 * Math.sin(t * 4));
      },
      pickables: () => [racksG, facG, slotG, cableG],
      focusFill: (p) => (p.kind === 'dev' ? 0.3 : p.kind === 'slot' ? 0.2 : 0.62),
      clickable: (p) => p.kind === 'dev' || p.kind === 'rack' || p.kind === 'slot',
      tip(p) {
        const s = G.S, fac = G.R.fac;
        if (p.kind === 'dev') {
          const d = s.devices[p.id];
          if (!d) return null;
          const m = CAT.devices[d.model], st = G.UI.devStatus(d);
          return [d.name + (d.role ? ` · ${CAT.roles[d.role].short}` : ''), m.name, `狀態：${st.t}`, `${m.u}U · ${m.watts} W · 機櫃 ${d.rack} 第 ${d.u}U`, '點一下看詳情，點兩下拉近'];
        }
        if (p.kind === 'rack') {
          const fr = fac && fac.racks[p.id];
          if (fr && fr.ai) {
            return [`AI 機櫃 ${p.id}（ORv3）`, `電源櫃 ${(fr.load / 1000).toFixed(1)} / ${(fr.limit / 1000).toFixed(1)} kW · N+1 ${(fr.n1 / 1000).toFixed(1)} kW`, `BBU ${fr.bbuW ? (fr.bbuW / 1000).toFixed(0) + ' kW' : '沒有'} · 液冷 ${(fr.liquid / 1000).toFixed(1)} kW`,
              fac.rackTripped[p.id] ? '⚡ 負載超過電源櫃容量，跳電' : G.Net.rackDown(p.id) ? '⚡ 斷電中' : '背面：54V 銅排與液冷歧管'];
          }
          return [`機櫃 ${p.id}`, `用電 ${fr ? (fr.load / 1000).toFixed(2) : 0} / ${CAT.rack.powerLimit / 1000} kW`, `已用 ${fr ? fr.used : 0}U / ${CAT.rack.units}U`, fac && fac.rackTripped[p.id] ? '⚡ 用電超過上限，斷路器跳脫' : '正面朝冷通道、背面朝熱通道'];
        }
        if (p.kind === 'fac') {
          const r = s.room.find((x) => x.id === p.id);
          if (!r) return null;
          const m = CAT.room[r.model];
          const st = r.status === 'failed' ? '故障' : r.status === 'discharged' ? '已釋放，需補充鋼瓶' : s.time < (r.readyAt || 0) ? '安裝中' : '運作中';
          const extra = { cooling: `冷卻能力 ${m.coolKW} kW`, ups: `UPS ${((m.capW || 0) / 1000).toFixed(0)} kW · 滿載約 ${m.runtime} 分鐘`, cdu: `液冷能力 ${m.coolKW} kW（GPU 發熱 ${((fac && fac.liquidHeat) || 0).toFixed(1)} kW）`,
            fire: { VESDA: '取樣管持續抽空氣分析：冒煙階段就告警', 'GAS-FS': '起火時釋放惰性氣體滅火，設備不泡水', PREACT: '兩段式觸發的灑水系統' }[r.model], ems: '溫濕度、漏水、煙霧、門禁監控', contain: '冷熱空氣不混合：冷卻 +20%' }[m.kind] || '';
          return [m.name, `狀態：${st}`, extra];
        }
        if (p.kind === 'slot') {
          const sel = opts.sel ? opts.sel() : {};
          const d = sel.armed && s.devices[sel.armed];
          return d ? [`安裝到 ${p.rack} 第 ${p.u}U`, `${d.name}（${CAT.devices[d.model].u}U）`, '點一下上架'] : null;
        }
        if (p.kind === 'link') {
          const l = s.links[p.id];
          if (!l) return null;
          const ls = G.R.sim && G.R.sim.links[l.id];
          const st = G.Net.linkBuilding(l) ? '施工中' : l.status !== 'up' ? '中斷！' : G.Net.linkUp(l) ? '正常' : '一端設備沒有運作';
          const toFloor = l.a.startsWith('F:') || l.b.startsWith('F:');
          return [`${G.Q.nodeName(l.a)} ⇄ ${G.Q.nodeName(l.b)}`, `${CAT.cables[l.cable].name} · ${U.speed(l.speed)} × ${l.count}`, `狀態：${st}${ls ? ' · 使用率 ' + U.pct(ls.util) : ''}`, toFloor ? '經線槽到弱電豎井，再往上到樓層 IDF' : '機房內跳線：走機櫃上方的線槽'];
        }
        if (p.kind === 'isp') {
          const c = s.isp.find((x) => x.id === p.id);
          return c ? [`${CAT.isp.providers[c.provider].name} ${c.plan} 專線`, `ISP 單模光纖（OS2）接到 ${s.devices[c.router] ? s.devices[c.router].name : '路由器'}`] : null;
        }
        return null;
      },
      click(p) {
        if (p.kind === 'dev' && opts.onDev) opts.onDev(p.id);
        else if (p.kind === 'rack' && opts.onRack) opts.onRack(p.id);
        else if (p.kind === 'slot' && opts.onSlot) opts.onSlot(p.rack, p.u);
        selSig = '';
      },
      dispose() {
        offTheme();
        for (const t of [...tags.racks, ...tags.fac, tags.alert, exitTags.riser, exitTags.isp]) t.remove();
        for (const m of cabMats.values()) m.dispose();
      },
    };
  }
})(window.G = window.G || {});
