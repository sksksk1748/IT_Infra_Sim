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
    };
    const ledG = new T.BoxGeometry(0.11, 0.11, 0.05);

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
        const tag = api.tag(r.id, 'ok');
        tag.pos.set(p.x, R.H + 1.2 + (i % 2) * 1.6, p.z + p.dir * 2);
        tags.racks.push(tag);
        rackInfo.push({ id: r.id, g, p, tag });
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
        if (!d.rack) continue;
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
      let zc = 21, upsX = 17;
      for (const r of s.room) {
        const m = CAT.room[r.model];
        let g, size;
        if (m.kind === 'cooling' && r.model !== 'AC-8') {
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
          const load = fr ? fr.load : 0;
          const on = !!fac && fac.mdfPowered && !fac.rackTripped[ri.id] && load > 0;
          return { x: ri.p.x, y0: R.U0 + 2 * R.UH, y1: R.U0 + 40 * R.UH, front: ri.p.z + ri.p.dir * R.D / 2, back: ri.p.z - ri.p.dir * R.D / 2, dir: ri.p.dir, heat: U.clamp(load / CAT.rack.powerLimit, 0.12, 1), on };
        });
      },
      cooling: () => { const f = G.R.fac; if (!f || !f.coolingOn || f.coolCap <= 0) return 0; return U.clamp(f.coolCap / Math.max(f.heat, 3), 0.25, 1); },
      warm: () => U.clamp((G.S.temp - 21) / 14, 0, 1),
    });
    root.add(air.obj);

    /* ---- 狀態同步 ---- */
    const devState = (d) => {
      const fac = G.R.fac;
      if (d.status === 'failed' || d.status === 'rma' || d.encrypted) return 'bad';
      if (fac && (!fac.mdfPowered || fac.rackTripped[d.rack])) return 'off';
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
      const sF = s.room.map((r) => r.id + ':' + r.model).join(',');
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
        const load = fr ? fr.load : 0, lim = CAT.rack.powerLimit;
        const trip = fac && fac.rackTripped[ri.id];
        ri.tag.set(trip ? `${ri.id} ⚡跳脫` : `${ri.id} ${(load / 1000).toFixed(1)}kW`, trip || load > lim ? 'bad' : load > lim * 0.85 ? 'warn' : 'ok');
      }
      for (const fi of facInfo) {
        const building = s.time < (fi.r.readyAt || 0);
        fi.g.visible = !building;
        fi.ghost.visible = building;
        fi.bc.visible = fi.r.status === 'failed';
        fi.tag.show = building || fi.r.status === 'failed';
        if (fi.tag.show) fi.tag.set(building ? `安裝中 ${U.dur(fi.r.readyAt - s.time)}` : `${CAT.room[fi.r.model].name} 故障`, building ? 'info' : 'bad');
      }
      syncSel();
      let a = '', ac = 'bad';
      if (fac) {
        if (!fac.mdfPowered) a = fac.overheat ? '機房過熱！設備緊急關機' : '機房斷電！';
        else if (fac.onBattery) { a = `市電中斷 · UPS 供電中 ${Math.round(s.power.upsCharge * 100)}%`; ac = 'warn'; }
        else if (fac.genRunning) { a = '市電中斷 · 發電機運轉中'; ac = 'warn'; }
        else if (s.temp >= 35) a = `機房溫度 ${s.temp.toFixed(1)}°C：設備開始故障`;
        else if (s.temp >= 27) { a = `機房溫度偏高 ${s.temp.toFixed(1)}°C`; ac = 'warn'; }
      }
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
        for (const di of devInfo.values()) if (di.blink) di.led.visible = Math.sin(t * Math.PI * di.blink) > -0.2;
        else if (!di.led.visible) di.led.visible = true;
        for (const fi of facInfo) if (fi.bc.visible) fi.bc.material.emissiveIntensity = Math.sin(t * 8) > 0 ? 2.2 : 0.2;
        const fac = G.R.fac;
        alarm.intensity = fac && !fac.mdfPowered ? (Math.sin(t * 5) > 0 ? 2.2 : 0.3) : 0;
        M.slot.opacity = 0.2 + 0.15 * (0.5 + 0.5 * Math.sin(t * 4));
      },
      pickables: () => [racksG, facG, slotG],
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
          return [`機櫃 ${p.id}`, `用電 ${fr ? (fr.load / 1000).toFixed(2) : 0} / ${CAT.rack.powerLimit / 1000} kW`, `已用 ${fr ? fr.used : 0}U / ${CAT.rack.units}U`, fac && fac.rackTripped[p.id] ? '⚡ 用電超過上限，斷路器跳脫' : '正面朝冷通道、背面朝熱通道'];
        }
        if (p.kind === 'fac') {
          const r = s.room.find((x) => x.id === p.id);
          if (!r) return null;
          const m = CAT.room[r.model];
          const st = r.status === 'failed' ? '故障' : s.time < (r.readyAt || 0) ? '安裝中' : '運作中';
          return [m.name, `狀態：${st}`, m.kind === 'cooling' ? `冷卻能力 ${m.coolKW} kW` : m.kind === 'ups' ? `UPS ${(m.capW / 1000).toFixed(0)} kW · 滿載約 ${m.runtime} 分鐘` : ''];
        }
        if (p.kind === 'slot') {
          const sel = opts.sel ? opts.sel() : {};
          const d = sel.armed && s.devices[sel.armed];
          return d ? [`安裝到 ${p.rack} 第 ${p.u}U`, `${d.name}（${CAT.devices[d.model].u}U）`, '點一下上架'] : null;
        }
        return null;
      },
      click(p) {
        if (p.kind === 'dev' && opts.onDev) opts.onDev(p.id);
        else if (p.kind === 'rack' && opts.onRack) opts.onRack(p.id);
        else if (p.kind === 'slot' && opts.onSlot) opts.onSlot(p.rack, p.u);
        selSig = '';
      },
      dispose() { for (const t of [...tags.racks, ...tags.fac, tags.alert]) t.remove(); },
    };
  }
})(window.G = window.G || {});
