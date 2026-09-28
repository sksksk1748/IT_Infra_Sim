/* 虛擬化：虛擬化主機（Hypervisor）、VM 的建立 / 遷移（vMotion）/ 刪除、實體轉虛擬（P2V）、
 * 叢集資源與 HA（主機故障時，放在共用儲存上的 VM 自動在別台主機重新開機）。
 * VM 在 G.S.devices 裡是一台「設備」：model = 'VM'、host = 所在主機，rack 跟著主機（方便沿用伺服器的所有邏輯）。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const VM = {};
  G.VM = VM;
  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg) => ({ ok: false, msg });
  const changed = (what) => G.bus.emit('change', { what: what || 'devices' });
  const topo = () => { G.R.topoVer++; };
  const need = (amount) => err(`預算不足：需要 ${U.money(amount)}，目前只有 ${U.money(G.S.money)}`);

  VM.isHost = (d) => !!d && !!CAT.devices[d.model].hv;
  VM.hosts = () => Object.values(G.S.devices).filter((d) => VM.isHost(d) && d.rack);
  VM.vms = () => Object.values(G.S.devices).filter((d) => d.host);
  VM.onHost = (hid) => VM.vms().filter((v) => v.host === hid);
  VM.size = (role) => CAT.vmSize[role] || [4, 16, 0.2];
  VM.used = (hid) => { let c = 0, r = 0; for (const v of VM.onHost(hid)) { c += v.vcpu; r += v.ram; } return { vcpu: c, ram: r }; };
  VM.free = (hid) => { const h = G.S.devices[hid], m = CAT.devices[h.model], u = VM.used(hid); return { vcpu: m.vcpu - u.vcpu, ram: m.ram - u.ram }; };
  VM.hostUp = (h) => !!h && !!h.rack && G.Net.devUp(h);
  VM.san = () => Object.values(G.S.devices).filter((d) => d.rack && CAT.devices[d.model].san);
  VM.sanUp = () => VM.san().some((d) => G.Net.devUp(d) && !d.lost);

  /** 叢集：主機、資源用量、共用儲存、HA 能否承受任一台主機故障（N+1） */
  VM.cluster = () => {
    const s = G.S, hosts = VM.hosts();
    let vcpu = 0, ram = 0, uc = 0, ur = 0, maxRam = 0, upRam = 0;
    for (const h of hosts) {
      const m = CAT.devices[h.model], u = VM.used(h.id);
      vcpu += m.vcpu; ram += m.ram; uc += u.vcpu; ur += u.ram;
      /* N+1 只算還在運作的主機：再壞一台，剩下的記憶體放不放得下所有 VM */
      if (VM.hostUp(h)) { upRam += m.ram; maxRam = Math.max(maxRam, m.ram); }
    }
    const shared = VM.sanUp();
    const vms = VM.vms();
    return {
      hosts: hosts.length, up: hosts.filter(VM.hostUp).length, vcpu, ram, uc, ur, vms: vms.length,
      onSan: vms.filter((v) => v.disk === 'san').length, shared, haOn: !!s.vm.ha,
      ha: !!s.vm.ha && hosts.length >= 2 && shared,
      n1: hosts.filter(VM.hostUp).length >= 2 && upRam - maxRam >= ur,
    };
  };

  /** 挑一台放得下的主機（剩餘記憶體最多的那台）；記憶體不能超用，vCPU 已含 4:1 超用 */
  VM.pickHost = (ram, vcpu, exclude) => {
    const c = VM.hosts().filter((h) => h.id !== exclude && VM.hostUp(h)).map((h) => ({ h, f: VM.free(h.id) }))
      .filter((x) => x.f.ram >= ram && x.f.vcpu >= vcpu).sort((a, b) => b.f.ram - a.f.ram);
    return c.length ? c[0].h : null;
  };
  function vmName(role) {
    const names = new Set(Object.values(G.S.devices).map((d) => d.name));
    const p = CAT.roles[role].short;
    let n = 1;
    while (names.has(`${p}-VM${n}`)) n++;
    return `${p}-VM${n}`;
  }

  /** 建立 VM（角色直接設定好） */
  VM.create = (role, hostId, p2vFrom) => {
    const s = G.S, vm = CAT.devices.VM;
    if (!Q.unlocked(vm)) return err(`第 ${vm.unlock} 章解鎖`);
    if (!vm.roles.includes(role)) return err('這個角色不能做成 VM');
    const [vcpu, ram, disk] = VM.size(role);
    if (!VM.hosts().length) return err('還沒有虛擬化主機：到「採購 → 系統」買 HV-2U 並安裝上架');
    const h = hostId ? s.devices[hostId] : VM.pickHost(ram, vcpu);
    if (!h) return err('所有虛擬化主機的資源都不夠了（記憶體不能超用）：再加一台主機，或刪掉用不到的 VM');
    if (!VM.hostUp(h)) return err(`${h.name} 目前沒有運作`);
    const f = VM.free(h.id);
    if (f.ram < ram || f.vcpu < vcpu) return err(`${h.name} 資源不足（剩 ${f.vcpu} vCPU、${f.ram} GB 記憶體；${CAT.roles[role].short} 需要 ${vcpu} vCPU、${ram} GB）`);
    const cost = p2vFrom ? CAT.vmCfg.p2vFee : CAT.vmCfg.osLicense;
    if (!G.Act.spend(cost, p2vFrom ? `P2V 實體轉虛擬（${s.devices[p2vFrom].name}）` : `建立 VM（作業系統授權，${CAT.roles[role].short}）`)) return need(cost);
    const id = Q.nextId('d');
    const onSan = VM.sanUp();
    s.devices[id] = { id, model: 'VM', name: vmName(role), host: h.id, rack: h.rack, u: null, role, status: 'ok',
      bootUntil: s.time + (p2vFrom ? CAT.vmCfg.p2vMin : CAT.vmCfg.bootMin), boughtAt: s.time,
      vcpu, ram, diskTB: disk, disk: onSan ? 'san' : 'local', p2vFrom: p2vFrom || null };
    topo();
    changed('devices');
    return ok(p2vFrom
      ? `P2V 轉換中（約 ${U.dur(CAT.vmCfg.p2vMin)}）：${s.devices[p2vFrom].name} 的服務會搬到 ${s.devices[id].name}，完成前舊主機照常服務`
      : `${s.devices[id].name} 建立完成，開機中（${onSan ? '硬碟放在共用儲存 SAN' : '硬碟放在主機本機：主機故障時無法 HA'}）`, { id });
  };
  VM.remove = (id) => {
    const s = G.S, v = s.devices[id];
    if (!v || !v.host) return err('找不到 VM');
    delete s.devices[id];
    topo();
    changed('devices');
    return ok(`已刪除 ${v.name}`);
  };
  /** 遷移：兩台主機都在運作、VM 硬碟在共用儲存 → 線上遷移（vMotion，不停機）；否則要關機複製硬碟 */
  VM.migrate = (id, targetId) => {
    const s = G.S, v = s.devices[id], tgt = s.devices[targetId];
    if (!v || !v.host || !tgt) return err('找不到 VM 或主機');
    if (v.host === targetId) return ok('');
    if (!VM.hostUp(tgt)) return err(`${tgt.name} 目前沒有運作`);
    const f = VM.free(targetId);
    if (f.ram < v.ram || f.vcpu < v.vcpu) return err(`${tgt.name} 資源不足`);
    const src = s.devices[v.host];
    const live = v.disk === 'san' && VM.sanUp() && VM.hostUp(src);
    v.host = targetId; v.rack = tgt.rack;
    if (!live) v.bootUntil = Math.max(v.bootUntil || 0, s.time + 15);
    topo();
    changed('devices');
    return ok(live ? `${v.name} 已線上遷移到 ${tgt.name}（vMotion，使用者沒有感覺）` : `${v.name} 關機複製到 ${tgt.name}，約 15 分鐘後恢復（硬碟不在共用儲存，只能冷遷移）`);
  };
  /** 把 VM 的硬碟搬到共用儲存（Storage vMotion） */
  VM.toSan = (id) => {
    const v = G.S.devices[id];
    if (!v || !v.host) return err('找不到 VM');
    if (v.disk === 'san') return ok('');
    if (!VM.sanUp()) return err('沒有運作中的 SAN 共用儲存');
    v.disk = 'san';
    changed('devices');
    return ok(`${v.name} 的硬碟已線上搬到 SAN：之後主機故障時可以 HA`);
  };
  /** 實體轉虛擬：把實體伺服器的角色搬到新的 VM */
  VM.p2v = (physId) => {
    const s = G.S, d = s.devices[physId];
    if (!d || d.host || VM.isHost(d)) return err('只有實體伺服器可以轉成 VM');
    if (!d.role) return err('這台伺服器沒有角色');
    if (!CAT.devices.VM.roles.includes(d.role)) return err(`${CAT.roles[d.role].name} 不適合做成 VM`);
    if (VM.vms().some((v) => v.p2vFrom === physId)) return err('轉換已經在進行中');
    return VM.create(d.role, null, physId);
  };
  VM.setHa = (on) => { G.S.vm.ha = !!on; changed('vm'); return ok(on ? 'HA 已開啟：主機故障時，SAN 上的 VM 會自動在其他主機重開' : 'HA 已關閉'); };
  /** 維護模式：把主機上的 VM 全部遷走（修補、升級前） */
  VM.evacuate = (hostId) => {
    let moved = 0, failed = 0;
    for (const v of VM.onHost(hostId)) {
      const tgt = VM.pickHost(v.ram, v.vcpu, hostId);
      if (tgt && VM.migrate(v.id, tgt.id).ok) moved++; else failed++;
    }
    return { moved, failed };
  };

  /** 每分鐘：VM 跟著主機的機櫃、HA 自動重啟、P2V 完成切換 */
  VM.tick = () => {
    const s = G.S, t = s.time;
    const vms = VM.vms();
    if (!vms.length) return;
    const sanUp = VM.sanUp();
    for (const v of vms) {
      const h = s.devices[v.host];
      v.rack = h && h.rack ? h.rack : null;
      if (v.p2vFrom && t >= v.bootUntil) {
        const p = s.devices[v.p2vFrom];
        if (p && p.role === v.role) { p.role = null; topo(); }
        G.Act.log(`P2V 完成：${p ? p.name : '舊伺服器'} 的服務已搬到 ${v.name}（舊主機可以出售了）`, 'good');
        G.bus.emit('notice', { kind: 'good', text: `P2V 完成：服務已搬到 ${v.name}`, goto: 'sys:vm' });
        v.p2vFrom = null;
        changed('devices');
      }
      if (h && VM.hostUp(h)) { v.haSince = null; continue; }
      /* 主機停了：HA 只救得了硬碟在共用儲存上的 VM */
      if (!(s.vm.ha && v.disk === 'san' && sanUp)) continue;
      if (!v.haSince) v.haSince = t;
      if (t - v.haSince < CAT.vmCfg.haDelay) continue;
      const tgt = VM.pickHost(v.ram, v.vcpu, v.host);
      if (!tgt) { G.Ops && G.Ops.alert('crit', `HA 無法重啟 ${v.name}：其他主機的資源不足`, 'ha:' + v.id); continue; }
      G.Act.log(`HA：${h ? h.name : '主機'} 停機，${v.name} 已在 ${tgt.name} 上自動重新開機`, 'warn');
      v.host = tgt.id; v.rack = tgt.rack; v.bootUntil = t + 4; v.haSince = null;
      v.haMoves = (v.haMoves || 0) + 1;
      topo();
      changed('devices');
    }
  };

  /** 每月授權費（每台主機） */
  VM.monthlyCost = () => VM.hosts().length * CAT.vmCfg.license;
})(window.G = window.G || {});
