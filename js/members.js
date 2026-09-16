/* ===================== 成员档案（共享 API） ===================== */
const PATHWAYS = ['歌颂者','奶妈','占卜家','学徒','战士','窥秘人'];
let members = [];
let migrateQueue = [];

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const pathSelEl = document.getElementById('mPathway');
PATHWAYS.forEach(p => {
  const o = document.createElement('option');
  o.value = p; o.textContent = p;
  pathSelEl.appendChild(o);
});

const fPathwayEl = document.getElementById('fPathway');
if (fPathwayEl) {
  PATHWAYS.forEach(p => {
    const o = document.createElement('option');
    o.value = p; o.textContent = p;
    fPathwayEl.appendChild(o);
  });
}

function openMemberModal(member){
  if (!requireWrite('录入/编辑成员')) return;
  editingId = member ? member.id : null;
  document.getElementById('memberModalTitle').textContent = member ? '编辑成员' : '新增成员';
  document.getElementById('mName').value = member ? member.name : '';
  document.getElementById('mSquad').value = member ? member.squad : '未编组';
  document.getElementById('mPathway').value = member && member.pathway ? member.pathway : '歌颂者';
  document.getElementById('mScore').value = member && member.score ? member.score : '';
  document.getElementById('mJoinedAt').value = member && member.joinedAt ? member.joinedAt : '';
  document.getElementById('mStatus').value = member ? member.status : '在帮';
  document.getElementById('memberMask').classList.add('open');
  setTimeout(() => document.getElementById('mName').focus(), 60);
}
function closeMemberModal(){ document.getElementById('memberMask').classList.remove('open'); }
let editingId = null;

function setPathwayFilter(pathway){
  if (!fPathwayEl) return;
  fPathwayEl.value = pathway || '';
  renderMembers();
}

function updateWriteUI(){
  const canWrite = typeof loggedIn !== 'undefined' && loggedIn;
  document.body.classList.toggle('is-guest', !canWrite);
  document.body.classList.toggle('is-admin', !!canWrite);
  const addBtn = document.getElementById('mAddBtn');
  const ocrBtn = document.getElementById('mOcrBtn');
  const dkpAdd = document.getElementById('dkpAddBtn');
  if (addBtn) addBtn.style.display = canWrite ? '' : 'none';
  if (ocrBtn) ocrBtn.style.display = canWrite ? '' : 'none';
  if (dkpAdd) dkpAdd.style.display = canWrite ? '' : 'none';
  if (typeof paintAlliancePanel === 'function') paintAlliancePanel();
  if (typeof paintClubSwitcher === 'function') paintClubSwitcher();
}

function renderMembers(){
  updateWriteUI();
  const q = (document.getElementById('mSearch').value || '').trim().toLowerCase();
  const fs = document.getElementById('fSquad').value;
  const fp = fPathwayEl ? fPathwayEl.value : '';
  const list = members.filter(m => {
    if (fs && m.squad !== fs) return false;
    if (fp && m.pathway !== fp) return false;
    if (q && !( (m.name || '').toLowerCase().includes(q) || (m.pathway || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const scored = list.filter(m => m.score > 0);
  const avg = scored.length ? Math.round(scored.reduce((s, m) => s + m.score, 0) / scored.length) : null;
  document.getElementById('mTotal').textContent = members.length;
  document.getElementById('mIn').textContent = members.filter(m => m.status === '在帮').length;
  document.getElementById('mAvg').textContent = avg == null ? '—' : avg.toLocaleString('en-US');
  document.getElementById('mCount').textContent = list.length;

  const canWrite = typeof loggedIn !== 'undefined' && loggedIn;
  const wrap = document.getElementById('mWrap');
  if (!list.length) {
    wrap.innerHTML =
      '<div class="arch-empty">' +
      '<div class="e-icon"><svg viewBox="0 0 24 24"><path d="M4 4h16v4H4z"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></svg></div>' +
      (members.length ? '没有符合筛选条件的成员' : (canWrite ? '暂无成员记录，点击下方按钮开始录入' : '暂无成员记录，请管理员登录后录入')) +
      (canWrite ? '<div><div class="btn-add" onclick="openMemberModal()"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>新增成员</div></div>' : '') +
      '</div>';
    paintMigratePanel();
    return;
  }
  wrap.innerHTML =
    '<table class="arch-table">' +
    '<thead><tr><th>#</th><th>姓名</th><th>战团</th><th>途径</th><th>非凡评分</th><th>入会时间</th><th>出勤</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>' +
    '<tbody>' + list.map((m, i) => {
      const stCls = m.status === '在帮' ? 'in' : 'out';
      const nameDisplay = m.name && m.name.trim() ? esc(m.name) : '<span style="color:var(--text-faint);font-style:italic">（待填写）</span>';
      const att = typeof memberAttendanceStats === 'function' ? memberAttendanceStats(m.id) : { present: 0, total: 0, rateText: '—' };
      const attText = att.total
        ? '<span class="t-att" title="出勤 ' + att.present + ' / 登记 ' + att.total + '">' + att.present + '/' + att.total + ' · ' + att.rateText + '</span>'
        : '<span class="t-att muted">—</span>';
      const joinText = m.joinedAt ? esc(m.joinedAt) : '—';
      const opAtt = '<span class="op" data-att="' + m.id + '">考勤</span>';
      const inQueue = migrateQueue.some(x => String(x.id) === String(m.id));
      const opMig = canWrite
        ? (inQueue
            ? '<span class="op mig" data-unqueue="' + m.id + '">取消待迁</span>'
            : '<span class="op mig" data-queue="' + m.id + '">待迁</span>')
        : '';
      const opDel = canWrite ? '<span class="op del" data-del="' + m.id + '">删除</span>' : '';
      const opEdit = canWrite ? '<span class="op" data-edit="' + m.id + '">编辑</span>' : '';
      return '<tr>' +
        '<td style="color:var(--text-faint)">' + (i + 1) + '</td>' +
        '<td class="t-name">' + nameDisplay + '</td>' +
        '<td class="t-squad">' + esc(m.squad) + '</td>' +
        '<td class="t-path">' + esc(m.pathway) + '</td>' +
        '<td class="t-score">' + (m.score ? m.score.toLocaleString('en-US') : '—') + '</td>' +
        '<td class="t-join">' + joinText + '</td>' +
        '<td>' + attText + '</td>' +
        '<td class="t-status ' + stCls + '">' + esc(m.status) + '</td>' +
        '<td class="t-ops">' + opAtt + opMig + opEdit + opDel + '</td>' +
        '</tr>';
    }).join('') + '</tbody></table>';
  paintMigratePanel();
}
document.getElementById('mAddBtn').addEventListener('click', () => openMemberModal());
document.getElementById('memberClose').addEventListener('click', closeMemberModal);
document.getElementById('memberMask').addEventListener('click', e => { if (e.target === document.getElementById('memberMask')) closeMemberModal(); });
document.getElementById('mSaveBtn').addEventListener('click', saveMemberForm);
document.getElementById('mName').addEventListener('keydown', e => { if (e.key === 'Enter') saveMemberForm(); });
document.getElementById('mSearch').addEventListener('input', renderMembers);
document.getElementById('fSquad').addEventListener('change', renderMembers);
if (fPathwayEl) fPathwayEl.addEventListener('change', renderMembers);
document.getElementById('mWrap').addEventListener('click', e => {
  const editEl = e.target.closest('[data-edit]');
  const delEl = e.target.closest('[data-del]');
  const attEl = e.target.closest('[data-att]');
  const queueEl = e.target.closest('[data-queue]');
  const unqueueEl = e.target.closest('[data-unqueue]');
  if (editEl) {
    const m = members.find(x => String(x.id) === editEl.dataset.edit);
    if (m) openMemberModal(m);
  }
  if (delEl) {
    const m = members.find(x => String(x.id) === delEl.dataset.del);
    if (m) openDeleteConfirm(m);
  }
  if (attEl) {
    const m = members.find(x => String(x.id) === attEl.dataset.att);
    if (m && typeof openMemberAttModal === 'function') openMemberAttModal(m);
  }
  if (queueEl) addMembersToMigrateQueue([queueEl.dataset.queue]);
  if (unqueueEl) removeMembersFromMigrateQueue([unqueueEl.dataset.unqueue]);
});
/* 删除确认弹窗 */
let pendingDeleteId = null;
function openDeleteConfirm(m){
  if (!requireWrite('删除成员')) return;
  pendingDeleteId = m.id;
  document.getElementById('confirmMsg').textContent = '确认删除成员「' + m.name + '」？此操作不可恢复。';
  document.getElementById('confirmMask').dataset.mode = 'member';
  document.getElementById('confirmMask').classList.add('open');
}
function closeConfirm(){
  document.getElementById('confirmMask').classList.remove('open');
  pendingDeleteId = null;
  if (typeof pendingDeleteEventId !== 'undefined') pendingDeleteEventId = null;
  document.getElementById('confirmMask').dataset.mode = '';
}
document.getElementById('confirmCancel').addEventListener('click', closeConfirm);
document.getElementById('confirmMask').addEventListener('click', e => {
  if (e.target === document.getElementById('confirmMask')) closeConfirm();
});
document.getElementById('confirmOk').addEventListener('click', async () => {
  const mode = document.getElementById('confirmMask').dataset.mode;
  if (mode === 'event' && typeof pendingDeleteEventId !== 'undefined' && pendingDeleteEventId != null) {
    const id = pendingDeleteEventId;
    const ev = typeof getEventById === 'function' ? getEventById(id) : null;
    try {
      await api('/api/events/' + encodeURIComponent(id), { method: 'DELETE' });
      attendanceEvents = attendanceEvents.filter(x => String(x.id) !== String(id));
      toast('已删除活动「' + ((ev && ev.name) || '') + '」');
      closeConfirm();
      if (typeof renderDkpPage === 'function') renderDkpPage();
      renderMembers();
    } catch (err) {
      toast(err.message || '删除失败');
    }
    return;
  }
  if (pendingDeleteId == null) return;
  const id = pendingDeleteId;
  const m = members.find(x => x.id === id);
  try {
    await api('/api/members/' + encodeURIComponent(id), { method: 'DELETE' });
    members = members.filter(x => x.id !== id);
    toast('已删除成员「' + ((m && m.name) || '') + '」');
    closeConfirm();
    renderMembers();
    if (typeof refreshOverview === 'function') refreshOverview();
  } catch (err) {
    toast(err.message || '删除失败');
  }
});

async function saveMemberForm(){
  if (!requireWrite('保存成员')) return;
  const name = document.getElementById('mName').value.trim();
  if (!name) { toast('请先输入成员姓名'); document.getElementById('mName').focus(); return; }
  const score = parseInt(document.getElementById('mScore').value, 10) || 0;
  const data = {
    name,
    squad: document.getElementById('mSquad').value,
    pathway: document.getElementById('mPathway').value,
    score: Math.max(0, score),
    status: document.getElementById('mStatus').value,
    joinedAt: document.getElementById('mJoinedAt').value || ''
  };
  if (typeof withClubId === 'function') Object.assign(data, withClubId({}));
  try {
    if (editingId) {
      const res = await api('/api/members/' + encodeURIComponent(editingId), {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      const idx = members.findIndex(x => x.id === editingId);
      if (idx > -1) members[idx] = res.member;
      toast('已更新成员「' + name + '」');
    } else {
      const res = await api('/api/members', {
        method: 'POST',
        body: JSON.stringify(data)
      });
      members.push(res.member);
      toast('已录入成员「' + name + '」');
    }
    closeMemberModal();
    renderMembers();
    if (typeof refreshOverview === 'function') refreshOverview();
  } catch (err) {
    toast(err.message || '保存失败');
  }
}

/* ===================== 成员 OCR 批量录入 ===================== */
async function runMemberOcrFromFile(file){
  if (!requireWrite('OCR 录入')) return;
  if (!file) return;
  const compress = typeof fileToLeagueOcrImage === 'function'
    ? fileToLeagueOcrImage
    : null;
  if (!compress) {
    toast('OCR 组件未加载，请刷新页面');
    return;
  }
  try {
    toast('正在识别成员名单…', 5000);
    const img = await compress(file);
    let res;
    try {
      res = await api('/api/members/ocr', {
        method: 'POST',
        body: JSON.stringify({ imageBase64: img.base64 })
      });
    } catch (err) {
      const code = err && err.data && err.data.code;
      const needLocal = code === 'ocr_not_configured' || code === 'tencent_ocr_failed' || (err && err.status === 503);
      if (!needLocal || typeof runLocalBrowserOcr !== 'function') throw err;
      toast((err.message || '云端 OCR 失败') + '，切换本地 OCR…', 4500);
      const text = await runLocalBrowserOcr(img.dataUrl);
      if (!String(text || '').trim()) {
        toast('本地 OCR 未识别到文字，请换更清晰截图', 3500);
        return;
      }
      res = await api('/api/members/ocr', {
        method: 'POST',
        body: JSON.stringify({ text: text })
      });
    }
    const candidates = (res && res.candidates) || [];
    if (!candidates.length) {
      toast('未识别到成员姓名，请换更清晰的名单截图', 3500);
      return;
    }
    const preview = candidates.slice(0, 12).map(c =>
      c.name + (c.pathway && c.pathway !== '歌颂者' ? ('/' + c.pathway) : '')
    ).join('、');
    const more = candidates.length > 12 ? '…' : '';
    if (!confirm(
      '识别到 ' + candidates.length + ' 人（' + (res.engine || 'OCR') + '）：\n' +
      preview + more + '\n\n将跳过本俱乐部已存在同名成员，确认录入？'
    )) return;
    const today = (() => {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    })();
    const payload = typeof withClubId === 'function'
      ? withClubId({ members: candidates, joinedAt: today })
      : { members: candidates, joinedAt: today };
    const batch = await api('/api/members/batch', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    members = batch.members || members.concat(batch.created || []);
    const n = (batch.created || []).length;
    const skip = (batch.skipped || []).length;
    toast(
      '已录入 ' + n + ' 人' +
      (skip ? ('，跳过同名 ' + skip + ' 人') : '') +
      ' · 请核对途径与评分',
      4000
    );
    renderMembers();
    if (typeof refreshOverview === 'function') refreshOverview();
  } catch (err) {
    toast(err.message || 'OCR 录入失败', 4000);
  }
}

document.getElementById('mOcrFile')?.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (file) await runMemberOcrFromFile(file);
});

/* ===================== 成员迁移 / 待迁区 ===================== */
async function loadMigrateQueue(){
  if (typeof loggedIn === 'undefined' || !loggedIn) {
    migrateQueue = [];
    paintMigratePanel();
    return;
  }
  try {
    const data = await api('/api/members/migrate-queue');
    migrateQueue = data.items || [];
  } catch (e) {
    migrateQueue = [];
  }
  paintMigratePanel();
}

function paintMigratePanel(){
  const panel = document.getElementById('migratePanel');
  const list = document.getElementById('migrateList');
  const countEl = document.getElementById('migrateCount');
  const subEl = document.getElementById('migrateSub');
  const hintEl = document.getElementById('migrateHint');
  const targetSel = document.getElementById('migrateTarget');
  if (!panel || !list) return;
  const canWrite = typeof loggedIn !== 'undefined' && loggedIn;
  const clubs = (typeof orgClubs !== 'undefined' && orgClubs.length)
    ? orgClubs
    : [{ id: 'main', name: '王下七武海', kind: 'main' }];

  if (hintEl) hintEl.hidden = !canWrite;

  // 空托盘不占版面；有人再浮出
  if (!canWrite || !migrateQueue.length) {
    panel.hidden = true;
    if (countEl) countEl.textContent = '0';
    list.innerHTML = '';
    return;
  }
  panel.hidden = false;
  if (countEl) countEl.textContent = String(migrateQueue.length);

  if (targetSel) {
    const prev = targetSel.value;
    const cur = (typeof activeClubId !== 'undefined' && activeClubId) ? String(activeClubId) : '';
    const prefer = clubs.find(c => String(c.id) !== cur) || clubs[0];
    targetSel.innerHTML = clubs.map(c =>
      '<option value="' + esc(c.id) + '">' +
        esc(c.name) + (c.kind === 'main' ? '（主）' : '（附属）') +
      '</option>'
    ).join('');
    if (prev && clubs.some(c => String(c.id) === prev)) targetSel.value = prev;
    else if (prefer) targetSel.value = String(prefer.id);
  }

  const targetName = targetSel
    ? (targetSel.options[targetSel.selectedIndex]?.text || '')
    : '';
  if (subEl) {
    subEl.textContent = '将迁入「' + targetName + '」· 会清空原战团号位';
  }

  const toneFn = typeof pathwayTone === 'function' ? pathwayTone : () => 'tone-default';
  const initialFn = typeof nameInitial === 'function'
    ? nameInitial
    : (n) => { const s = String(n || '').trim(); return s ? s.slice(0, 1) : '?'; };

  list.innerHTML = migrateQueue.map(m =>
    '<div class="migrate-chip ' + toneFn(m.pathway) + '" data-mid="' + esc(m.id) + '">' +
      '<span class="av">' + esc(initialFn(m.name)) + '</span>' +
      '<div class="who">' +
        '<div class="n">' + esc(m.name || '（未命名）') + '</div>' +
        '<div class="m">' + esc(m.fromClubName || '—') +
          (m.pathway ? (' · ' + esc(m.pathway)) : '') +
        '</div>' +
      '</div>' +
      '<button type="button" class="rm" data-unqueue="' + esc(m.id) + '" title="移出托盘">×</button>' +
    '</div>'
  ).join('');
}

async function addMembersToMigrateQueue(ids){
  if (!requireWrite('加入迁入托盘')) return;
  try {
    const res = await api('/api/members/migrate-queue', {
      method: 'POST',
      body: JSON.stringify({ memberIds: ids })
    });
    migrateQueue = res.items || [];
    toast('已加入迁入托盘');
    renderMembers();
    const dock = document.getElementById('migratePanel');
    if (dock && !dock.hidden) dock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    toast(err.message || '加入失败');
  }
}

async function removeMembersFromMigrateQueue(ids, opts){
  if (!requireWrite('移出迁入托盘')) return;
  try {
    const body = (opts && opts.all)
      ? { all: true }
      : { memberIds: ids };
    const res = await api('/api/members/migrate-queue', {
      method: 'DELETE',
      body: JSON.stringify(body)
    });
    migrateQueue = res.items || [];
    toast(opts && opts.all ? '已清空迁入托盘' : '已移出托盘');
    renderMembers();
  } catch (err) {
    toast(err.message || '操作失败');
  }
}

async function confirmMigrateMembers(){
  if (!requireWrite('确认迁入')) return;
  if (!migrateQueue.length) { toast('托盘为空'); return; }
  const targetSel = document.getElementById('migrateTarget');
  const targetId = targetSel ? targetSel.value : '';
  if (!targetId) { toast('请选择目标俱乐部'); return; }
  const target = (typeof orgClubs !== 'undefined' ? orgClubs : [])
    .find(c => String(c.id) === String(targetId));
  const targetName = target ? target.name : targetId;
  const names = migrateQueue.slice(0, 8).map(m => m.name).join('、');
  const more = migrateQueue.length > 8 ? '…' : '';
  if (!confirm(
    '确认将 ' + migrateQueue.length + ' 名成员迁入「' + targetName + '」？\n' +
    names + more + '\n\n迁入后会清空其原战团号位，并从托盘移除。'
  )) return;
  try {
    const res = await api('/api/members/migrate', {
      method: 'POST',
      body: JSON.stringify({
        targetClubId: targetId,
        memberIds: migrateQueue.map(m => m.id)
      })
    });
    migrateQueue = res.items || [];
    const n = (res.moved || []).length;
    const skip = (res.skipped || []).length;
    toast(
      '已迁入 ' + n + ' 人至「' + (res.targetClubName || targetName) + '」' +
      (skip ? ('，跳过 ' + skip + ' 人') : '')
    );
    // 若当前正在看目标俱乐部，刷新名单；否则从当前列表剔除已迁出的人
    if (typeof activeClubId !== 'undefined' && String(activeClubId) === String(targetId)) {
      members = res.members || await apiLoadMembers();
    } else {
      const movedIds = new Set((res.moved || []).map(x => String(x.id)));
      members = members.filter(m => !movedIds.has(String(m.id)));
    }
    renderMembers();
    if (typeof refreshOverview === 'function') refreshOverview();
  } catch (err) {
    toast(err.message || '迁入失败');
  }
}

document.getElementById('migrateTarget')?.addEventListener('change', () => {
  if (typeof paintMigratePanel === 'function') paintMigratePanel();
});
document.getElementById('migrateList')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-unqueue]');
  if (btn) removeMembersFromMigrateQueue([btn.dataset.unqueue]);
});
document.getElementById('migrateConfirmBtn')?.addEventListener('click', confirmMigrateMembers);
document.getElementById('migrateClearBtn')?.addEventListener('click', () => {
  if (!migrateQueue.length) { toast('托盘已空'); return; }
  if (!confirm('清空迁入托盘？（不会迁移成员）')) return;
  removeMembersFromMigrateQueue([], { all: true });
});
