/* ===================== 俱乐部切换 + 同盟 ===================== */
const ACTIVE_CLUB_KEY = 'beyonders-active-club';
let orgClubs = [];
let orgAlliances = [];
let activeClubId = localStorage.getItem(ACTIVE_CLUB_KEY) || '';

function clubQuery(extra){
  const q = new URLSearchParams(extra || {});
  if (activeClubId) q.set('clubId', activeClubId);
  const s = q.toString();
  return s ? ('?' + s) : '';
}

/** 写入请求体附带当前俱乐部 id */
function withClubId(payload){
  const out = Object.assign({}, payload || {});
  if (activeClubId) out.clubId = activeClubId;
  return out;
}

function activeClub(){
  return orgClubs.find(c => String(c.id) === String(activeClubId)) || orgClubs[0] || null;
}

function setActiveClubId(id){
  activeClubId = id ? String(id) : '';
  if (activeClubId) localStorage.setItem(ACTIVE_CLUB_KEY, activeClubId);
  else localStorage.removeItem(ACTIVE_CLUB_KEY);
  paintClubSwitcher();
  updateClubChrome();
}

function updateClubChrome(){
  const c = activeClub();
  const title = document.getElementById('tbClubTitle');
  const sub = document.getElementById('tbClubSub');
  const name = c ? c.name : '王下七武海';
  const kind = c && c.kind === 'main' ? '主俱乐部' : '附属俱乐部';
  if (title) title.textContent = name + ' · 俱乐部管理';
  if (sub) sub.textContent = kind + '数据 · 论坛为全公会共享';
}

function paintClubSwitcher(){
  const wrap = document.getElementById('clubSwitcher');
  const sel = document.getElementById('clubSelect');
  if (!wrap || !sel) return;
  const isAdmin = typeof loggedIn !== 'undefined' && loggedIn;
  if (!isAdmin) {
    wrap.hidden = true;
    return;
  }
  // 无附属时也展示主俱乐部；API 未返回时用本地兜底
  if (!orgClubs.length) {
    orgClubs = [{ id: 'main', name: '王下七武海', kind: 'main', note: '' }];
  }
  wrap.hidden = false;
  if (!activeClubId || !orgClubs.some(c => String(c.id) === String(activeClubId))) {
    const main = orgClubs.find(c => c.kind === 'main') || orgClubs[0];
    if (main) activeClubId = String(main.id);
    if (activeClubId) localStorage.setItem(ACTIVE_CLUB_KEY, activeClubId);
  }
  sel.innerHTML = orgClubs.map(c =>
    '<option value="' + esc(c.id) + '"' +
      (String(c.id) === String(activeClubId) ? ' selected' : '') + '>' +
      esc(c.name) + (c.kind === 'main' ? '（主）' : '（附属）') +
    '</option>'
  ).join('');
  // 强制同步显示值（部分浏览器空 options 后不刷新）
  sel.value = String(activeClubId || (orgClubs[0] && orgClubs[0].id) || 'main');
}

async function loadOrgClubs(){
  try {
    const data = await api('/api/clubs');
    orgClubs = data.clubs || [];
    paintClubSwitcher();
    updateClubChrome();
  } catch (e) {
    orgClubs = [];
  }
}

async function loadOrgAlliances(){
  try {
    const data = await api('/api/alliances');
    orgAlliances = data.alliances || [];
  } catch (e) {
    orgAlliances = [];
  }
  paintAlliancePanel();
}

function paintAlliancePanel(){
  const list = document.getElementById('allianceList');
  const panel = document.getElementById('alliancePanel');
  if (!list || !panel) return;
  const isAdmin = typeof loggedIn !== 'undefined' && loggedIn;
  if (!isAdmin) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  if (!orgAlliances.length) {
    list.innerHTML = '<div class="alliance-empty">暂无同盟记录。可在「系统设置」中添加。</div>';
    return;
  }
  list.innerHTML = orgAlliances.map(a =>
    '<div class="alliance-card">' +
      '<div class="n">' + esc(a.name) + '</div>' +
      (a.note ? ('<div class="m">' + esc(a.note) + '</div>') : '') +
    '</div>'
  ).join('');
}

async function reloadClubScopedData(){
  try {
    overviewCache = await apiLoadOverview();
    if (overviewCache && overviewCache.alliances) orgAlliances = overviewCache.alliances;
    if (overviewCache && overviewCache.clubs) {
      orgClubs = overviewCache.clubs;
      paintClubSwitcher();
      updateClubChrome();
    }
    paintAlliancePanel();
    if (typeof loggedIn !== 'undefined' && loggedIn) {
      members = await apiLoadMembers();
      attendanceEvents = await apiLoadEvents();
    } else {
      attendanceEvents = await apiLoadEvents();
      members = [];
    }
    if (typeof refreshOverview === 'function') refreshOverview();
    if (typeof renderMembers === 'function') renderMembers();
    if (typeof renderDkpPage === 'function') renderDkpPage();
    if (typeof loadMigrateQueue === 'function') await loadMigrateQueue();
    const page = document.querySelector('.nav-item.active')?.dataset.page;
    if (page === 'squads' && typeof renderSquadsPage === 'function') renderSquadsPage();
    if (page === 'settings' && typeof renderSettingsPage === 'function') renderSettingsPage();
  } catch (e) {
    toast(e.message || '切换俱乐部失败');
  }
}

document.getElementById('clubSelect')?.addEventListener('change', async (e) => {
  setActiveClubId(e.target.value);
  toast('已切换到「' + (activeClub()?.name || '') + '」');
  await reloadClubScopedData();
});

function renderOrgSettingsBlocks(canWrite){
  const clubsHtml =
    '<div class="settings-card">' +
      '<h3>附属俱乐部</h3>' +
      '<p class="settings-desc">主俱乐部固定为「王下七武海」。可新增附属俱乐部并切换录入成员 / DKP / 编组。论坛不受切换影响。</p>' +
      '<div class="org-list" id="settingsClubList"></div>' +
      (canWrite
        ? '<div class="org-add-row">' +
            '<input id="newClubName" placeholder="附属俱乐部名称" maxlength="40">' +
            '<input id="newClubNote" placeholder="备注（可选）" maxlength="200">' +
            '<button type="button" class="btn primary" id="btnAddClub" style="margin:0;padding:8px 14px">添加</button>' +
          '</div>'
        : '') +
    '</div>';
  const alliesHtml =
    '<div class="settings-card">' +
      '<h3>同盟</h3>' +
      '<p class="settings-desc">同盟展示在总览页，全公会可见。</p>' +
      '<div class="org-list" id="settingsAllyList"></div>' +
      (canWrite
        ? '<div class="org-add-row">' +
            '<input id="newAllyName" placeholder="同盟名称" maxlength="40">' +
            '<input id="newAllyNote" placeholder="说明（可选）" maxlength="300">' +
            '<button type="button" class="btn primary" id="btnAddAlly" style="margin:0;padding:8px 14px">添加</button>' +
          '</div>'
        : '') +
    '</div>';
  return clubsHtml + alliesHtml;
}

function paintOrgSettingsLists(canWrite){
  const clubBox = document.getElementById('settingsClubList');
  const allyBox = document.getElementById('settingsAllyList');
  if (clubBox) {
    clubBox.innerHTML = orgClubs.map(c =>
      '<div class="org-row">' +
        '<div><b>' + esc(c.name) + '</b>' +
          (c.kind === 'main' ? ' <span class="home-tag">主</span>' : ' <span class="home-tag" style="opacity:.7">附属</span>') +
          (c.note ? ('<div class="m">' + esc(c.note) + '</div>') : '') +
        '</div>' +
        (canWrite && c.kind !== 'main'
          ? '<button type="button" class="op del" data-del-club="' + esc(c.id) + '">删除</button>'
          : '') +
      '</div>'
    ).join('') || '<div class="m">暂无</div>';
  }
  if (allyBox) {
    allyBox.innerHTML = orgAlliances.map(a =>
      '<div class="org-row">' +
        '<div><b>' + esc(a.name) + '</b>' +
          (a.note ? ('<div class="m">' + esc(a.note) + '</div>') : '') +
        '</div>' +
        (canWrite
          ? '<button type="button" class="op del" data-del-ally="' + esc(a.id) + '">删除</button>'
          : '') +
      '</div>'
    ).join('') || '<div class="m">暂无同盟</div>';
  }
  document.getElementById('btnAddClub')?.addEventListener('click', async () => {
    const name = document.getElementById('newClubName')?.value.trim();
    const note = document.getElementById('newClubNote')?.value.trim() || '';
    if (!name) { toast('请填写附属俱乐部名称'); return; }
    try {
      const res = await api('/api/clubs', { method: 'POST', body: JSON.stringify({ name, note }) });
      orgClubs = res.clubs || [];
      paintClubSwitcher();
      paintOrgSettingsLists(true);
      document.getElementById('newClubName').value = '';
      document.getElementById('newClubNote').value = '';
      toast('已添加附属俱乐部');
    } catch (e) { toast(e.message || '添加失败'); }
  });
  document.getElementById('btnAddAlly')?.addEventListener('click', async () => {
    const name = document.getElementById('newAllyName')?.value.trim();
    const note = document.getElementById('newAllyNote')?.value.trim() || '';
    if (!name) { toast('请填写同盟名称'); return; }
    try {
      const res = await api('/api/alliances', { method: 'POST', body: JSON.stringify({ name, note }) });
      orgAlliances = res.alliances || [];
      paintAlliancePanel();
      paintOrgSettingsLists(true);
      document.getElementById('newAllyName').value = '';
      document.getElementById('newAllyNote').value = '';
      toast('已添加同盟');
    } catch (e) { toast(e.message || '添加失败'); }
  });
  document.querySelectorAll('[data-del-club]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('删除该附属俱乐部？须先清空其成员与活动。')) return;
      try {
        const res = await api('/api/clubs/' + encodeURIComponent(btn.dataset.delClub), { method: 'DELETE' });
        orgClubs = res.clubs || [];
        if (String(activeClubId) === String(btn.dataset.delClub)) {
          setActiveClubId((orgClubs.find(c => c.kind === 'main') || orgClubs[0] || {}).id || '');
          await reloadClubScopedData();
        } else paintClubSwitcher();
        paintOrgSettingsLists(true);
        toast('已删除');
      } catch (e) { toast(e.message || '删除失败'); }
    });
  });
  document.querySelectorAll('[data-del-ally]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('删除该同盟？')) return;
      try {
        const res = await api('/api/alliances/' + encodeURIComponent(btn.dataset.delAlly), { method: 'DELETE' });
        orgAlliances = res.alliances || [];
        paintAlliancePanel();
        paintOrgSettingsLists(true);
        toast('已删除');
      } catch (e) { toast(e.message || '删除失败'); }
    });
  });
}
