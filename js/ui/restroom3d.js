/* 3D 廁所（每層樓核心筒裡的男廁、女廁、無障礙廁所）：隔間與馬桶、小便斗、洗手台與鏡子、門口標示；
 * 智慧廁所的感測器（門口的人流計數器、IDF 裡的 IoT 閘道器）與燈號；清潔人員推著清潔車巡廁所、在門口放「小心地滑」；
 * 漏水事件被發現後，地上的積水越漏越大（無障礙廁所的水會滲進隔壁的 IDF）。
 * 由 floor3d 呼叫：M3.restroom(ctx) → { sync(st), tick(dt, t), tip(p), dispose() }
 * 座標：平面圖 (x, y) → 世界 (wx(x), 高度, wz(y))，1 格 = 1 m。
 */
(function (G) {
  'use strict';
  const U = G.U, M3 = G.M3;
  if (!M3) return;
  const noop = () => {};
  const SKIN = ['#f1c9a5', '#e0ac85', '#c68b65'];

  M3.restroom = (ctx) => {
    const { api, K, L, fid, root, wx, wz, batch } = ctx;
    if (!L.wc) return null;
    const T = api.T, W = L.W, H = L.H;
    const C = (hex) => K.col(hex);
    const mats = [], geos = [], tags = [];
    const own = (m) => { mats.push(m); return m; };
    const geo = (x) => { geos.push(x); return x; };
    const tag = (text, cls, align, prio) => { const x = api.tag(text, cls, align, prio); tags.push(x); return x; };
    const kbox = (w, hh, d, m) => { const b = K.box(w, hh, d, m); geos.push(b.geometry); return b; };
    const g = new T.Group();
    root.add(g);
    const Rest = G.Rest;
    const WC = {};
    for (const w of L.wc) WC[w.k] = w;
    /** 房間內緣（世界座標）與門口朝外的方向 */
    const inner = (w) => ({ x0: wx(w.x0) - 0.5, x1: wx(w.x1) + 0.5, z0: wz(w.y0) - 0.5, z1: wz(w.y1) + 0.5 });
    const outDir = (w) => (w.door[1] < w.y0 ? -1 : 1);
    const PICK = { kind: 'wc' };
    const B = {
      china: batch(own(K.std('#f4f6f7', { metalness: 0.05, roughness: 0.25 })), PICK),
      part: batch(own(K.std('#8fa6b3', { metalness: 0.05, roughness: 0.6 })), PICK),
      door: batch(own(K.std('#6f8795', { metalness: 0.05, roughness: 0.55 })), PICK),
      counter: batch(own(K.std('#d9d3c5', { metalness: 0.05, roughness: 0.4 })), PICK),
      mirror: batch(own(K.std('#a9cfe0', { metalness: 0.9, roughness: 0.08 })), PICK),
      steel: batch(own(K.std('#c9d1d6', { metalness: 0.85, roughness: 0.25 })), null),
      signM: batch(own(K.glow('#2f6fd0', 0.5)), { kind: 'wcsign' }),
      signF: batch(own(K.glow('#d04a3f', 0.5)), { kind: 'wcsign' }),
    };
    /** 馬桶：水箱靠牆（nx, nz = 從牆面朝房間內的方向） */
    function toilet(x, z, nx, nz) {
      B.china.add(x + nx * 0.12, 0.62, z + nz * 0.12, nx ? 0.2 : 0.42, 0.42, nz ? 0.2 : 0.42);
      B.china.add(x + nx * 0.45, 0.22, z + nz * 0.45, nx ? 0.55 : 0.38, 0.42, nz ? 0.55 : 0.38);
    }
    /** 洗手台：檯面 + 臉盆 + 水龍頭 + 牆上的鏡子（沿著 x 或 z 方向排） */
    function vanity(x, z, len, alongX, nx, nz, n, open) {
      B.counter.add(x + nx * 0.28, 0.84, z + nz * 0.28, alongX ? len : 0.55, 0.08, alongX ? 0.55 : len);
      /* 無障礙洗手台下方要淨空，輪椅才靠得過去 */
      if (!open) B.counter.add(x + nx * 0.28, 0.42, z + nz * 0.28, alongX ? len : 0.5, 0.8, alongX ? 0.5 : len);
      for (let i = 0; i < n; i++) {
        const o = (i + 0.5) / n * len - len / 2;
        const bx = x + nx * 0.3 + (alongX ? o : 0), bz = z + nz * 0.3 + (alongX ? 0 : o);
        B.china.add(bx, 0.9, bz, 0.38, 0.06, 0.32);
        B.steel.add(bx - nx * 0.18, 1.0, bz - nz * 0.18, 0.04, 0.16, 0.04);
      }
      B.mirror.add(x + nx * 0.02, 1.55, z + nz * 0.02, alongX ? len * 0.95 : 0.03, 0.8, alongX ? 0.03 : len * 0.95);
    }

    /* ---------- 男廁：洗手台在門口旁、小便斗靠東牆、兩間坐式馬桶靠西牆 ---------- */
    if (WC.M) {
      const r = inner(WC.M);
      vanity(r.x1 - 1, r.z0, 1.8, true, 0, 1, 2);
      for (let i = 0; i < 3; i++) {
        const z = r.z0 + 1.5 + i * 0.85;
        B.china.add(r.x1 - 0.17, 0.72, z, 0.3, 0.62, 0.38);
        if (i) B.part.add(r.x1 - 0.25, 1.05, z - 0.42, 0.5, 0.9, 0.03);
      }
      const d = 1.35, zs = [r.z0 + 1.1, r.z0 + 1.1 + (r.z1 - r.z0 - 1.1) / 2, r.z1];
      for (let i = 0; i < 2; i++) {
        const za = zs[i], zb = zs[i + 1];
        B.part.add(r.x0 + d / 2, 1.1, za, d, 1.9, 0.04);
        B.door.add(r.x0 + d, 1.1, (za + zb) / 2, 0.04, 1.8, zb - za - 0.08);
        toilet(r.x0, (za + zb) / 2, 1, 0);
      }
    }
    /* ---------- 女廁：洗手台在門口旁、四間坐式馬桶靠南牆 ---------- */
    if (WC.F) {
      const r = inner(WC.F);
      vanity(r.x0 + 1.05, r.z0, 1.9, true, 0, 1, 2);
      const n = 4, sw = (r.x1 - r.x0) / n, d = 1.45;
      for (let i = 0; i < n; i++) {
        const xa = r.x0 + i * sw, xb = xa + sw;
        if (i) B.part.add(xa, 1.1, r.z1 - d / 2, 0.04, 1.9, d);
        B.door.add((xa + xb) / 2, 1.1, r.z1 - d, sw - 0.08, 1.8, 0.04);
        toilet((xa + xb) / 2, r.z1, 0, -1);
      }
    }
    /* ---------- 無障礙廁所：馬桶 + 扶手、低位洗手台（輪椅可以進去迴轉） ---------- */
    if (WC.A) {
      const r = inner(WC.A);
      toilet(r.x1 - 0.55, r.z0, 0, 1);
      B.steel.add(r.x1 - 0.04, 0.75, r.z0 + 0.6, 0.05, 0.05, 0.8);
      B.steel.add(r.x1 - 0.95, 0.75, r.z0 + 0.45, 0.05, 0.05, 0.7);
      B.steel.add(r.x1 - 0.95, 0.4, r.z0 + 0.8, 0.05, 0.75, 0.05);
      vanity(r.x0, (r.z0 + r.z1) / 2 + 0.2, 0.9, false, 1, 0, 1, true);
    }
    /* ---------- 門口：男女標示牌（在門的旁邊） ---------- */
    for (const w of L.wc) {
      const dir = outDir(w);
      const fz = wz(w.door[1]) + dir * 0.51;
      (w.k === 'F' ? B.signF : B.signM).add(wx(w.door[0]) + 0.85, 1.65, fz, 0.32, 0.32, 0.03);
    }
    for (const b of Object.values(B)) b.build(g);

    /* ---------- 智慧廁所：門口上方的人流計數器（只算人數，不拍影像）+ IDF 裡的 IoT 閘道器 ---------- */
    const ledOk = own(K.glow('#3fe07a', 1.6)), ledBad = own(K.glow('#ff5a4f', 1.8)), ledWarn = own(K.glow('#ffb13b', 1.6));
    const sensG = new T.Group();
    g.add(sensG);
    const sensBody = own(K.std('#eef1f3', { metalness: 0.1, roughness: 0.4 }));
    const sensLeds = [];
    for (const w of L.wc) {
      const dir = outDir(w);
      const s = kbox(0.22, 0.06, 0.12, sensBody);
      s.position.set(wx(w.door[0]), 2.14, wz(w.door[1]) + dir * 0.44);
      s.userData.pick = { kind: 'wcsensor' };
      const led = new T.Mesh(geo(new T.SphereGeometry(0.025, 8, 6)), ledOk);
      led.position.set(wx(w.door[0]) + 0.07, 2.1, wz(w.door[1]) + dir * 0.51);
      led.raycast = noop;
      sensG.add(s, led);
      sensLeds.push(led);
    }
    /* 閘道器掛在 IDF 西牆上，網路線接到機櫃裡的接入交換器（PoE 供電） */
    const gwG = new T.Group();
    const idfX0 = wx(L.idf.x - 1) - 0.5;
    const gw = kbox(0.08, 0.3, 0.4, sensBody);
    gw.position.set(idfX0 + 0.06, 1.75, wz(L.idf.y - 1) + 0.1);
    gw.userData.pick = { kind: 'iotgw' };
    const gwLed = new T.Mesh(geo(new T.SphereGeometry(0.03, 8, 6)), ledOk);
    gwLed.position.set(idfX0 + 0.11, 1.84, wz(L.idf.y - 1) - 0.02);
    gwLed.raycast = noop;
    const ant = kbox(0.02, 0.2, 0.02, own(K.std('#2a3238', { roughness: 0.5 })));
    ant.position.set(idfX0 + 0.08, 2.0, wz(L.idf.y - 1) + 0.25);
    ant.raycast = noop;
    gwG.add(gw, gwLed, ant);
    g.add(gwG);

    /* ---------- 清潔人員：推著清潔車，進去打掃時車子停在門口、放一個「小心地滑」 ---------- */
    const uniM = own(K.std('#4fae9f', { metalness: 0, roughness: 0.85 }));
    const bodyG = geo(new T.CylinderGeometry(0.16, 0.2, 0.9, 10)); bodyG.translate(0, 0.95, 0);
    const headG = geo(new T.SphereGeometry(0.12, 12, 9)); headG.translate(0, 1.54, 0);
    const capG = geo(new T.CylinderGeometry(0.125, 0.125, 0.06, 12)); capG.translate(0, 1.64, 0);
    const mopG = geo(new T.CylinderGeometry(0.015, 0.015, 1.35, 6));
    const cartM = own(K.std('#6f7d86', { metalness: 0.3, roughness: 0.6 })), bucketM = own(K.std('#e8c547', { roughness: 0.5 }));
    const signM = own(K.std('#f2c230', { roughness: 0.5 }));
    const crews = [];
    for (let i = 0; i < 3; i++) {
      const p = new T.Group();
      const body = new T.Mesh(bodyG, uniM), head = new T.Mesh(headG, own(K.std(SKIN[i % SKIN.length], { metalness: 0, roughness: 0.7 }))), cap = new T.Mesh(capG, uniM);
      const mop = new T.Mesh(mopG, K.std('#c9d1d6', { metalness: 0.6, roughness: 0.4 }));
      mats.push(mop.material);
      mop.position.set(0.28, 0.66, 0.28); mop.rotation.x = 0.5;
      const mopHead = kbox(0.34, 0.05, 0.12, own(K.std('#e9e6df', { roughness: 0.9 })));
      mopHead.position.set(0.28, 0.03, 0.6);
      p.add(body, head, cap, mop, mopHead);
      p.userData.pick = { kind: 'cleaner', i };
      const cart = new T.Group();
      const cb = kbox(0.5, 0.7, 0.85, cartM); cb.position.y = 0.45;
      const bk = new T.Mesh(geo(new T.CylinderGeometry(0.17, 0.14, 0.28, 12)), bucketM); bk.position.set(0, 0.94, 0.2);
      const rl = kbox(0.04, 0.5, 0.5, cartM); rl.position.set(0, 1.0, -0.2);
      cart.add(cb, bk, rl);
      cart.userData.pick = { kind: 'cleaner', i };
      const sign = new T.Mesh(geo(new T.ConeGeometry(0.2, 0.62, 4)), signM);
      sign.position.y = 0.31; sign.rotation.y = Math.PI / 4;
      sign.userData.pick = { kind: 'wetsign' };
      p.visible = cart.visible = sign.visible = false;
      g.add(p, cart, sign);
      crews.push({ p, cart, sign, k: null });
    }

    /* ---------- 漏水：地上的積水（被發現後才畫得出來） ---------- */
    const waterM = own(new T.MeshStandardMaterial({ color: C('#4aa8ff'), transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0.4, depthWrite: false }));
    const puddle = new T.Mesh(geo(new T.CircleGeometry(1, 28)), waterM);
    puddle.rotation.x = -Math.PI / 2;
    puddle.userData.pick = { kind: 'leak' };
    puddle.visible = false;
    const idfWater = new T.Mesh(geo(new T.PlaneGeometry(1, 1)), waterM);
    idfWater.rotation.x = -Math.PI / 2;
    idfWater.userData.pick = { kind: 'leak' };
    idfWater.visible = false;
    g.add(puddle, idfWater);

    /* ---------- 標籤：有感測器（而且連得到平台）才看得到即時狀況 ---------- */
    const tagOf = {};
    for (const w of L.wc) {
      const r = inner(w);
      const t = tag(Rest.RM[w.k].name, '', 'center', 0);
      t.pos.set((r.x0 + r.x1) / 2, 3.45, (r.z0 + r.z1) / 2);
      tagOf[w.k] = t;
    }

    let leakInc = null, iot = false, iotOk = false;
    const cellOf = (pt) => ({ x: U.clamp(Math.floor(pt[0] + W / 2), 0, W - 1), y: U.clamp(Math.floor(pt[2] + H / 2), 0, H - 1) });
    const wcAt = (pt) => { if (!pt) return null; const c = cellOf(pt); return L.wc.find((w) => c.x >= w.x0 - 1 && c.x <= w.x1 + 1 && c.y >= w.y0 - 1 && c.y <= w.y1 + 1) || null; };
    const roomLine = (k) => {
      const x = Rest.room(fid, k);
      if (!iotOk) return iot ? '感測器連不到 IoT 平台：看不到即時狀況' : `沒有感測器：只知道上次打掃是 ${x.last ? U.dur(G.S.time - x.last) + '前' : '還沒打掃過'}`;
      return `整潔 ${Math.round(x.clean)}%・衛生紙 ${Math.round(x.paper)}%・洗手乳 ${Math.round(x.soap)}%${x.clog ? '・馬桶堵住' : ''}${x.leak ? '・⚠ 漏水' : ''}`;
    };

    return {
      sync() {
        const s = G.S;
        iot = Rest.hasIot(fid);
        iotOk = Rest.iotOk(fid);
        sensG.visible = gwG.visible = iot;
        gwLed.material = iotOk ? ledOk : ledBad;
        /* 標籤與門口感測器燈號 */
        L.wc.forEach((w, i) => {
          const x = Rest.room(fid, w.k), nm = Rest.RM[w.k].name;
          const c = Rest.crewAt(fid).find((q) => q.k === w.k);
          const doing = c ? (s.time < c.start ? '・清潔人員來了' : '・清潔中') : '';
          if (!iotOk) {
            tagOf[w.k].set(nm + (iot ? '・感測器離線' : '') + doing, iot ? 'warn' : '');
            sensLeds[i].material = ledBad;
          } else {
            const bad = x.leak || x.clog || Rest.roomQ(x) < 0.7, warn = Rest.need(x) >= 200;
            tagOf[w.k].set(`${nm}・衛生紙 ${Math.round(x.paper)}%・整潔 ${Math.round(x.clean)}%${x.leak ? '・漏水' : x.clog ? '・堵住' : ''}${doing}`, bad ? 'bad' : warn ? 'warn' : 'ok');
            sensLeds[i].material = bad ? ledBad : warn ? ledWarn : ledOk;
          }
        });
        /* 漏水（事件被發現才顯示） */
        leakInc = G.Ev.visible().find((i) => i.type === 'rest-leak' && i.data.fid === fid) || null;
        puddle.visible = !!leakInc;
        idfWater.visible = !!(leakInc && leakInc.data.idf);
        if (leakInc) {
          const w = WC[leakInc.data.k], r = inner(w);
          const k = U.clamp((leakInc.data.water || 0) / 90, 0.25, 1);
          puddle.position.set((r.x0 + r.x1) / 2, 0.04, (r.z0 + r.z1) / 2);
          puddle.scale.set(Math.max(0.6, (r.x1 - r.x0) / 2 * k + 0.2), Math.max(0.6, (r.z1 - r.z0) / 2 * k + 0.2), 1);
          if (idfWater.visible) {
            idfWater.position.set(wx(L.idf.x), 0.04, wz(L.idf.y));
            idfWater.scale.set(2.9, 2.9, 1);
          }
        }
      },
      tick(dt, t) {
        const s = G.S, list = Rest.crewAt(fid);
        for (let i = 0; i < crews.length; i++) {
          const cr = crews[i], c = list[i], w = c && WC[c.k];
          const on = !!(w && Rest.dayShift(s.time));
          cr.p.visible = cr.cart.visible = on;
          cr.sign.visible = on && s.time >= c.start;
          if (!on) continue;
          const dir = outDir(w), dx = wx(w.door[0]), dz = wz(w.door[1]);
          const r = inner(w);
          if (s.time < c.start) {
            /* 推著清潔車走到門口 */
            cr.p.position.set(dx - 0.35, 0, dz + dir * 1.25);
            cr.p.rotation.y = dir < 0 ? 0 : Math.PI;
            cr.cart.position.set(dx - 0.35, 0, dz + dir * 1.95);
            cr.cart.rotation.y = 0;
          } else {
            /* 在裡面拖地：沿著走道來回 */
            const ph = Math.sin(t * 0.7 + i * 2.1), v = Math.cos(t * 0.7 + i * 2.1);
            let px, pz, ry;
            if (w.k === 'M') { px = r.x0 + 1.95; pz = (r.z0 + 1.6 + r.z1 - 0.5) / 2 + ph * 0.9; ry = v > 0 ? 0 : Math.PI; }
            else if (w.k === 'F') { px = (r.x0 + r.x1) / 2 + ph * 1.5; pz = r.z0 + 1.35; ry = v > 0 ? Math.PI / 2 : -Math.PI / 2; }
            else { px = (r.x0 + r.x1) / 2 - 0.1; pz = (r.z0 + r.z1) / 2 + 0.35 + ph * 0.3; ry = Math.PI; }
            cr.p.position.set(px, 0, pz);
            cr.p.rotation.y = ry + Math.sin(t * 3.2 + i) * 0.35;
            cr.cart.position.set(dx + 0.75, 0, dz + dir * 1.05);
            cr.cart.rotation.y = Math.PI / 2;
            cr.sign.position.set(dx - 0.7, 0.31, dz + dir * 0.95);
          }
        }
      },
      tip(p) {
        const w = wcAt(p.pt);
        if (p.kind === 'iotgw') return ['IoT 閘道器（智慧廁所）', iotOk ? '✓ 感測器資料經 MQTT 送到 IoT 管理平台' : `⚠ ${Rest.iotWhy(fid)}`, `接在 IDF 的接入交換器上：佔 1 個埠、PoE ${G.CAT.rest.iotGw.poe} W`, G.S.fw.iotVlan ? '在 IoT 獨立網段（VLAN 600）：和員工電腦隔開' : '還在員工內網：建議開啟 IoT 獨立網段'];
        if (p.kind === 'wcsensor') return ['人流計數器（門口上方）', '紅外線 / ToF 只算進出人數，不拍影像——廁所裡不能裝攝影機', iotOk ? '✓ 用使用人次推估衛生紙與清潔需求' : '⚠ 資料送不到 IoT 平台'];
        if (p.kind === 'cleaner') {
          const c = Rest.crewAt(fid)[p.i];
          return ['清潔人員', c ? `${Rest.RM[c.k].name}：${G.S.time < c.start ? '推著清潔車走過來' : '正在打掃、補衛生紙與洗手乳'}` : '巡廁所中', iotOk ? '智慧廁所：哪一間需要就先去哪一間' : '沒有感測器：照固定路線一間一間巡', `全大樓白班 ${G.S.rest.staff} 人（建議 ${Rest.recommend()} 人）`];
        }
        if (p.kind === 'wetsign') return ['「小心地滑」告示牌', '拖完地還沒乾：清潔中'];
        if (p.kind === 'leak' && leakInc) return ['⚠ 漏水積水', `${leakInc.title}・已經漏了 ${leakInc.data.water} 分鐘`, leakInc.data.idf ? '水已經滲進 IDF：交換器泡水短路，整層斷網' : leakInc.data.k === 'A' ? '無障礙廁所和 IDF 只隔一道牆：再不關水就會淹進 IDF' : '先關止水閥，再請水電修接頭', '點「事件」處理'];
        if ((p.kind === 'wc' || p.kind === 'wcsign') && w) return [Rest.RM[w.k].name, roomLine(w.k), w.k === 'A' ? '無障礙廁所：和 IDF 弱電室只隔一道牆' : '磁磚牆與給排水管：Wi-Fi 訊號穿不太過去', '廁所裡不裝 AP：走道的 AP 就蓋得到'];
        return null;
      },
      kinds: ['wc', 'wcsign', 'wcsensor', 'iotgw', 'cleaner', 'wetsign', 'leak'],
      dispose() {
        for (const x of tags) x.remove();
        for (const m of mats) m.dispose();
        for (const x of geos) x.dispose();
      },
    };
  };
})(window.G = window.G || {});
