/* ===================== 活动考勤（共享 API） ===================== */
const ATT_STATUS = {
  present: { label: '出勤', cls: 'st-present' },
  leave:   { label: '请假', cls: 'st-leave' },
  absent:  { label: '缺席', cls: 'st-absent' }
};

let attendanceEvents = [];
let rollCallEventId = null;
let pendingDeleteEventId = null;
let rollSaveTimer = null;

function todayStr(){
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function getEventById(id){
  return attendanceEvents.find(e => String(e.id) === String(id));
}

function eventPresentCount(ev){
  if (!ev || !ev.records) return 0;
  return Object.values(ev.records).filter(s => s === 'present').length;
}

function eventExpectedCount(){
  return (typeof members !== 'undefined' ? members : []).filter(m => m.status === '在帮').length;
}

function memberAttendanceStats(memberId){
  const mid = String(memberId);
  let present = 0, leave = 0, absent = 0, total = 0;
  attendanceEvents.forEach(ev => {
    const st = ev.records && ev.records[mid];
    if (!st) return;
    total++;
    if (st === 'present') present++;
    else if (st === 'leave') leave++;
    else if (st === 'absent') absent++;
  });
  const rateText = total
    ? Math.round((present / total) * 100) + '%'
    : '—';
  return { present, leave, absent, total, rateText };
}

function memberAttendanceHistory(memberId, limit){
  const mid = String(memberId);
  const rows = [];
  attendanceEvents
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.id).localeCompare(String(a.id)))
    .forEach(ev => {
      const st = ev.records && ev.records[mid];
      if (!st) return;
      rows.push({ event: ev, status: st });
    });
  return typeof limit === 'number' ? rows.slice(0, limit) : rows;
}

async function persistEventRecords(ev){
  if (!ev) return;
  const res = await api('/api/events/' + encodeURIComponent(ev.id) + '/records', {
    method: 'PUT',
    body: JSON.stringify({ records: ev.records || {} })
  });
  const idx = attendanceEvents.findIndex(e => String(e.id) === String(ev.id));
  if (idx > -1) attendanceEvents[idx] = res.event;
  return res.event;
}

function schedulePersistRecords(ev){
  clearTimeout(rollSaveTimer);
  rollSaveTimer = setTimeout(async () => {
    try {
      await persistEventRecords(ev);
    } catch (err) {
      toast(err.message || '点名保存失败');
    }
  }, 280);
}

function renderDkpPage(){
  if (typeof updateWriteUI === 'function') updateWriteUI();
  const listEl = document.getElementById('dkpEventList');
  const emptyEl = document.getElementById('dkpEmpty');
  const countEl = document.getElementById('dkpEventCount');
  if (!listEl) return;

  const canWrite = typeof loggedIn !== 'undefined' && loggedIn;
  const sorted = attendanceEvents.slice().sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || String(b.id).localeCompare(String(a.id))
  );
  if (countEl) countEl.textContent = sorted.length;

  const expected = eventExpectedCount();

  if (!sorted.length) {
    listEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = '';
      const tip = emptyEl.querySelector('.arch-empty');
      if (tip) {
        const textNode = tip.childNodes[tip.childNodes.length - 1];
        // keep icon, update message via last text - simpler replace whole empty
      }
      emptyEl.innerHTML =
        '<div class="arch-empty">' +
        '<div class="e-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M15 9.2c-.6-1-1.7-1.6-3-1.6-1.8 0-3 .9-3 2.3 0 3.2 6 1.3 6 4.5 0 1.4-1.3 2.4-3.2 2.4-1.4 0-2.6-.7-3.1-1.8"/></svg></div>' +
        (canWrite ? '暂无活动场次，点击上方按钮开始创建' : '暂无活动场次') +
        '</div>';
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = sorted.map(ev => {
    const present = eventPresentCount(ev);
    const recorded = ev.records ? Object.keys(ev.records).length : 0;
    const ops = canWrite
      ? ('<span class="op" data-roll="' + esc(ev.id) + '">点名</span>' +
         '<span class="op" data-edit-ev="' + esc(ev.id) + '">编辑</span>' +
         '<span class="op del" data-del-ev="' + esc(ev.id) + '">删除</span>')
      : ('<span class="op" data-roll="' + esc(ev.id) + '">查看</span>');
    return (
      '<div class="dkp-card" data-event-id="' + esc(ev.id) + '">' +
        '<div class="dkp-card-main">' +
          '<div class="dkp-date">' + esc(ev.date || '—') + '</div>' +
          '<div class="dkp-name">' + esc(ev.name || '未命名活动') + '</div>' +
          (ev.note ? '<div class="dkp-note">' + esc(ev.note) + '</div>' : '') +
        '</div>' +
        '<div class="dkp-card-meta">' +
          '<div class="dkp-stat"><b>' + present + '</b><span>出勤</span></div>' +
          '<div class="dkp-stat"><b>' + recorded + '/' + expected + '</b><span>已登记</span></div>' +
        '</div>' +
        '<div class="dkp-card-ops">' + ops + '</div>' +
      '</div>'
    );
  }).join('');
}

const DKP_ACTIVITY_PRESETS = ['终末猎杀', '四方联赛', '俱乐部宣战', '猎城战', '高原战', '其他'];

function syncEventNameUI(){
  const type = document.getElementById('evType')?.value || '终末猎杀';
  const wrap = document.getElementById('evNameWrap');
  if (wrap) wrap.hidden = type !== '其他';
}

function resolveEventName(){
  const type = document.getElementById('evType')?.value || '终末猎杀';
  if (type === '其他') return (document.getElementById('evName')?.value || '').trim();
  return type;
}

function openEventModal(ev){
  if (!requireWrite('创建/编辑活动')) return;
  const isEdit = !!ev;
  document.getElementById('eventModalTitle').textContent = isEdit ? '编辑活动' : '新建活动';
  document.getElementById('evDate').value = ev ? (ev.date || todayStr()) : todayStr();
  const rawName = ev ? (ev.name || '') : '终末猎杀';
  const typeEl = document.getElementById('evType');
  if (typeEl) {
    if (DKP_ACTIVITY_PRESETS.includes(rawName) && rawName !== '其他') {
      typeEl.value = rawName;
      document.getElementById('evName').value = '';
    } else if (!rawName) {
      typeEl.value = '终末猎杀';
      document.getElementById('evName').value = '';
    } else {
      typeEl.value = '其他';
      document.getElementById('evName').value = rawName;
    }
  }
  syncEventNameUI();
  document.getElementById('evNote').value = ev ? (ev.note || '') : '';
  document.getElementById('eventMask').dataset.editId = isEdit ? String(ev.id) : '';
  document.getElementById('eventMask').classList.add('open');
  setTimeout(() => {
    if (typeEl && typeEl.value === '其他') document.getElementById('evName').focus();
    else document.getElementById('evDate').focus();
  }, 60);
}

function closeEventModal(){
  document.getElementById('eventMask').classList.remove('open');
}

async function saveEventForm(){
  if (!requireWrite('保存活动')) return;
  const date = document.getElementById('evDate').value;
  const name = resolveEventName();
  const note = document.getElementById('evNote').value.trim();
  if (!date) { toast('请选择活动日期'); return; }
  if (!name) { toast('请填写活动名称'); document.getElementById('evName').focus(); return; }

  const editId = document.getElementById('eventMask').dataset.editId;
  try {
    if (editId) {
      const res = await api('/api/events/' + encodeURIComponent(editId), {
        method: 'PUT',
        body: JSON.stringify({ date, name, note })
      });
      const idx = attendanceEvents.findIndex(e => String(e.id) === editId);
      if (idx > -1) attendanceEvents[idx] = res.event;
      toast('已更新活动「' + name + '」');
      closeEventModal();
      renderDkpPage();
      if (typeof renderMembers === 'function') renderMembers();
    } else {
      const res = await api('/api/events', {
        method: 'POST',
        body: JSON.stringify(typeof withClubId === 'function' ? withClubId({ date, name, note }) : { date, name, note })
      });
      attendanceEvents.push(res.event);
      toast('已创建活动「' + name + '」');
      closeEventModal();
      renderDkpPage();
      openRollCall(res.event.id);
    }
  } catch (err) {
    toast(err.message || '保存失败');
  }
}

function openRollCall(eventId){
  const ev = getEventById(eventId);
  if (!ev) { toast('活动不存在'); return; }
  rollCallEventId = ev.id;
  document.getElementById('rollTitle').textContent = ev.name || '点名';
  document.getElementById('rollSub').textContent = (ev.date || '') + (ev.note ? ' · ' + ev.note : '');
  const pathSel = document.getElementById('rollPathway');
  if (pathSel && !pathSel.dataset.ready && typeof PATHWAYS !== 'undefined') {
    PATHWAYS.forEach(p => {
      const o = document.createElement('option');
      o.value = p; o.textContent = p;
      pathSel.appendChild(o);
    });
    pathSel.dataset.ready = '1';
  }
  if (pathSel) pathSel.value = '';
  const canWrite = typeof loggedIn !== 'undefined' && loggedIn;
  document.getElementById('rollActions')?.classList.toggle('hidden', !canWrite);
  renderRollCallList();
  document.getElementById('rollMask').classList.add('open');
}

function closeRollCall(){
  document.getElementById('rollMask').classList.remove('open');
  rollCallEventId = null;
}

function getRollPathwayFilter(){
  const el = document.getElementById('rollPathway');
  return el ? el.value : '';
}

function renderRollCallList(){
  const wrap = document.getElementById('rollList');
  const ev = getEventById(rollCallEventId);
  if (!wrap || !ev) return;
  if (!ev.records) ev.records = {};

  const canWrite = typeof loggedIn !== 'undefined' && loggedIn;
  const filterPath = getRollPathwayFilter();
  const active = (typeof members !== 'undefined' ? members : []).filter(m => m.status === '在帮');
  const list = active
    .filter(m => !filterPath || m.pathway === filterPath)
    .slice()
    .sort((a, b) => {
      const pa = (a.pathway || '').localeCompare(b.pathway || '', 'zh');
      if (pa) return pa;
      return (a.name || '').localeCompare(b.name || '', 'zh');
    });

  let present = 0, leave = 0, absent = 0, none = 0;
  active.forEach(m => {
    const st = ev.records[m.id];
    if (st === 'present') present++;
    else if (st === 'leave') leave++;
    else if (st === 'absent') absent++;
    else none++;
  });
  document.getElementById('rollSummary').textContent =
    '出勤 ' + present + ' · 请假 ' + leave + ' · 缺席 ' + absent + ' · 未登记 ' + none +
    (filterPath ? ' · 当前筛选 ' + list.length + ' 人' : '') +
    (canWrite ? '' : ' · 只读');

  if (!list.length) {
    wrap.innerHTML = '<div class="arch-empty" style="padding:36px 12px">' +
      (active.length ? '当前途径筛选下暂无在帮成员' : '暂无在帮成员，请先在成员档案中录入') +
      '</div>';
    return;
  }

  wrap.innerHTML = list.map(m => {
    const st = ev.records[m.id] || '';
    const nameDisplay = m.name && m.name.trim()
      ? esc(m.name)
      : '<span class="roll-unnamed">（待填写）</span>';
    return (
      '<div class="roll-row" data-mid="' + esc(m.id) + '">' +
        '<div class="roll-who">' +
          '<span class="roll-name">' + nameDisplay + '</span>' +
          '<span class="roll-path">' + esc(m.pathway || '') + (m.squad ? ' · ' + esc(m.squad) : '') + '</span>' +
        '</div>' +
        '<div class="roll-tog">' +
          Object.keys(ATT_STATUS).map(k => {
            const meta = ATT_STATUS[k];
            const on = st === k ? ' on' : '';
            const dis = canWrite ? '' : ' disabled';
            return '<button type="button" class="roll-btn ' + meta.cls + on + '"' + dis + ' data-st="' + k + '">' + meta.label + '</button>';
          }).join('') +
        '</div>' +
      '</div>'
    );
  }).join('');
}

function setRollStatus(memberId, status){
  if (!requireWrite('点名')) return;
  const ev = getEventById(rollCallEventId);
  if (!ev) return;
  if (!ev.records) ev.records = {};
  if (ev.records[memberId] === status) {
    delete ev.records[memberId];
  } else {
    ev.records[memberId] = status;
  }
  renderRollCallList();
  renderDkpPage();
  if (typeof renderMembers === 'function') renderMembers();
  schedulePersistRecords(ev);
}

function bulkMarkPresent(onlyUnset){
  if (!requireWrite('批量点名')) return;
  const ev = getEventById(rollCallEventId);
  if (!ev) return;
  if (!ev.records) ev.records = {};
  const filterPath = getRollPathwayFilter();
  (typeof members !== 'undefined' ? members : [])
    .filter(m => m.status === '在帮')
    .filter(m => !filterPath || m.pathway === filterPath)
    .forEach(m => {
      if (onlyUnset && ev.records[m.id]) return;
      ev.records[m.id] = 'present';
    });
  renderRollCallList();
  renderDkpPage();
  if (typeof renderMembers === 'function') renderMembers();
  schedulePersistRecords(ev);
  toast(onlyUnset
    ? (filterPath ? '已为「' + filterPath + '」未登记成员标为出勤' : '已为未登记成员标为出勤')
    : (filterPath ? '已将「' + filterPath + '」标为出勤' : '已全员标为出勤'));
}

function bulkClear(){
  if (!requireWrite('清空点名')) return;
  const ev = getEventById(rollCallEventId);
  if (!ev) return;
  const filterPath = getRollPathwayFilter();
  if (!filterPath) {
    ev.records = {};
  } else if (ev.records) {
    (typeof members !== 'undefined' ? members : []).forEach(m => {
      if (m.pathway === filterPath) delete ev.records[m.id];
    });
  }
  renderRollCallList();
  renderDkpPage();
  if (typeof renderMembers === 'function') renderMembers();
  schedulePersistRecords(ev);
  toast(filterPath ? '已清空「' + filterPath + '」点名' : '已清空点名');
}

function openMemberAttModal(member){
  const stats = memberAttendanceStats(member.id);
  const hist = memberAttendanceHistory(member.id, 20);
  document.getElementById('attMemberTitle').textContent = (member.name || '（待填写）') + ' · 考勤';
  document.getElementById('attMemberSub').textContent =
    '出勤 ' + stats.present + ' · 请假 ' + stats.leave + ' · 缺席 ' + stats.absent +
    ' · 出勤率 ' + stats.rateText;
  const body = document.getElementById('attMemberBody');
  if (!hist.length) {
    body.innerHTML = '<div class="arch-empty" style="padding:28px 8px">暂无该成员的考勤记录</div>';
  } else {
    body.innerHTML =
      '<table class="arch-table att-hist-table"><thead><tr><th>日期</th><th>活动</th><th>状态</th></tr></thead><tbody>' +
      hist.map(row => {
        const meta = ATT_STATUS[row.status] || { label: row.status, cls: '' };
        return '<tr><td>' + esc(row.event.date) + '</td><td>' + esc(row.event.name) +
          '</td><td class="' + meta.cls + '">' + meta.label + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }
  document.getElementById('attMemberMask').classList.add('open');
}

function closeMemberAttModal(){
  document.getElementById('attMemberMask').classList.remove('open');
}

function openDeleteEventConfirm(ev){
  if (!requireWrite('删除活动')) return;
  pendingDeleteEventId = ev.id;
  document.getElementById('confirmMsg').textContent =
    '确认删除活动「' + (ev.name || '') + '」（' + (ev.date || '') + '）？点名记录将一并清除。';
  document.getElementById('confirmMask').dataset.mode = 'event';
  document.getElementById('confirmMask').classList.add('open');
}

(function bindAttendanceUI(){
  const addBtn = document.getElementById('dkpAddBtn');
  if (addBtn) addBtn.addEventListener('click', () => openEventModal());

  document.getElementById('eventClose')?.addEventListener('click', closeEventModal);
  document.getElementById('eventMask')?.addEventListener('click', e => {
    if (e.target === document.getElementById('eventMask')) closeEventModal();
  });
  document.getElementById('evSaveBtn')?.addEventListener('click', saveEventForm);
  document.getElementById('evType')?.addEventListener('change', syncEventNameUI);

  document.getElementById('rollClose')?.addEventListener('click', closeRollCall);
  document.getElementById('rollMask')?.addEventListener('click', e => {
    if (e.target === document.getElementById('rollMask')) closeRollCall();
  });
  document.getElementById('rollPathway')?.addEventListener('change', renderRollCallList);
  document.getElementById('rollAllPresent')?.addEventListener('click', () => bulkMarkPresent(false));
  document.getElementById('rollUnsetPresent')?.addEventListener('click', () => bulkMarkPresent(true));
  document.getElementById('rollClear')?.addEventListener('click', bulkClear);

  document.getElementById('rollList')?.addEventListener('click', e => {
    const btn = e.target.closest('.roll-btn');
    if (!btn || btn.disabled) return;
    const row = btn.closest('.roll-row');
    if (!row) return;
    setRollStatus(row.dataset.mid, btn.dataset.st);
  });

  document.getElementById('dkpEventList')?.addEventListener('click', e => {
    const roll = e.target.closest('[data-roll]');
    const edit = e.target.closest('[data-edit-ev]');
    const del = e.target.closest('[data-del-ev]');
    if (roll) openRollCall(roll.dataset.roll);
    if (edit) {
      const ev = getEventById(edit.dataset.editEv);
      if (ev) openEventModal(ev);
    }
    if (del) {
      const ev = getEventById(del.dataset.delEv);
      if (ev) openDeleteEventConfirm(ev);
    }
  });

  document.getElementById('attMemberClose')?.addEventListener('click', closeMemberAttModal);
  document.getElementById('attMemberMask')?.addEventListener('click', e => {
    if (e.target === document.getElementById('attMemberMask')) closeMemberAttModal();
  });
  document.getElementById('attGotoDkp')?.addEventListener('click', () => {
    closeMemberAttModal();
    if (typeof showPage === 'function') showPage('dkp');
  });
})();
