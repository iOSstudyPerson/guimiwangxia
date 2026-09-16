/* ===================== 团队编组：三团 × 五小队 × 六人 ===================== */
const SQUAD_TEAM_LABELS = ['第一小队', '第二小队', '第三小队', '第四小队', '第五小队'];
const PATHWAY_TONE = {
  '战士': 'tone-warrior',
  '窥秘人': 'tone-seeker',
  '占卜家': 'tone-diviner',
  '学徒': 'tone-apprentice',
  '歌颂者': 'tone-bard',
  '奶妈': 'tone-healer'
};

let squadBoard = null;
let squadActiveId = '一团';
let squadDragPayload = null;

async function loadSquadBoard(){
  squadBoard = await api('/api/squads' + (typeof clubQuery === 'function' ? clubQuery() : ''));
  if (typeof members !== 'undefined' && loggedIn) {
    // 管理员侧同步本地 members 的编组字段
    const map = {};
    (squadBoard.members || []).forEach(m => { map[m.id] = m; });
    members.forEach(m => {
      const s = map[m.id];
      if (!s) return;
      m.squad = s.squad;
      m.team = s.team;
      m.slot = s.slot;
      m.isLeader = s.isLeader;
    });
  }
  return squadBoard;
}

function squadMeta(id){
  return (squadBoard && squadBoard.regiments || []).find(r => r.id === id) || { id, title: id, leaderId: null };
}

function squadMemberById(id){
  return (squadBoard && squadBoard.members || []).find(m => m.id === id);
}

function squadSeatedCount(regimentId){
  return (squadBoard && squadBoard.members || []).filter(m =>
    m.squad === regimentId && m.team && m.slot
  ).length;
}

function squadTotalSeated(){
  return (squadBoard && squadBoard.seated) || (squadBoard && squadBoard.members || []).filter(m =>
    SQUAD_ORDER.includes(m.squad) && m.team && m.slot
  ).length;
}

function squadPoolFor(regimentId){
  const list = squadBoard && squadBoard.members || [];
  const inRegNoSlot = list.filter(m => m.squad === regimentId && !(m.team && m.slot));
  const free = list.filter(m => !m.squad || m.squad === '未编组');
  return { inRegNoSlot, free };
}

function occupantAt(regimentId, team, slot){
  return (squadBoard && squadBoard.members || []).find(m =>
    m.squad === regimentId && Number(m.team) === Number(team) && Number(m.slot) === Number(slot)
  ) || null;
}

function renderSquadsPage(){
  const root = document.getElementById('squadsRoot');
  if (!root) return;
  const canWrite = typeof loggedIn !== 'undefined' && loggedIn;
  root.innerHTML = '<div class="arch-empty">正在加载编组…</div>';
  loadSquadBoard()
    .then(() => {
      paintSquadsPage(root, canWrite);
    })
    .catch(err => {
      root.innerHTML = '<div class="arch-empty">' + esc(err.message || '加载失败') + '</div>';
    });
}

function paintSquadsPage(root, canWrite){
  const cap = (squadBoard && squadBoard.totalCap) || 90;
  const seated = squadTotalSeated();
  const meta = squadMeta(squadActiveId);
  const pool = squadPoolFor(squadActiveId);

  root.innerHTML =
    '<div class="squad-board">' +
      '<div class="squad-board-head">' +
        '<div>' +
          '<h2>战团阵容编组</h2>' +
          '<div class="sub">每团 5 小队 × 每队 6 人（含团长）。团长以金色徽记标识。' +
            (canWrite ? '可点击号位选择成员，或拖拽调位。' : '当前为只读，登录管理员后可调整。') +
          '</div>' +
        '</div>' +
        '<div class="arch-mini">' +
          '<div class="mini-chip">已编入 <b>' + seated + '</b><span class="u"> / ' + cap + '</span></div>' +
          '<div class="mini-chip">' + esc(meta.title || squadActiveId) + ' <b>' + squadSeatedCount(squadActiveId) + '</b><span class="u"> / 30</span></div>' +
        '</div>' +
      '</div>' +

      '<div class="squad-tabs">' +
        SQUAD_ORDER.map(id => {
          const m = squadMeta(id);
          const on = id === squadActiveId ? ' on' : '';
          return '<button type="button" class="squad-tab' + on + '" data-reg="' + esc(id) + '">' +
            esc(m.title || id) +
            '<span class="squad-tab-n">' + squadSeatedCount(id) + '/30</span>' +
          '</button>';
        }).join('') +
        (canWrite
          ? '<button type="button" class="squad-tab ghost" id="squadMetaBtn">设置战团</button>'
          : '') +
      '</div>' +

      '<div class="squad-mode-hint">' +
        (canWrite
          ? '点击空位添加成员；已入队可点「×」移出，或点卡片更换。也支持拖拽调位。'
          : '访客可查看阵容；调整需管理员登录。') +
      '</div>' +

      '<div class="squad-grid" id="squadGrid">' + renderSquadColumns(squadActiveId, canWrite) + '</div>' +

      '<div class="squad-pool">' +
        '<div class="squad-pool-col">' +
          '<div class="squad-pool-h">本团待分队 <span>' + pool.inRegNoSlot.length + '</span></div>' +
          '<div class="squad-pool-list" data-pool="bench" data-reg="' + esc(squadActiveId) + '">' +
            (pool.inRegNoSlot.length
              ? pool.inRegNoSlot.map(m => renderSquadChip(m, canWrite, true)).join('')
              : '<div class="squad-pool-empty">本团成员都已入队，或从下方未入团拖入</div>') +
          '</div>' +
        '</div>' +
        '<div class="squad-pool-col">' +
          '<div class="squad-pool-h">未入团 <span>' + pool.free.length + '</span></div>' +
          '<div class="squad-pool-list" data-pool="free">' +
            (pool.free.length
              ? pool.free.map(m => renderSquadChip(m, canWrite, true)).join('')
              : '<div class="squad-pool-empty">没有未编组的在帮成员</div>') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  bindSquadInteractions(root, canWrite);
}

function renderSquadColumns(regimentId, canWrite){
  const leaderId = squadMeta(regimentId).leaderId;
  const cols = [];
  for (let t = 1; t <= SQUAD_TEAM_COUNT; t++) {
    let filled = 0;
    const slots = [];
    for (let s = 1; s <= SQUAD_SLOT_COUNT; s++) {
      const m = occupantAt(regimentId, t, s);
      if (m) filled++;
      slots.push(renderSquadSlot(regimentId, t, s, m, leaderId, canWrite));
    }
    cols.push(
      '<div class="squad-col" data-team="' + t + '">' +
        '<div class="squad-col-h">' +
          '<span class="squad-col-name">' + SQUAD_TEAM_LABELS[t - 1] + '</span>' +
          '<span class="squad-col-n">' + filled + '/' + SQUAD_SLOT_COUNT + '</span>' +
        '</div>' +
        '<div class="squad-slots">' + slots.join('') + '</div>' +
      '</div>'
    );
  }
  return cols.join('');
}

function pathwayTone(pathway){
  return PATHWAY_TONE[pathway] || 'tone-default';
}

function nameInitial(name){
  const n = String(name || '').trim();
  return n ? n.slice(0, 1) : '?';
}

function renderSquadSlot(regimentId, team, slot, member, leaderId, canWrite){
  if (!member) {
    return (
      '<div class="squad-slot empty' + (canWrite ? ' can-pick' : '') + '" data-reg="' + esc(regimentId) + '" data-team="' + team + '" data-slot="' + slot + '">' +
        '<span class="squad-slot-no">' + slot + '号</span>' +
        '<span class="squad-slot-ph">' + (canWrite ? '点击添加' : '空位') + '</span>' +
      '</div>'
    );
  }
  const isLeader = member.isLeader || member.id === leaderId;
  return (
    '<div class="squad-slot filled ' + pathwayTone(member.pathway) + (isLeader ? ' is-leader' : '') + (canWrite ? ' can-pick' : '') + '" ' +
      'data-reg="' + esc(regimentId) + '" data-team="' + team + '" data-slot="' + slot + '" data-mid="' + esc(member.id) + '" ' +
      (canWrite ? 'draggable="true"' : '') + '>' +
      (canWrite ? '<span class="squad-grip" aria-hidden="true"></span>' : '') +
      '<span class="squad-slot-no">' + slot + '号</span>' +
      '<span class="squad-avatar' + (isLeader ? ' is-leader-av' : '') + '">' + esc(nameInitial(member.name)) + '</span>' +
      '<div class="squad-who">' +
        '<div class="squad-name">' + esc(member.name || '（未命名）') + '</div>' +
        '<div class="squad-path">' + esc(member.pathway || '') +
          (isLeader ? '<span class="squad-leader-tag">团长</span>' : '') +
        '</div>' +
      '</div>' +
      (canWrite
        ? '<button type="button" class="squad-slot-rm" data-rm-slot title="移出号位">×</button>'
        : '') +
    '</div>'
  );
}

function renderSquadChip(member, canWrite, compact){
  const isLeader = !!member.isLeader;
  return (
    '<div class="squad-chip ' + pathwayTone(member.pathway) + (isLeader ? ' is-leader' : '') + '" ' +
      'data-mid="' + esc(member.id) + '" ' +
      (canWrite ? 'draggable="true"' : '') + '>' +
      '<span class="squad-avatar sm' + (isLeader ? ' is-leader-av' : '') + '">' + esc(nameInitial(member.name)) + '</span>' +
      '<div class="squad-who">' +
        '<div class="squad-name">' + esc(member.name || '（未命名）') + '</div>' +
        '<div class="squad-path">' + esc(member.pathway || '') +
          (isLeader ? '<span class="squad-leader-tag">团长</span>' : '') +
        '</div>' +
      '</div>' +
      (canWrite
        ? '<button type="button" class="squad-slot-rm chip-rm" data-rm-chip title="移出战团（回未入团）">×</button>'
        : '') +
    '</div>'
  );
}

function bindSquadInteractions(root, canWrite){
  root.querySelectorAll('.squad-tab[data-reg]').forEach(btn => {
    btn.addEventListener('click', () => {
      squadActiveId = btn.dataset.reg;
      closeSquadPicker();
      paintSquadsPage(root, canWrite);
    });
  });
  document.getElementById('squadMetaBtn')?.addEventListener('click', () => openSquadMetaModal());

  if (!canWrite) {
    root.querySelectorAll('.squad-slot.filled, .squad-chip').forEach(el => {
      el.addEventListener('click', () => {
        const m = squadMemberById(el.dataset.mid);
        if (m) toast(m.name + ' · ' + (m.pathway || '') + (m.isLeader ? ' · 团长' : ''));
      });
    });
    return;
  }

  root.querySelectorAll('.squad-slot-rm').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      const slotEl = btn.closest('.squad-slot');
      if (!slotEl || !slotEl.dataset.mid) return;
      await removeFromSlot(slotEl.dataset.mid, slotEl.dataset.reg, 'bench');
    });
  });

  root.querySelectorAll('[data-rm-chip]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      const chip = btn.closest('.squad-chip');
      if (!chip || !chip.dataset.mid) return;
      await removeFromSlot(chip.dataset.mid, squadActiveId, 'free');
    });
  });

  root.querySelectorAll('.squad-slot.can-pick').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.squad-slot-rm') || e.target.closest('.squad-grip')) return;
      if (squadDragPayload) return;
      openSquadPicker(el, {
        reg: el.dataset.reg,
        team: Number(el.dataset.team),
        slot: Number(el.dataset.slot),
        currentId: el.dataset.mid || null
      });
    });
  });

  root.querySelectorAll('[draggable="true"]').forEach(el => {
    el.addEventListener('dragstart', e => {
      closeSquadPicker();
      const mid = el.dataset.mid;
      if (!mid) return;
      const slotEl = el.classList.contains('squad-slot') ? el : null;
      squadDragPayload = {
        memberId: mid,
        fromReg: slotEl ? slotEl.dataset.reg : (squadMemberById(mid) || {}).squad,
        fromTeam: slotEl ? Number(slotEl.dataset.team) : null,
        fromSlot: slotEl ? Number(slotEl.dataset.slot) : null
      };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', mid); } catch (err) { /* ignore */ }
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      root.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
      squadDragPayload = null;
    });
  });

  const dropTargets = [
    ...root.querySelectorAll('.squad-slot'),
    ...root.querySelectorAll('.squad-pool-list')
  ];
  dropTargets.forEach(zone => {
    zone.addEventListener('dragover', e => {
      if (!squadDragPayload) return;
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (!squadDragPayload) return;
      await handleSquadDrop(zone, squadDragPayload);
    });
  });
}

async function removeFromSlot(memberId, regimentId, mode){
  // mode: bench = 本团待分队；free = 未入团
  const moves = [{
    memberId,
    squad: mode === 'free' ? '未编组' : (regimentId || squadActiveId),
    team: null,
    slot: null
  }];
  try {
    const res = await api('/api/squads/assign', {
      method: 'PUT',
      body: JSON.stringify(typeof withClubId === 'function' ? withClubId({ moves }) : { moves })
    });
    applySquadBoardResult(res);
    closeSquadPicker();
    paintSquadsPage(document.getElementById('squadsRoot'), true);
    if (typeof refreshOverview === 'function') refreshOverview();
    toast(mode === 'free' ? '已移出战团' : '已移出号位');
  } catch (err) {
    toast(err.message || '移出失败');
  }
}

async function assignMemberToSlot(memberId, reg, team, slot, currentId){
  const moves = [{ memberId, squad: reg, team, slot }];
  if (currentId && currentId !== memberId) {
    const cur = squadMemberById(currentId);
    moves.push({
      memberId: currentId,
      squad: (cur && cur.squad) || reg,
      team: null,
      slot: null
    });
  }
  // 若选中的人已在其他号位，其原位自然清空（服务端按人更新）
  try {
    const res = await api('/api/squads/assign', {
      method: 'PUT',
      body: JSON.stringify(typeof withClubId === 'function' ? withClubId({ moves }) : { moves })
    });
    applySquadBoardResult(res);
    closeSquadPicker();
    paintSquadsPage(document.getElementById('squadsRoot'), true);
    if (typeof refreshOverview === 'function') refreshOverview();
    toast('已写入号位');
  } catch (err) {
    toast(err.message || '分配失败');
  }
}

let squadPickCtx = null;
let squadPickPath = '';
let squadPickQ = '';

function ensureSquadPicker(){
  let pop = document.getElementById('squadPickPop');
  if (pop && pop.dataset.ver !== '3') {
    pop.remove();
    pop = null;
  }
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = 'squadPickPop';
  pop.className = 'squad-pick-pop';
  pop.dataset.ver = '3';
  pop.hidden = true;
  pop.innerHTML =
    '<div class="squad-pick-head">' +
      '<div class="squad-pick-title" id="squadPickTitle">选择成员</div>' +
      '<button type="button" class="squad-pick-x" id="squadPickClose" aria-label="关闭">×</button>' +
    '</div>' +
    '<div class="squad-pick-actions" id="squadPickActions" hidden></div>' +
    '<div class="squad-pick-search">' +
      '<input id="squadPickInput" type="search" placeholder="搜索姓名…" autocomplete="off">' +
    '</div>' +
    '<div class="squad-pick-paths" id="squadPickPaths"></div>' +
    '<div class="squad-pick-list" id="squadPickList"></div>';
  document.body.appendChild(pop);

  pop.querySelector('#squadPickClose').addEventListener('click', closeSquadPicker);
  pop.querySelector('#squadPickInput').addEventListener('input', e => {
    squadPickQ = e.target.value || '';
    renderSquadPickerList();
  });
  document.addEventListener('mousedown', e => {
    if (pop.hidden) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.squad-slot.can-pick')) return;
    closeSquadPicker();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSquadPicker();
  });
  return pop;
}

function closeSquadPicker(){
  const pop = document.getElementById('squadPickPop');
  if (pop) pop.hidden = true;
  squadPickCtx = null;
  document.querySelectorAll('.squad-slot.picking').forEach(el => el.classList.remove('picking'));
}

function openSquadPicker(anchorEl, ctx){
  if (!requireWrite('调整编组')) return;
  const pop = ensureSquadPicker();
  squadPickCtx = ctx;
  squadPickQ = '';
  squadPickPath = '';
  document.querySelectorAll('.squad-slot.picking').forEach(el => el.classList.remove('picking'));
  anchorEl.classList.add('picking');

  const title = ctx.currentId
    ? ('更换 · ' + SQUAD_TEAM_LABELS[(ctx.team || 1) - 1] + ' ' + ctx.slot + '号')
    : ('加入 · ' + SQUAD_TEAM_LABELS[(ctx.team || 1) - 1] + ' ' + ctx.slot + '号');
  pop.querySelector('#squadPickTitle').textContent = title;
  pop.querySelector('#squadPickInput').value = '';

  const actions = pop.querySelector('#squadPickActions');
  if (ctx.currentId) {
    actions.removeAttribute('hidden');
    actions.innerHTML =
      '<button type="button" class="squad-pick-act primary" data-act="leader">★ 设为团长</button>' +
      '<div class="squad-pick-act-row">' +
        '<button type="button" class="squad-pick-act" data-act="bench">移出号位</button>' +
        '<button type="button" class="squad-pick-act danger" data-act="free">移出战团</button>' +
      '</div>';
    actions.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.dataset.act === 'leader') {
          setSquadLeader(ctx.reg, ctx.currentId);
          return;
        }
        removeFromSlot(ctx.currentId, ctx.reg, btn.dataset.act);
      });
    });
  } else {
    actions.setAttribute('hidden', '');
    actions.innerHTML = '';
  }

  const paths = pop.querySelector('#squadPickPaths');
  const pathOpts = [''].concat(typeof PATHWAYS !== 'undefined' ? PATHWAYS : []);
  paths.innerHTML = pathOpts.map(p =>
    '<button type="button" class="squad-pick-chip' + (squadPickPath === p ? ' on' : '') + '" data-path="' + esc(p) + '">' +
      (p || '全部') +
    '</button>'
  ).join('');
  paths.querySelectorAll('[data-path]').forEach(btn => {
    btn.addEventListener('click', () => {
      squadPickPath = btn.dataset.path || '';
      paths.querySelectorAll('.squad-pick-chip').forEach(c => c.classList.toggle('on', (c.dataset.path || '') === squadPickPath));
      renderSquadPickerList();
    });
  });

  renderSquadPickerList();
  pop.hidden = false;

  // 定位在锚点附近
  const r = anchorEl.getBoundingClientRect();
  const pw = Math.min(300, window.innerWidth - 24);
  let left = r.left;
  let top = r.bottom + 8;
  if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
  if (left < 12) left = 12;
  pop.style.width = pw + 'px';
  pop.style.left = left + 'px';
  pop.style.top = '0px';
  // 先显示再量高度，必要时上翻
  requestAnimationFrame(() => {
    const h = pop.offsetHeight;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
    pop.style.top = top + 'px';
  });
  setTimeout(() => pop.querySelector('#squadPickInput')?.focus(), 40);
}

function squadPickCandidates(){
  const list = (squadBoard && squadBoard.members) || [];
  const reg = squadPickCtx && squadPickCtx.reg;
  const currentId = squadPickCtx && squadPickCtx.currentId;
  const q = (squadPickQ || '').trim().toLowerCase();
  const path = squadPickPath || '';

  const match = m => {
    if (path && m.pathway !== path) return false;
    if (q && !(m.name || '').toLowerCase().includes(q)) return false;
    return true;
  };

  const bench = [];
  const free = [];
  const other = [];
  list.forEach(m => {
    if (!match(m)) return;
    if (currentId && m.id === currentId) return;
    const seated = m.team && m.slot;
    if (!seated && m.squad === reg) bench.push(m);
    else if (!seated && (!m.squad || m.squad === '未编组')) free.push(m);
    else if (seated) other.push(m);
  });

  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'zh');
  bench.sort(byName);
  free.sort(byName);
  other.sort(byName);
  return { bench, free, other };
}

function renderSquadPickerList(){
  const box = document.getElementById('squadPickList');
  if (!box || !squadPickCtx) return;
  const { bench, free, other } = squadPickCandidates();
  const sections = [];
  const pushSec = (label, arr, hint) => {
    if (!arr.length) return;
    sections.push('<div class="squad-pick-sec">' + esc(label) + '</div>');
    arr.forEach(m => {
      const where = (m.team && m.slot)
        ? (esc(m.squad) + ' · ' + m.team + '队' + m.slot + '号')
        : (hint || '');
      sections.push(
        '<button type="button" class="squad-pick-row ' + pathwayTone(m.pathway) + '" data-pick="' + esc(m.id) + '">' +
          '<span class="squad-avatar sm">' + esc(nameInitial(m.name)) + '</span>' +
          '<span class="squad-pick-meta">' +
            '<span class="n">' + esc(m.name || '') + '</span>' +
            '<span class="p">' + esc(m.pathway || '') + (where ? ' · ' + where : '') + '</span>' +
          '</span>' +
        '</button>'
      );
    });
  };
  pushSec('本团待分队', bench);
  pushSec('未入团', free);
  pushSec('其他号位（点选会挪过来）', other);

  if (!sections.length) {
    box.innerHTML = '<div class="squad-pick-empty">没有符合的成员</div>';
    return;
  }
  box.innerHTML = sections.join('');
  box.querySelectorAll('[data-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      assignMemberToSlot(
        btn.dataset.pick,
        squadPickCtx.reg,
        squadPickCtx.team,
        squadPickCtx.slot,
        squadPickCtx.currentId
      );
    });
  });
}

async function handleSquadDrop(zone, drag){
  const mid = drag.memberId;
  const moves = [];

  if (zone.classList.contains('squad-slot')) {
    const toReg = zone.dataset.reg;
    const toTeam = Number(zone.dataset.team);
    const toSlot = Number(zone.dataset.slot);
    const occ = occupantAt(toReg, toTeam, toSlot);
    if (occ && occ.id === mid) return;

    moves.push({ memberId: mid, squad: toReg, team: toTeam, slot: toSlot });
    if (occ) {
      // 互换：对方去到拖拽来源位；若来自池子则对方进本团待分队
      if (drag.fromTeam && drag.fromSlot && drag.fromReg) {
        moves.push({
          memberId: occ.id,
          squad: drag.fromReg,
          team: drag.fromTeam,
          slot: drag.fromSlot
        });
      } else {
        moves.push({
          memberId: occ.id,
          squad: toReg,
          team: null,
          slot: null
        });
      }
    }
  } else if (zone.dataset.pool === 'bench') {
    const reg = zone.dataset.reg || squadActiveId;
    moves.push({ memberId: mid, squad: reg, team: null, slot: null });
  } else if (zone.dataset.pool === 'free') {
    moves.push({ memberId: mid, squad: '未编组', team: null, slot: null });
  } else {
    return;
  }

  try {
    const res = await api('/api/squads/assign', {
      method: 'PUT',
      body: JSON.stringify(typeof withClubId === 'function' ? withClubId({ moves }) : { moves })
    });
    applySquadBoardResult(res);
    paintSquadsPage(document.getElementById('squadsRoot'), true);
    if (typeof refreshOverview === 'function') refreshOverview();
    toast('编组已更新');
  } catch (err) {
    toast(err.message || '调整失败');
  }
}

function applySquadBoardResult(res){
  if (!res) return;
  if (res.regiments || res.members) {
    squadBoard = squadBoard || {};
    if (res.regiments) squadBoard.regiments = res.regiments;
    if (res.members) {
      // assign 返回完整 members；board 只需在帮摘要字段
      const active = (res.members || []).filter(m => m.status === '在帮');
      squadBoard.members = active.map(m => ({
        id: m.id,
        name: m.name,
        squad: m.squad,
        pathway: m.pathway,
        score: m.score,
        team: m.team,
        slot: m.slot,
        isLeader: m.isLeader
      }));
      squadBoard.seated = active.filter(m =>
        SQUAD_ORDER.includes(m.squad) && m.team && m.slot
      ).length;
      if (typeof members !== 'undefined') {
        const map = {};
        res.members.forEach(m => { map[m.id] = m; });
        members.forEach(m => {
          const s = map[m.id];
          if (!s) return;
          m.squad = s.squad;
          m.team = s.team;
          m.slot = s.slot;
          m.isLeader = s.isLeader;
        });
      }
    }
  }
}

function openSquadMetaModal(){
  if (!requireWrite('设置战团')) return;
  const meta = squadMeta(squadActiveId);
  const seated = (squadBoard.members || []).filter(m =>
    m.squad === squadActiveId && m.team && m.slot
  );
  const pool = squadPoolFor(squadActiveId).inRegNoSlot;
  const candidates = seated.concat(pool);

  const mask = document.getElementById('squadMetaMask');
  if (!mask) return;
  document.getElementById('sqMetaTitle').value = meta.title || squadActiveId;
  const wrap = document.getElementById('sqMetaLeader');
  // 兼容：若仍是 select，改造成容器
  if (wrap.tagName === 'SELECT') {
    const box = document.createElement('div');
    box.id = 'sqMetaLeader';
    box.className = 'squad-leader-pick';
    wrap.replaceWith(box);
  }
  const box = document.getElementById('sqMetaLeader');
  box.dataset.leaderId = meta.leaderId || '';
  box.innerHTML =
    '<button type="button" class="squad-leader-opt' + (!meta.leaderId ? ' on' : '') + '" data-leader="">不指定团长</button>' +
    (candidates.length
      ? candidates.map(m =>
          '<button type="button" class="squad-leader-opt' + (m.id === meta.leaderId ? ' on' : '') + '" data-leader="' + esc(m.id) + '">' +
            '<span class="squad-avatar sm' + (m.id === meta.leaderId ? ' is-leader-av' : '') + '">' + esc(nameInitial(m.name)) + '</span>' +
            '<span class="squad-leader-opt-t">' +
              '<span class="n">' + esc(m.name) + '</span>' +
              '<span class="p">' + esc(m.pathway || '') +
                (m.team && m.slot ? (' · ' + m.team + '队' + m.slot + '号') : ' · 待分队') +
              '</span>' +
            '</span>' +
          '</button>'
        ).join('')
      : '<div class="squad-pick-empty">请先把成员编入本团号位或待分队</div>');
  box.querySelectorAll('[data-leader]').forEach(btn => {
    btn.addEventListener('click', () => {
      box.dataset.leaderId = btn.dataset.leader || '';
      box.querySelectorAll('.squad-leader-opt').forEach(b => b.classList.toggle('on', b === btn));
      box.querySelectorAll('.squad-avatar').forEach(av => {
        const row = av.closest('[data-leader]');
        av.classList.toggle('is-leader-av', !!(row && row.classList.contains('on') && row.dataset.leader));
      });
    });
  });
  document.getElementById('sqMetaRegLabel').textContent = '当前：' + squadActiveId;
  mask.classList.add('open');
}

function closeSquadMetaModal(){
  document.getElementById('squadMetaMask')?.classList.remove('open');
}

async function saveSquadMeta(){
  if (!requireWrite('设置战团')) return;
  const title = document.getElementById('sqMetaTitle').value.trim();
  const leaderBox = document.getElementById('sqMetaLeader');
  const leaderId = leaderBox
    ? ((leaderBox.dataset && leaderBox.dataset.leaderId) || (leaderBox.value || null))
    : null;
  try {
    const res = await api('/api/squads/meta', {
      method: 'PUT',
      body: JSON.stringify(typeof withClubId === 'function' ? withClubId({
        id: squadActiveId,
        title,
        leaderId: leaderId || null
      }) : {
        id: squadActiveId,
        title,
        leaderId: leaderId || null
      })
    });
    applySquadBoardResult(res);
    closeSquadMetaModal();
    paintSquadsPage(document.getElementById('squadsRoot'), true);
    toast('战团设置已保存');
  } catch (err) {
    toast(err.message || '保存失败');
  }
}

async function setSquadLeader(regimentId, memberId){
  if (!requireWrite('设置团长')) return;
  const meta = squadMeta(regimentId || squadActiveId);
  try {
    const res = await api('/api/squads/meta', {
      method: 'PUT',
      body: JSON.stringify(typeof withClubId === 'function' ? withClubId({
        id: regimentId || squadActiveId,
        title: meta.title || regimentId || squadActiveId,
        leaderId: memberId
      }) : {
        id: regimentId || squadActiveId,
        title: meta.title || regimentId || squadActiveId,
        leaderId: memberId
      })
    });
    applySquadBoardResult(res);
    closeSquadPicker();
    paintSquadsPage(document.getElementById('squadsRoot'), true);
    const m = squadMemberById(memberId);
    toast((m && m.name ? m.name : '成员') + ' 已设为团长');
  } catch (err) {
    toast(err.message || '设置团长失败');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('squadMetaClose')?.addEventListener('click', closeSquadMetaModal);
  document.getElementById('squadMetaMask')?.addEventListener('click', e => {
    if (e.target && e.target.id === 'squadMetaMask') closeSquadMetaModal();
  });
  document.getElementById('squadMetaSave')?.addEventListener('click', saveSquadMeta);
});
