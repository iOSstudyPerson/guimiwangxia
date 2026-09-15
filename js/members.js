/* ===================== 成员档案（共享 API） ===================== */
const PATHWAYS = ['歌颂者','奶妈','占卜家','学徒','战士','窥秘人'];
let members = [];

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
  const dkpAdd = document.getElementById('dkpAddBtn');
  if (addBtn) addBtn.style.display = canWrite ? '' : 'none';
  if (dkpAdd) dkpAdd.style.display = canWrite ? '' : 'none';
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
    return;
  }
  wrap.innerHTML =
    '<table class="arch-table">' +
    '<thead><tr><th>#</th><th>姓名</th><th>战团</th><th>途径</th><th>非凡评分</th><th>出勤</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>' +
    '<tbody>' + list.map((m, i) => {
      const stCls = m.status === '在帮' ? 'in' : 'out';
      const nameDisplay = m.name && m.name.trim() ? esc(m.name) : '<span style="color:var(--text-faint);font-style:italic">（待填写）</span>';
      const att = typeof memberAttendanceStats === 'function' ? memberAttendanceStats(m.id) : { present: 0, total: 0, rateText: '—' };
      const attText = att.total
        ? '<span class="t-att" title="出勤 ' + att.present + ' / 登记 ' + att.total + '">' + att.present + '/' + att.total + ' · ' + att.rateText + '</span>'
        : '<span class="t-att muted">—</span>';
      const opAtt = '<span class="op" data-att="' + m.id + '">考勤</span>';
      const opDel = canWrite ? '<span class="op del" data-del="' + m.id + '">删除</span>' : '';
      const opEdit = canWrite ? '<span class="op" data-edit="' + m.id + '">编辑</span>' : '';
      return '<tr>' +
        '<td style="color:var(--text-faint)">' + (i + 1) + '</td>' +
        '<td class="t-name">' + nameDisplay + '</td>' +
        '<td class="t-squad">' + esc(m.squad) + '</td>' +
        '<td class="t-path">' + esc(m.pathway) + '</td>' +
        '<td class="t-score">' + (m.score ? m.score.toLocaleString('en-US') : '—') + '</td>' +
        '<td>' + attText + '</td>' +
        '<td class="t-status ' + stCls + '">' + esc(m.status) + '</td>' +
        '<td class="t-ops">' + opAtt + opEdit + opDel + '</td>' +
        '</tr>';
    }).join('') + '</tbody></table>';
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
    status: document.getElementById('mStatus').value
  };
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
