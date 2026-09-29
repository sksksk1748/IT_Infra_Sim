/* 玩家操作：所有會改變遊戲狀態的動作都集中在這裡
 * 每個動作回傳 { ok, msg }，UI 以提示訊息顯示結果。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Act = {};
  G.Act = Act;

  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg) => ({ ok: false, msg });
  const changed = (what, extra) => G.bus.emit('change', Object.assign({ what }, extra || {}));
  const topo = () => { G.R.topoVer++; };

  Act.log = (text, kind) => {
    const s = G.S;
    s.log.push({ t: s.time, text, kind: kind || 'info' });
    if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
  };
  Act.spend = (amount, label) => {
    const s = G.S;
    amount = Math.round(amount);
    if (amount <= 0) return true;
    if (s.money < amount) return false;
    s.money -= amount;
    s.stats.spent += amount;
    Act.log(`${label}：−${U.money(amount)}`, 'money');
    return true;
  };
  Act.refund = (amount, label) => {
    amount = Math.round(amount);
    if (amount <= 0) return;
    G.S.money += amount;
    Act.log(`${label}：+${U.money(amount)}`, 'money');
  };
  const need = (amount) => err(`預算不足：需要 ${U.money(amount)}，目前只有 ${U.money(G.S.money)}`);

  /* ---------- 機櫃與機房設施 ---------- */
  /** 採購機櫃：一般 42U 機櫃（PDU 8 kW），或 AI 機櫃（ORv3，電力由電源櫃決定） */
  Act.buyRack = (type) => {
    const s = G.S;
    const ai = type === 'ai';
    const spec = ai ? CAT.rack.ai : CAT.rack;
    if (s.racks.length >= CAT.rack.maxRacks) return err(`B1 機房的空間最多容納 ${CAT.rack.maxRacks} 座機櫃`);
    if (ai && !Q.unlocked(spec)) return err(`第 ${spec.unlock} 章解鎖`);
    if (ai && s.racks.filter((r) => r.type === 'ai').length >= spec.max) return err(`AI 機櫃最多 ${spec.max} 座（機房的電力與液冷管路有限）`);
    if (!Act.spend(spec.price, ai ? `採購 ${spec.name}` : '採購 42U 機櫃')) return need(spec.price);
    const prefix = ai ? 'A' : 'R';
    let n = s.racks.filter((r) => (r.type === 'ai') === ai).length + 1;
    while (s.racks.some((r) => r.id === prefix + n)) n++;
    const id = prefix + n;
    s.racks.push(ai ? { id, type: 'ai', bbu: 1 } : { id });
    changed('rack');
    return ok(ai ? `AI 機櫃 ${id} 已就位：先裝電源櫃（PSU）與 BBU，才能裝 GPU 伺服器` : `機櫃 ${id} 已就位`, { id });
  };
  Act.setCoolSet = (v) => {
    const s = G.S;
    if (!CAT.coolSets.includes(v)) return err('不支援的溫度');
    s.coolSet = v;
    changed('room');
    return ok(`空調送風溫度設定為 ${v}°C`);
  };
  Act.buyRoom = (model) => {
    const s = G.S, m = CAT.room[model];
    if (!m || m.buyable === false) return err('無法採購');
    if (!Q.unlocked(m)) return err(`第 ${m.unlock} 章解鎖`);
    if (m.kind === 'fire' && s.room.some((r) => r.model === model)) return err(`已經有${m.name}了`);
    /* 門禁只能往上升級（雙因子門禁沿用原本的讀卡機與電磁鎖） */
    if (m.kind === 'access') { const cur = s.room.filter((r) => CAT.room[r.model].kind === 'access').map((r) => CAT.room[r.model]); if (cur.some((c) => c.level >= m.level)) return err(`已經有${cur.find((c) => c.level >= m.level).name}了`); }
    const count = s.room.filter((r) => CAT.room[r.model].kind === m.kind).length;
    if (count >= CAT.roomSlots[m.kind]) return err('機房已沒有空間放置更多這類設備');
    if (!Act.spend(m.price, `採購 ${m.name}`)) return need(m.price);
    let id = Q.nextId('rm');
    while (s.room.some((r) => r.id === id)) id = Q.nextId('rm');
    s.room.push({ id, model, status: 'ok', readyAt: s.time + (m.buildMin || 0) });
    changed('room');
    return ok(`${m.name} 施工安裝中，約 ${U.dur(m.buildMin || 0)} 後啟用`);
  };
  Act.removeRoom = (id) => {
    const s = G.S;
    const i = s.room.findIndex((r) => r.id === id);
    if (i < 0) return err('找不到設備');
    const m = CAT.room[s.room[i].model];
    s.room.splice(i, 1);
    if (m.price) Act.refund(m.price * 0.3, `拆除 ${m.name}（殘值）`);
    changed('room');
    return ok(`已拆除 ${m.name}`);
  };
  /** 氣體滅火系統釋放後補充鋼瓶 */
  Act.refillGas = (id) => {
    const s = G.S, r = s.room.find((x) => x.id === id);
    if (!r || r.status !== 'discharged') return err('氣體滅火系統沒有釋放過');
    const cost = CAT.room[r.model].refill || 350000;
    if (!Act.spend(cost, '補充滅火氣體鋼瓶')) return need(cost);
    r.status = 'ok'; r.readyAt = s.time + 240;
    changed('room');
    return ok('鋼瓶補充中，約 4 小時後恢復保護');
  };
  Act.repairRoom = (id) => {
    const s = G.S, r = s.room.find((x) => x.id === id);
    if (!r || r.status !== 'failed') return err('此設備沒有故障');
    const cost = 60000;
    if (!Act.spend(cost, `維修 ${CAT.room[r.model].name}`)) return need(cost);
    r.status = 'ok'; r.readyAt = s.time + 90;
    changed('room');
    return ok('廠商維修中，約 1.5 小時後恢復');
  };

  /* ---------- 設備 ---------- */
  const PREFIX = { router: 'RTR', firewall: 'FW', server: 'SRV', wlc: 'WLC', ups: 'UPS', power: 'PSU', bbu: 'BBU', storage: 'STOR' };
  function defaultName(m) {
    const p = m.gpu ? 'GPU' : m.hv ? 'HV' : m.san ? 'SAN' : m.shelf ? 'DS' : m.tape ? 'TAPE' : m.roles && m.roles[0] === 'pbx' ? 'PBX' : m.roles && m.roles[0] === 'sbc' ? 'SBC' : m.roles && m.roles[0] === 'sdwan' ? 'SDW' : m.roles && m.roles[0] === 'aistore' ? 'AIS' : m.ai && m.cat === 'switch' ? 'AISW' : m.cat === 'switch' ? (m.layer === 3 ? 'CORE' : 'SW') : PREFIX[m.cat];
    const names = new Set(Object.values(G.S.devices).map((d) => d.name));
    let n = 1;
    while (names.has(`${p}-${n}`)) n++;
    return `${p}-${n}`;
  }
  Act.buyDevice = (model, qty) => {
    const s = G.S, m = CAT.devices[model];
    qty = qty || 1;
    if (!m) return err('未知設備');
    if (m.virtual) return err('VM 不用採購：在「系統 → 虛擬化」建立');
    if (!Q.unlocked(m)) return err(`第 ${m.unlock} 章解鎖`);
    const cost = m.price * qty;
    if (!Act.spend(cost, `採購 ${m.name}${qty > 1 ? ' × ' + qty : ''}`)) return need(cost);
    const ids = [];
    for (let i = 0; i < qty; i++) {
      const id = Q.nextId('d');
      /* 只有一種用途的伺服器（AI 運算、AI 儲存）直接設好角色 */
      s.devices[id] = { id, model, name: defaultName(m), rack: null, u: null, role: m.roles && m.roles.length === 1 && (m.ai || m.sys) ? m.roles[0] : null, status: 'ok', bootUntil: 0, boughtAt: s.time };
      if (m.rawTB && !m.shelf) s.devices[id].raid = 'raid6';
      ids.push(id);
    }
    changed('devices');
    return ok(`已採購 ${m.name}${qty > 1 ? ' × ' + qty : ''}，請到「機房」安裝上架`, { ids });
  };
  Act.rackOccupancy = (rackId) => {
    const occ = new Array(CAT.rack.units + 1).fill(null);
    for (const d of Object.values(G.S.devices)) {
      if (d.rack !== rackId) continue;
      const m = CAT.devices[d.model];
      for (let u = d.u; u < d.u + m.u; u++) occ[u] = d.id;
    }
    return occ;
  };
  Act.fits = (rackId, u, size, ignoreId) => {
    if (u < 1 || u + size - 1 > CAT.rack.units) return false;
    const occ = Act.rackOccupancy(rackId);
    for (let k = u; k < u + size; k++) if (occ[k] && occ[k] !== ignoreId) return false;
    return true;
  };
  /** 機櫃目前用電（W） */
  Act.rackLoad = (rackId, ignoreId) => U.sum(Object.values(G.S.devices).filter((d) => d.rack === rackId && d.id !== ignoreId && d.status !== 'failed'), (d) => CAT.devices[d.model].watts);
  /** 能不能裝進這座機櫃（空間以外的條件：機櫃類型與電力） */
  Act.rackCheck = (d, rackId) => {
    const s = G.S, m = CAT.devices[d.model];
    const rack = s.racks.find((r) => r.id === rackId);
    if (!rack) return '找不到機櫃';
    const ai = rack.type === 'ai';
    if (m.aiRack && !ai) return `${m.name} 要裝在 AI 機櫃（ORv3，背面有 54V 匯流排${m.liquid ? '與液冷管路' : ''}）。請先採購 AI 機櫃。`;
    const load = Act.rackLoad(rackId, d.id);
    if (!ai) {
      if (load + m.watts > CAT.rack.powerLimit) return `機櫃 ${rackId} 的 PDU 只剩 ${Math.max(0, CAT.rack.powerLimit - load)} W，裝上 ${d.name}（${m.watts} W）會超過 ${CAT.rack.powerLimit / 1000} kW 上限、讓斷路器跳脫。請換一座機櫃。`;
      return null;
    }
    if (m.watts > 0) {
      const p = G.Fac.aiRackPower(rackId);
      if (p.total <= 0) return `AI 機櫃 ${rackId} 還沒有電源櫃：先裝一台 PS-33 電源櫃（PSU），機櫃才有電。`;
      if (load + m.watts > p.total) return `AI 機櫃 ${rackId} 的電源櫃只能供 ${(p.total / 1000).toFixed(1)} kW，裝上 ${d.name}（${(m.watts / 1000).toFixed(1)} kW）會超過容量而跳電。請再加裝一台電源櫃。`;
    }
    return null;
  };
  Act.installDevice = (id, rackId, u) => {
    const s = G.S, d = s.devices[id];
    if (!d) return err('找不到設備');
    if (!s.racks.find((r) => r.id === rackId)) return err('找不到機櫃');
    const m = CAT.devices[d.model];
    if (!Act.fits(rackId, u, m.u, d.id)) return err(`這個位置放不下（需要 ${m.u}U 連續空間）`);
    const bad = Act.rackCheck(d, rackId);
    if (bad) return err(bad);
    d.rack = rackId; d.u = u;
    d.bootUntil = s.time + (CAT.bootMin[m.cat] || 5);
    topo();
    changed('devices');
    return ok(`${d.name} 已安裝於 ${rackId} 的 U${u}${m.u > 1 ? '–U' + (u + m.u - 1) : ''}，開機中…`);
  };
  Act.autoInstall = (id) => {
    const s = G.S, d = s.devices[id];
    if (!d) return err('找不到設備');
    const m = CAT.devices[d.model];
    /* 電源櫃、BBU 放 AI 機櫃最下面；網路設備由上往下放；其他由下往上 */
    const topDown = ['router', 'firewall', 'switch', 'wlc'].includes(m.cat);
    /* AI 設備優先放 AI 機櫃，一般設備優先放一般機櫃 */
    const racks = s.racks.slice().sort((a, b) => ((a.type === 'ai') === !!m.ai ? 0 : 1) - ((b.type === 'ai') === !!m.ai ? 0 : 1));
    let why = null;
    for (const r of racks) {
      const bad = Act.rackCheck(d, r.id);
      if (bad) { why = why || bad; continue; }
      if (topDown) { for (let u = CAT.rack.units - m.u + 1; u >= 1; u--) if (Act.fits(r.id, u, m.u, d.id)) return Act.installDevice(id, r.id, u); }
      else { for (let u = 1; u <= CAT.rack.units - m.u + 1; u++) if (Act.fits(r.id, u, m.u, d.id)) return Act.installDevice(id, r.id, u); }
    }
    if (!s.racks.length) return err('還沒有機櫃，請先採購 42U 機櫃');
    return err(why || '所有機櫃都滿了，請再採購一座機櫃');
  };
  Act.uninstallDevice = (id) => {
    const d = G.S.devices[id];
    if (!d || !d.rack) return err('設備不在機櫃上');
    d.rack = null; d.u = null;
    topo();
    changed('devices');
    return ok(`${d.name} 已下架（線路保留，重新上架後即可恢復）`);
  };
  Act.sellDevice = (id) => {
    const s = G.S, d = s.devices[id];
    if (!d) return err('找不到設備');
    const m = CAT.devices[d.model];
    if (d.host) return G.VM.remove(id);
    if (m.hv && G.VM.onHost(id).length) return err(`${d.name} 上還有 ${G.VM.onHost(id).length} 台 VM：先遷移或刪除`);
    for (const l of Q.linksOf(id)) delete s.links[l.id];
    for (const c of s.isp) if (c.router === id) { c.router = null; c.port = null; }
    delete s.devices[id];
    Act.refund(m.price * 0.4, `出售二手 ${m.name}`);
    topo();
    changed('devices');
    return ok(`${d.name} 已出售，回收 ${U.money(m.price * 0.4)}`);
  };
  Act.renameDevice = (id, name) => {
    const d = G.S.devices[id];
    name = String(name || '').trim().slice(0, 16);
    if (!d || !name) return err('名稱不可空白');
    d.name = name;
    changed('devices');
    return ok('已更名');
  };
  Act.setRole = (id, role) => {
    const s = G.S, d = s.devices[id];
    if (!d) return err('找不到設備');
    const m = CAT.devices[d.model];
    if (role && !m.roles.includes(role)) return err(`${m.name} 不適合擔任 ${CAT.roles[role].name}`);
    d.role = role || null;
    d.encrypted = false;
    d.bootUntil = Math.max(d.bootUntil || 0, s.time + 3);
    topo();
    changed('devices');
    return ok(role ? `${d.name} 角色設定為「${CAT.roles[role].name}」，服務啟動中…` : '已清除角色');
  };
  Act.rma = (id) => {
    const s = G.S, d = s.devices[id];
    if (!d || d.status !== 'failed') return err('設備沒有故障');
    const m = CAT.devices[d.model];
    const cost = Math.round(m.price * 0.15);
    if (!Act.spend(cost, `RMA 送修 ${d.name}`)) return need(cost);
    d.status = 'rma'; d.readyAt = s.time + 240;
    changed('devices');
    return ok(`${d.name} 已申請 RMA，原廠約 4 小時後送來替換品`);
  };

  /* ---------- 線路 ---------- */
  Act.linkLength = (a, b) => {
    if (a.startsWith('F:')) return G.BLD.riserLength(a.slice(2));
    if (b.startsWith('F:')) return G.BLD.riserLength(b.slice(2));
    const da = G.S.devices[a], db = G.S.devices[b];
    if (da && db && da.rack && da.rack === db.rack) return 3;
    return 12;
  };
  function pickPort(nodeId, speed, medium, count, excludeId) {
    const P = Q.ports(nodeId);
    if (excludeId) {
      const l = G.S.links[excludeId];
      if (l) { if (l.a === nodeId) P[l.aPort].used -= l.count; if (l.b === nodeId) P[l.bPort].used -= l.count; }
    }
    const name = Q.nodeName(nodeId);
    const free = (c) => P[c].total - P[c].used;
    if (speed >= 40000) {
      if (!P.qsfp.total) return { err: `${name} 沒有 40/100G（QSFP）埠` };
      if (P.qsfp.max < speed) return { err: `${name} 的 QSFP 埠最高只到 ${U.speed(P.qsfp.max)}` };
      if (free('qsfp') < count) return { err: `${name} 的 QSFP 埠不足（剩 ${free('qsfp')} 個，需要 ${count} 個）` };
      return { cls: 'qsfp' };
    }
    if (medium === 'copper' && speed <= 1000 && free('rj45') >= count && !nodeId.startsWith('F:')) return { cls: 'rj45' };
    if (!P.sfp.total) {
      if (medium === 'copper' && speed <= 1000) return { err: `${name} 的 1G 銅纜埠不足` };
      return { err: `${name} 沒有 SFP 光纖埠` };
    }
    if (P.sfp.max < speed) return { err: `${name} 的 SFP 埠最高只到 ${U.speed(P.sfp.max)}` };
    if (free('sfp') < count) return { err: `${name} 的 SFP 埠不足（剩 ${free('sfp')} 個，需要 ${count} 個）` };
    return { cls: 'sfp' };
  }
  Act.defaultZone = (a, b) => {
    const ka = Q.nodeKind(a), kb = Q.nodeKind(b);
    if (ka === 'firewall' && kb === 'firewall') return 'ha';
    const other = ka === 'firewall' ? b : kb === 'firewall' ? a : null;
    if (!other) return null;
    const k = Q.nodeKind(other);
    if (k === 'router') return 'outside';
    if (k === 'server' || k === 'wlc' || k === 'storage') return 'dmz';
    if (k === 'switch') {
      const d = G.S.devices[other];
      return d && CAT.devices[d.model].layer === 2 && !Q.linksOf(other).some((l) => Q.nodeKind(Q.other(l, other)) === 'floor') ? 'dmz' : 'inside';
    }
    return 'inside';
  };
  Act.linkPreview = (a, b, cable, speed, count, zone, excludeId) => {
    const s = G.S;
    const errs = [], warns = [];
    const ka = Q.nodeKind(a), kb = Q.nodeKind(b);
    const na = Q.nodeName(a), nb = Q.nodeName(b);
    count = Math.max(1, Math.min(8, count | 0));
    if (a === b) errs.push('不能連到自己');
    if (ka === 'internet' || kb === 'internet' || ka === 'isp' || kb === 'isp') errs.push('ISP 線路請在 ISP 節點上選「接到路由器」');
    const infraId = (id) => { const d = s.devices[id]; return !!d && CAT.infra(CAT.devices[d.model]); };
    if (infraId(a) || infraId(b)) errs.push('UPS、電源櫃、BBU 與儲存擴充櫃不是網路設備');
    if ((s.devices[a] && s.devices[a].host) || (s.devices[b] && s.devices[b].host)) errs.push('VM 是虛擬的：它的網路走所在主機的網卡，請把主機接上交換器');
    if (ka === 'floor' && kb === 'floor') errs.push('樓層之間不直接互連，請各自上連到 B1 核心');
    const endpoint = (k) => k === 'server' || k === 'wlc' || k === 'storage';
    if ((ka === 'floor' && endpoint(kb)) || (kb === 'floor' && endpoint(ka))) errs.push('樓層 IDF 應上連到交換器（核心），不是伺服器');
    if ((ka === 'floor' && kb === 'router') || (kb === 'floor' && ka === 'router')) warns.push('樓層直接接路由器會繞過防火牆！');
    if (endpoint(ka) && endpoint(kb)) errs.push('伺服器之間請透過交換器互連');
    for (const [id, k] of [[a, ka], [b, kb]]) {
      if (k === 'floor') {
        const fs = s.floors[id.slice(2)];
        if (fs.idf.count <= 0) errs.push(`${id.slice(2)} 的 IDF 還沒有接入交換器`);
      } else if (s.devices[id] && !s.devices[id].rack) errs.push(`${Q.nodeName(id)} 尚未安裝到機櫃`);
    }
    const len = Act.linkLength(a, b);
    const cab = CAT.cables[cable];
    let aPort = null, bPort = null;
    if (!cab) errs.push('請選擇線材');
    else {
      const maxD = cab.max[speed];
      if (!maxD) errs.push(`${cab.short} 不支援 ${U.speed(speed)}`);
      else if (len > maxD) errs.push(`${cab.short} 跑 ${U.speed(speed)} 最遠 ${maxD}m，這段需要 ${len}m`);
      if (!errs.length) {
        const pa = pickPort(a, speed, cab.medium, count, excludeId);
        const pb = pickPort(b, speed, cab.medium, count, excludeId);
        if (pa.err) errs.push(pa.err); else aPort = pa.cls;
        if (pb.err) errs.push(pb.err); else bPort = pb.cls;
      }
    }
    const fwEnds = (ka === 'firewall') + (kb === 'firewall');
    if (fwEnds === 2) zone = 'ha';
    else if (fwEnds === 1) {
      zone = zone || Act.defaultZone(a, b);
      if (zone === 'ha') errs.push('HA 同步線只能連接兩台防火牆');
      const other = ka === 'firewall' ? kb : ka;
      if (zone === 'outside' && other !== 'router') warns.push('外部 (OUTSIDE) 介面通常接路由器');
      if (zone === 'inside' && other === 'router') warns.push('路由器應接在防火牆的外部 (OUTSIDE) 介面');
    } else zone = null;
    let cost = 0, optics = 0;
    if (cab && aPort && bPort) {
      const op = (cls) => (cls === 'rj45' ? 0 : CAT.optics[cab.medium][speed] || 0);
      optics = (op(aPort) + op(bPort)) * count;
      cost = count * (len * cab.perM + cab.termCost) + optics;
    }
    const buildMin = (ka === 'floor' || kb === 'floor') ? CAT.riserBuildMin : 0;
    return { ok: errs.length === 0, errs, warns, len, cost: Math.round(cost), optics, aPort, bPort, zone, buildMin, count, na, nb };
  };
  Act.createLink = (a, b, cable, speed, count, zone) => {
    const s = G.S;
    const pv = Act.linkPreview(a, b, cable, speed, count, zone);
    if (!pv.ok) return err(pv.errs[0]);
    if (!Act.spend(pv.cost, `佈線 ${pv.na} ⇄ ${pv.nb}`)) return need(pv.cost);
    const id = Q.nextId('L');
    s.links[id] = { id, a, b, cable, speed, count: pv.count, len: pv.len, aPort: pv.aPort, bPort: pv.bPort, zone: pv.zone, status: 'up', readyAt: s.time + pv.buildMin, cost: pv.cost };
    topo();
    changed('links');
    return ok(pv.buildMin ? `垂直主幹施工中，約 ${U.dur(pv.buildMin)} 後完成` : `${pv.na} ⇄ ${pv.nb} 連線完成`, { id });
  };
  Act.updateLink = (id, cable, speed, count, zone) => {
    const s = G.S, l = s.links[id];
    if (!l) return err('找不到線路');
    const pv = Act.linkPreview(l.a, l.b, cable, speed, count, zone, id);
    if (!pv.ok) return err(pv.errs[0]);
    const specSame = l.cable === cable && l.speed === speed && l.count === pv.count;
    const cost = specSame ? 0 : Math.max(0, pv.cost - Math.round((l.cost || 0) * 0.4));
    if (cost && !Act.spend(cost, `變更線路 ${pv.na} ⇄ ${pv.nb}`)) return need(cost);
    Object.assign(l, { cable, speed, count: pv.count, aPort: pv.aPort, bPort: pv.bPort, zone: pv.zone });
    if (!specSame) { l.cost = pv.cost; l.readyAt = s.time + pv.buildMin; }
    topo();
    changed('links');
    return ok(specSame ? '介面區域已更新' : (pv.buildMin ? `線路升級施工中，約 ${U.dur(pv.buildMin)}` : '線路已更新'));
  };
  Act.deleteLink = (id) => {
    const l = G.S.links[id];
    if (!l) return err('找不到線路');
    delete G.S.links[id];
    topo();
    changed('links');
    return ok('線路已拆除');
  };
  Act.repairLink = (id) => {
    const s = G.S, l = s.links[id];
    if (!l || l.status !== 'cut') return err('線路沒有中斷');
    const cost = 30000;
    if (!Act.spend(cost, '光纖熔接搶修')) return need(cost);
    l.status = 'repair'; l.repairAt = s.time + 120;
    changed('links');
    return ok('熔接工程師出動中，約 2 小時後修復');
  };

  /* ---------- ISP ---------- */
  Act.orderIsp = (provider, planId) => {
    const s = G.S, plan = CAT.isp.plans[planId];
    if (!plan || !CAT.isp.providers[provider]) return err('方案錯誤');
    if (!Q.unlocked(plan)) return err(`第 ${plan.unlock} 章解鎖`);
    if (s.isp.length >= 4) return err('最多申請 4 條線路');
    if (!Act.spend(plan.setup, `ISP 專線開通費 ${CAT.isp.providers[provider].name} ${planId}`)) return need(plan.setup);
    const id = Q.nextId('i');
    s.isp.push({ id, provider, plan: planId, bw: plan.bw, status: 'pending', readyAt: s.time + plan.lead, router: null, port: null, orderedAt: s.time, outage: false });
    const routers = Q.devices('router').filter((d) => d.rack);
    if (routers.length === 1) Act.connectIsp(id, routers[0].id, true);
    changed('isp');
    return ok(`已向 ${CAT.isp.providers[provider].name} 申請 ${planId} 專線，預計 ${U.dur(plan.lead)} 後開通`);
  };
  Act.connectIsp = (id, routerId, silent) => {
    const s = G.S, c = s.isp.find((x) => x.id === id);
    const d = s.devices[routerId];
    if (!c || !d) return err('找不到線路或路由器');
    if (CAT.devices[d.model].cat !== 'router') return err('ISP 線路只能接到路由器');
    if (!d.rack) return err(`${d.name} 尚未安裝到機櫃`);
    const P = Q.ports(routerId);
    if (c.router === routerId) return ok('已連接');
    let cls = null;
    if (c.bw <= 1000 && P.rj45.total - P.rj45.used > 0) cls = 'rj45';
    else if (P.sfp.max >= Math.min(c.bw <= 1000 ? 1000 : 10000, 10000) && P.sfp.total - P.sfp.used > 0) cls = 'sfp';
    if (!cls) return err(`${d.name} 沒有可用的 WAN 埠`);
    c.router = routerId; c.port = cls;
    topo();
    if (!silent) changed('isp');
    return ok(`${CAT.isp.providers[c.provider].name} ${c.plan} 已接到 ${d.name}`);
  };
  Act.disconnectIsp = (id) => {
    const c = G.S.isp.find((x) => x.id === id);
    if (!c) return err('找不到線路');
    c.router = null; c.port = null;
    topo();
    changed('isp');
    return ok('已從路由器拔除');
  };
  Act.cancelIsp = (id) => {
    const s = G.S;
    const i = s.isp.findIndex((x) => x.id === id);
    if (i < 0) return err('找不到線路');
    const c = s.isp[i];
    s.isp.splice(i, 1);
    topo();
    changed('isp');
    return ok(`已終止 ${CAT.isp.providers[c.provider].name} ${c.plan} 合約`);
  };

  /* ---------- 樓層 ---------- */
  Act.floorDrops = (fid) => {
    const f = G.BLD.byId[fid], ft = G.FT[f.type];
    return Math.ceil(f.staff * ft.wired) + Math.ceil(f.staff / 40) + (ft.pos || 0) + (ft.gates || 0) + (ft.cams || 0) + 40;
  };
  Act.cablingCost = (fid, std) => Act.floorDrops(fid) * CAT.horizontal[std].perDrop;
  Act.startCabling = (fid, std) => {
    const s = G.S, fs = s.floors[fid];
    if (fs.cabling.status !== 'none') return err('這層樓已經施工過了');
    const h = CAT.horizontal[std];
    const cost = Act.cablingCost(fid, std);
    if (!Act.spend(cost, `${fid} 水平布線工程（${h.name}）`)) return need(cost);
    fs.cabling = { std, status: 'building', readyAt: s.time + h.buildMin };
    changed('floor', { fid });
    return ok(`${fid} 布線工程開始，約 ${U.dur(h.buildMin)} 後完工`);
  };
  Act.accessCost = (fid, model, count) => {
    const fs = G.S.floors[fid];
    const cur = fs.idf.count, curModel = fs.idf.model;
    const pNew = CAT.access[model].price, pOld = CAT.access[curModel].price;
    if (model !== curModel) return count * pNew - Math.round(cur * pOld * 0.4);
    if (count >= cur) return (count - cur) * pNew;
    return -Math.round((cur - count) * pNew * 0.4);
  };
  Act.setAccess = (fid, model, count) => {
    const s = G.S, fs = s.floors[fid];
    const am = CAT.access[model];
    if (!am) return err('未知型號');
    if (!Q.unlocked(am)) return err(`第 ${am.unlock} 章解鎖`);
    count = Math.max(0, Math.min(16, count | 0));
    const usedUp = Q.ports('F:' + fid).sfp.used;
    if (count * am.uplinks < usedUp) return err(`上行埠不足：目前有 ${usedUp} 條上行，請先移除部分上行鏈路`);
    const upMax = Math.max(0, ...Q.linksOf('F:' + fid).map((l) => l.speed));
    if (upMax > am.uplinkMax) return err(`${am.name} 上行最高 ${U.speed(am.uplinkMax)}，目前有 ${U.speed(upMax)} 的上行鏈路`);
    const cost = Act.accessCost(fid, model, count);
    if (cost > 0 && !Act.spend(cost, `${fid} 接入交換器 ${am.name}`)) return need(cost);
    if (cost < 0) Act.refund(-cost, `${fid} 回收交換器`);
    const wasZero = fs.idf.count === 0;
    fs.idf.model = model; fs.idf.count = count;
    if (wasZero && count > 0) fs.idf.bootUntil = s.time + 4;
    G.Wifi.invalidate(fid);
    topo();
    changed('floor', { fid });
    return ok(`${fid} IDF：${am.name} × ${count}`);
  };
  Act.setIdfUps = (fid, on) => {
    const fs = G.S.floors[fid];
    if (!!fs.idf.ups === !!on) return ok('');
    if (on) { if (!Act.spend(45000, `${fid} IDF 小型 UPS`)) return need(45000); }
    fs.idf.ups = !!on;
    changed('floor', { fid });
    return ok(on ? `${fid} IDF 已加裝 UPS（停電可撐 30 分鐘）` : `${fid} IDF 已移除 UPS`);
  };
  const wlcUp = () => Q.devices('wlc').some((d) => G.Net.devUp(d));
  Act.placeAp = (fid, x, y, model) => {
    const s = G.S, fs = s.floors[fid], f = G.BLD.byId[fid];
    const m = CAT.aps[model];
    if (!m) return err('未知型號');
    if (!Q.unlocked(m)) return err(`第 ${m.unlock} 章解鎖`);
    const L = G.Layout.get(f.type);
    if (!G.Layout.canPlaceAp(L, x, y)) return err('這裡不能安裝 AP（牆上、核心筒或 IDF）');
    if (fs.aps.some((a) => a.x === x && a.y === y)) return err('這個位置已經有 AP');
    if (fs.aps.length >= 60) return err('單一樓層最多 60 台 AP');
    const cost = m.price + CAT.apInstallFee;
    if (!Act.spend(cost, `${fid} 安裝 ${m.name}`)) return need(cost);
    const ap = { id: Q.nextId('ap'), x, y, model, ch: '36' };
    fs.aps.push(ap);
    if (wlcUp()) G.Wifi.autoChannels(fid);
    G.Wifi.invalidate(fid);
    changed('floor', { fid, ap: ap.id });
    return ok(`已安裝 ${m.gen} AP`, { id: ap.id });
  };
  Act.moveAp = (fid, apId, x, y) => {
    const fs = G.S.floors[fid], f = G.BLD.byId[fid];
    const ap = fs.aps.find((a) => a.id === apId);
    if (!ap) return err('找不到 AP');
    const L = G.Layout.get(f.type);
    if (!G.Layout.canPlaceAp(L, x, y)) return err('這裡不能安裝 AP');
    if (fs.aps.some((a) => a !== ap && a.x === x && a.y === y)) return err('這個位置已經有 AP');
    ap.x = x; ap.y = y;
    if (wlcUp()) G.Wifi.autoChannels(fid);
    G.Wifi.invalidate(fid);
    changed('floor', { fid, ap: ap.id });
    return ok('AP 已移位');
  };
  Act.removeAp = (fid, apId) => {
    const fs = G.S.floors[fid];
    const i = fs.aps.findIndex((a) => a.id === apId);
    if (i < 0) return err('找不到 AP');
    const m = CAT.aps[fs.aps[i].model];
    fs.aps.splice(i, 1);
    Act.refund(m.price * 0.3, `${fid} 拆除 AP`);
    G.Wifi.invalidate(fid);
    changed('floor', { fid });
    return ok('AP 已拆除');
  };
  Act.setApChannel = (fid, apId, ch) => {
    const fs = G.S.floors[fid];
    const ap = fs.aps.find((a) => a.id === apId);
    if (!ap) return err('找不到 AP');
    if (!CAT.channels[CAT.aps[ap.model].band].includes(ch)) return err('此 AP 不支援該頻道');
    ap.ch = ch;
    G.Wifi.invalidate(fid);
    changed('floor', { fid, ap: ap.id });
    return ok(`頻道已設為 ${ch}`);
  };
  Act.setApModel = (fid, apId, model) => {
    const fs = G.S.floors[fid];
    const ap = fs.aps.find((a) => a.id === apId);
    const m = CAT.aps[model];
    if (!ap || !m) return err('找不到 AP');
    if (!Q.unlocked(m)) return err(`第 ${m.unlock} 章解鎖`);
    if (ap.model === model) return ok('');
    const cost = m.price - Math.round(CAT.aps[ap.model].price * 0.3);
    if (!Act.spend(cost, `${fid} 更換 AP 為 ${m.name}`)) return need(cost);
    ap.model = model;
    if (!CAT.channels[m.band].includes(ap.ch)) ap.ch = '36';
    G.Wifi.invalidate(fid);
    changed('floor', { fid, ap: ap.id });
    return ok(`已更換為 ${m.name}`);
  };
  Act.autoChannels = (fid) => {
    if (!wlcUp()) return err('需要運作中的無線控制器 (WLC) 才能自動規劃頻道；或手動點選 AP 設定頻道');
    G.Wifi.autoChannels(fid);
    changed('floor', { fid });
    return ok(`${fid} 已由 WLC 自動規劃頻道`);
  };
  Act.autoPlanCost = (fid, model) => {
    const fs = G.S.floors[fid];
    const pos = G.Wifi.autoPlan(fid, model);
    const m = CAT.aps[model];
    const refund = U.sum(fs.aps, (a) => CAT.aps[a.model].price * 0.3);
    return { pos, cost: Math.round(pos.length * (m.price + CAT.apInstallFee) + 30000 - refund) };
  };
  Act.autoPlan = (fid, model) => {
    const fs = G.S.floors[fid];
    const m = CAT.aps[model];
    if (!Q.unlocked(m)) return err(`第 ${m.unlock} 章解鎖`);
    const { pos, cost } = Act.autoPlanCost(fid, model);
    if (cost > 0 && !Act.spend(cost, `${fid} 無線網路規劃（顧問費 + ${pos.length} 台 AP）`)) return need(cost);
    if (cost < 0) Act.refund(-cost, `${fid} 回收舊 AP`);
    fs.aps = pos.map((p) => ({ id: Q.nextId('ap'), x: p.x, y: p.y, model, ch: '36' }));
    G.Wifi.autoChannels(fid);
    G.Wifi.invalidate(fid);
    changed('floor', { fid });
    return ok(`${fid} 已依容量規劃 ${pos.length} 台 AP，並完成頻道規劃`);
  };

  /** 複製樓層設計：布線、交換器、AP、上行鏈路、IDF UPS */
  Act.copyPlan = (from, targets) => {
    const s = G.S, src = s.floors[from], srcDef = G.BLD.byId[from];
    const plan = [];
    let total = 0;
    const upl = Q.linksOf('F:' + from);
    for (const fid of targets) {
      if (fid === from) continue;
      const fs = s.floors[fid], def = G.BLD.byId[fid];
      const items = [];
      let cost = 0;
      if (fs.cabling.status === 'none' && src.cabling.std) { const c = Act.cablingCost(fid, src.cabling.std); items.push(`布線 ${U.money(c)}`); cost += c; }
      if (src.idf.count > 0 && (fs.idf.model !== src.idf.model || fs.idf.count < src.idf.count)) {
        const c = Math.max(0, Act.accessCost(fid, src.idf.model, Math.max(src.idf.count, fs.idf.model === src.idf.model ? fs.idf.count : 0)));
        items.push(`交換器 ${U.money(c)}`); cost += c;
      }
      let apPos = null;
      if (src.aps.length) {
        if (def.type === srcDef.type) apPos = src.aps.map((a) => ({ x: a.x, y: a.y, model: a.model, ch: a.ch }));
        else { const model = src.aps[0].model; apPos = G.Wifi.autoPlan(fid, model).map((p) => ({ x: p.x, y: p.y, model, ch: '36' })); }
        const c = U.sum(apPos, (a) => CAT.aps[a.model].price + CAT.apInstallFee) - U.sum(fs.aps, (a) => CAT.aps[a.model].price * 0.3);
        items.push(`${apPos.length} 台 AP ${U.money(c)}`); cost += c;
      }
      const links = [];
      if (!Q.linksOf('F:' + fid).length) {
        for (const l of upl) {
          const other = Q.other(l, 'F:' + from);
          let cable = l.cable;
          const len = G.BLD.riserLength(fid);
          if ((CAT.cables[cable].max[l.speed] || 0) < len) cable = 'os2';
          const op = CAT.optics[CAT.cables[cable].medium][l.speed] || 0;
          const c = l.count * (len * CAT.cables[cable].perM + CAT.cables[cable].termCost + op * 2);
          links.push({ other, cable, speed: l.speed, count: l.count, zone: l.zone });
          items.push(`上行 ${U.speed(l.speed)}×${l.count}→${Q.nodeName(other)}${cable !== l.cable ? '（改用 OS2）' : ''}`);
          cost += c;
        }
      }
      if (src.idf.ups && !fs.idf.ups) { items.push('IDF UPS'); cost += 45000; }
      plan.push({ fid, items, cost: Math.round(cost), apPos, links });
      total += Math.round(cost);
    }
    return { plan, total };
  };
  Act.copyFloor = (from, targets) => {
    const s = G.S, src = s.floors[from];
    const { plan, total } = Act.copyPlan(from, targets);
    if (total > s.money) return need(total);
    const done = [];
    for (const p of plan) {
      const fs = s.floors[p.fid];
      if (fs.cabling.status === 'none' && src.cabling.std) Act.startCabling(p.fid, src.cabling.std);
      if (src.idf.count > 0) Act.setAccess(p.fid, src.idf.model, Math.max(src.idf.count, fs.idf.model === src.idf.model ? fs.idf.count : 0));
      if (p.apPos) {
        const refund = U.sum(fs.aps, (a) => CAT.aps[a.model].price * 0.3);
        const cost = U.sum(p.apPos, (a) => CAT.aps[a.model].price + CAT.apInstallFee);
        if (Act.spend(cost, `${p.fid} 安裝 ${p.apPos.length} 台 AP`)) {
          Act.refund(refund, `${p.fid} 回收舊 AP`);
          fs.aps = p.apPos.map((a) => ({ id: Q.nextId('ap'), x: a.x, y: a.y, model: a.model, ch: a.ch }));
          if (G.BLD.byId[p.fid].type !== G.BLD.byId[from].type || wlcUp()) G.Wifi.autoChannels(p.fid);
          G.Wifi.invalidate(p.fid);
        }
      }
      for (const l of p.links) {
        const r = Act.createLink('F:' + p.fid, l.other, l.cable, l.speed, l.count, l.zone);
        if (!r.ok) Act.log(`${p.fid} 上行鏈路建立失敗：${r.msg}`, 'warn');
      }
      if (src.idf.ups && !fs.idf.ups) Act.setIdfUps(p.fid, true);
      done.push(p.fid);
    }
    changed('floor', {});
    return ok(`已套用 ${from} 的設計到 ${done.join('、')}`);
  };

  /* ---------- 防火牆 ---------- */
  Act.addRule = (r) => {
    const s = G.S;
    const rule = { id: Q.nextId('r'), src: r.src, dst: r.dst, svc: r.svc, action: r.action || 'allow', log: r.log !== false, on: true, note: r.note || '' };
    if (r.top) s.fw.rules.unshift(rule); else s.fw.rules.push(rule);
    changed('fw');
    return ok(`已新增規則：${rule.src} → ${rule.dst} ${rule.svc} ${rule.action === 'allow' ? '允許' : '拒絕'}`, { id: rule.id });
  };
  Act.updateRule = (id, patch) => {
    const r = G.S.fw.rules.find((x) => x.id === id);
    if (!r) return err('找不到規則');
    Object.assign(r, patch);
    changed('fw');
    return ok('規則已更新');
  };
  Act.deleteRule = (id) => {
    const s = G.S;
    const i = s.fw.rules.findIndex((x) => x.id === id);
    if (i < 0) return err('找不到規則');
    s.fw.rules.splice(i, 1);
    changed('fw');
    return ok('規則已刪除');
  };
  Act.moveRule = (id, dir) => {
    const rules = G.S.fw.rules;
    const i = rules.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rules.length) return err('');
    [rules[i], rules[j]] = [rules[j], rules[i]];
    changed('fw');
    return ok('');
  };
  Act.setSubnet = (seg, prefix) => {
    G.S.subnets[seg] = prefix;
    changed('fw');
    return ok(`網段已調整為 /${prefix}（可用 ${U.num(Q.hosts(prefix))} 個位址）`);
  };
  Act.setGuestWifi = (on) => {
    G.S.fw.guestWifi = !!on;
    changed('fw');
    return ok(on ? '訪客 Wi-Fi（Guest SSID / VLAN）已啟用' : '訪客 Wi-Fi 已關閉');
  };
  Act.setSegmentation = (on) => {
    G.S.fw.segmentation = !!on;
    changed('fw');
    return ok(on ? '內部分段已啟用：LAN → SERVERS 流量現在要經過防火牆檢查' : '內部分段已關閉');
  };

  /* ---------- 服務訂閱 ---------- */
  Act.subscribe = (id) => {
    const s = G.S, svc = CAT.services[id];
    if (!svc) return err('未知服務');
    if (!Q.unlocked(svc)) return err(`第 ${svc.unlock} 章解鎖`);
    if (s.services[id]) return ok('');
    if (svc.needsRole && !Q.roleServers(svc.needsRole).some((d) => d.rack)) return err(`需要先部署${CAT.roles[svc.needsRole].name}`);
    if (svc.needsTape && !Object.values(s.devices).some((d) => d.rack && CAT.devices[d.model].tape)) return err('需要先安裝磁帶櫃（TL-48）：保全公司要收走的是磁帶');
    const first = Math.round(Q.monthlyServiceCost(id));
    if (first > 0 && !Act.spend(first, `訂閱 ${svc.name}（首月）`)) return need(first);
    s.services[id] = { since: s.time };
    changed('services');
    return ok(`${svc.name} 已啟用`);
  };
  Act.unsubscribe = (id) => {
    const s = G.S;
    if (!s.services[id]) return ok('');
    delete s.services[id];
    changed('services');
    return ok(`${CAT.services[id].name} 已停用`);
  };
  Act.buyTraining = () => {
    const s = G.S, t = CAT.training;
    if (!Q.unlocked(t)) return err(`第 ${t.unlock} 章解鎖`);
    if (!Act.spend(t.price, t.name)) return need(t.price);
    s.trainingUntil = s.time + t.days * 1440;
    changed('services');
    return ok('資安意識訓練完成，30 天內員工點擊釣魚連結的機率大幅降低');
  };
})(window.G = window.G || {});
