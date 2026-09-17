/* ===================== 总览：管理员用 members 汇总；访客用 /api/overview ===================== */
let overviewCache = null;

function currentOverview(){
  if (typeof loggedIn !== 'undefined' && loggedIn && Array.isArray(members) && members.length) {
    return computeOverviewFromMembers(members);
  }
  if (overviewCache) return overviewCache;
  if (Array.isArray(members) && members.length) return computeOverviewFromMembers(members);
  return computeOverviewFromMembers([]);
}

function refreshOverview(){
  const overview = currentOverview();
  if (overview && overview.alliances && typeof orgAlliances !== 'undefined') {
    orgAlliances = overview.alliances;
  }
  if (overview && overview.clubs && typeof orgClubs !== 'undefined') {
    orgClubs = overview.clubs;
    if (typeof paintClubSwitcher === 'function') paintClubSwitcher();
  }
  if (typeof updateClubChrome === 'function') updateClubChrome();
  if (typeof paintAlliancePanel === 'function') paintAlliancePanel();

  const n = overview.totalRegistered;
  document.getElementById('vTotalReg').textContent = n;
  document.getElementById('vTotalScore').textContent = overview.totalScore;
  document.getElementById('vAvgScore').textContent = overview.avgScore;

  const clubLabel = (overview && overview.clubName) || (typeof activeClub === 'function' && activeClub() ? activeClub().name : '王下七武海');
  const tipCards = document.querySelectorAll('.stats-hero .card');
  if (tipCards[0]) tipCards[0].dataset.tip = clubLabel + '登记成员共 ' + n + ' 人';
  if (tipCards[1]) tipCards[1].dataset.tip = '全员非凡评分总和 ' + overview.totalScore;
  if (tipCards[2]) {
    tipCards[2].dataset.tip = overview.avgScoreNum
      ? '按有评分成员计算的平均非凡评分'
      : '尚无有效非凡评分';
    const note = tipCards[2].querySelector('.c-note');
    if (note) note.textContent = overview.avgScoreNum ? ('按有评分成员计算') : '暂无评分数据';
  }
  const note0 = tipCards[0] && tipCards[0].querySelector('.c-note');
  if (note0) note0.textContent = clubLabel + '全员';

  renderSquads(overview);
  renderChart(overview);
  renderEventBanner(overview);
}

let eventCalOffset = 0; // 相对今天的天数：0=今天，1=明天…

function ymdFromOffset(offset){
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + (Number(offset) || 0));
  const p = n => String(n).padStart(2, '0');
  return {
    ymd: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
    week: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
    label: (d.getMonth() + 1) + '月' + d.getDate() + '日'
  };
}

function collectUpcomingEvents(overview){
  const todayInfo = ymdFromOffset(0);
  let events = (overview && overview.activeEvents) || [];
  if (!events.length && typeof attendanceEvents !== 'undefined') {
    events = (attendanceEvents || [])
      .filter(e => (e.date || '') >= todayInfo.ymd)
      .map(e => ({
        id: e.id,
        date: e.date,
        name: e.name,
        note: e.note || '',
        startTime: e.startTime || '',
        endTime: e.endTime || ''
      }));
  }
  return (events || []).slice().sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') ||
    (a.startTime || '99:99').localeCompare(b.startTime || '99:99') ||
    (a.name || '').localeCompare(b.name || '', 'zh')
  );
}

function splitEventDisplayName(name){
  const raw = String(name || '').trim();
  if (raw.endsWith('(战略)')) {
    return { title: raw.slice(0, -4), strategic: true };
  }
  return { title: raw, strategic: false };
}

function eventKindClass(name){
  const n = String(name || '');
  if (n.includes('乱斗')) return 'kind-brawl';
  if (n.includes('猎杀')) return 'kind-hunt';
  if (n.includes('宣令') || n.includes('宣战')) return 'kind-order';
  if (n.includes('猎城')) return 'kind-city';
  if (n.includes('霜陨') || n.includes('领主')) return 'kind-lord';
  if (n.includes('联赛') || n.includes('高原')) return 'kind-league';
  return 'kind-default';
}

function eventMarkChar(title){
  const t = String(title || '').trim();
  return t ? t.charAt(0) : '活';
}

function renderEventBanner(overview){
  const box = document.getElementById('eventBanner');
  const list = document.getElementById('eventBannerList');
  const dateEl = document.getElementById('eventCalDate');
  const weekEl = document.getElementById('eventCalWeek');
  const countEl = document.getElementById('eventCalCount');
  const prevBtn = document.getElementById('eventCalPrev');
  if (!box || !list) return;

  if (eventCalOffset < 0) eventCalOffset = 0;
  const day = ymdFromOffset(eventCalOffset);
  const all = collectUpcomingEvents(overview);
  const dayEvents = all.filter(e => e.date === day.ymd);

  if (dateEl) dateEl.textContent = day.label;
  if (weekEl) {
    weekEl.innerHTML = eventCalOffset === 0
      ? ('星期' + day.week + ' <span class="is-today">· 今天</span>')
      : ('星期' + day.week);
  }
  if (prevBtn) prevBtn.disabled = eventCalOffset <= 0;
  if (countEl) {
    if (dayEvents.length) {
      countEl.hidden = false;
      countEl.textContent = dayEvents.length + ' 场';
    } else {
      countEl.hidden = true;
      countEl.textContent = '';
    }
  }

  box.hidden = false;
  if (!dayEvents.length) {
    list.innerHTML = '<div class="event-cal-empty">这一天暂无活动安排</div>';
  } else {
    list.innerHTML = dayEvents.map(e => {
      const note = (e.note || '').trim();
      const start = (e.startTime || '').trim();
      const end = (e.endTime || '').trim();
      const parsed = splitEventDisplayName(e.name || '');
      const kind = eventKindClass(e.name || '');
      const mark = eventMarkChar(parsed.title);
      const timeHtml = start
        ? ('<span class="eb-start">' + esc(start) + '</span>' +
           (end ? '<span class="eb-end">至 ' + esc(end) + '</span>' : ''))
        : '<span class="eb-pending">待定</span>';
      const metaBits = [];
      if (parsed.strategic) metaBits.push('<span class="eb-tag">战略</span>');
      if (start && end) metaBits.push('<span class="eb-dur">' + esc(start) + ' – ' + esc(end) + '</span>');
      else if (start) metaBits.push('<span class="eb-dur">' + esc(start) + ' 开始</span>');
      else metaBits.push('<span class="eb-dur">时间待定</span>');
      return (
        '<button type="button" class="event-banner-item ' + kind +
          (parsed.strategic ? ' is-strategy' : '') +
          '" data-eid="' + esc(e.id || '') + '">' +
          '<span class="eb-time">' + timeHtml + '</span>' +
          '<span class="eb-card">' +
            '<span class="eb-mark" aria-hidden="true">' + esc(mark) + '</span>' +
            '<span class="eb-card-main">' +
              '<span class="eb-name">' + esc(parsed.title || '未命名') + '</span>' +
              '<span class="eb-meta">' + metaBits.join('') + '</span>' +
              (note ? '<span class="eb-note">' + esc(note) + '</span>' : '') +
            '</span>' +
          '</span>' +
        '</button>'
      );
    }).join('');
  }

  list.querySelectorAll('.event-banner-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = (btn.querySelector('.eb-name')?.textContent || '').trim();
      const canGoDkp = typeof loggedIn !== 'undefined' && loggedIn;
      if (canGoDkp) {
        showPage('dkp');
        toast('活动「' + name + '」');
      } else {
        toast(name || '活动');
      }
    });
  });
}

document.getElementById('eventCalPrev')?.addEventListener('click', () => {
  if (eventCalOffset <= 0) return;
  eventCalOffset -= 1;
  renderEventBanner(typeof currentOverview === 'function' ? currentOverview() : null);
});
document.getElementById('eventCalNext')?.addEventListener('click', () => {
  eventCalOffset += 1;
  renderEventBanner(typeof currentOverview === 'function' ? currentOverview() : null);
});

/* ===================== 战团状态渲染 ===================== */
function renderSquads(overview){
  const data = overview || currentOverview();
  const html = data.readiness.map(grp => `
    <div class="squad-group">
      <div class="g-tag">${grp.group} · 三个30人战团</div>
      ${grp.squads.map(s => `
        <div class="squad-row" data-name="${s.name}" data-mem="${s.mem}" data-pct="${s.pct}">
          <span class="s-name">${s.name}</span>
          <span class="s-track"><span class="s-fill" data-fill="${s.fill}"></span></span>
          <span class="s-mem">${s.mem}</span>
          <span class="s-pct ${s.fill === 0 ? 'zero' : ''}">${s.pct}</span>
        </div>`).join('')}
    </div>`).join('');
  document.getElementById('squadList').innerHTML = html;
  requestAnimationFrame(() => {
    document.querySelectorAll('.s-fill').forEach(el => { el.style.width = el.dataset.fill + '%'; });
  });
}

/* ===================== 途径分布图表（ECharts） ===================== */
let chart = null;
function renderChart(overview){
  const el = document.getElementById('pathChart');
  if (!el || !window.echarts) return;
  const dataSrc = overview || currentOverview();
  if (chart) chart.dispose();
  chart = echarts.init(el);
  const data = dataSrc.pathways.slice().reverse();
  const css = getComputedStyle(document.body);
  if (!data.length) {
    chart.setOption({
      title: {
        text: '暂无成员数据',
        left: 'center', top: 'middle',
        textStyle: { color: css.getPropertyValue('--text-faint').trim(), fontSize: 13, fontWeight: 400, fontFamily: 'Noto Sans SC' }
      },
      xAxis: { show: false }, yAxis: { show: false }, series: []
    });
    return;
  }
  chart.setOption({
    grid: { left: 6, right: 46, top: 6, bottom: 6, containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: {
      type: 'category', data: data.map(d => d.name),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: css.getPropertyValue('--text-dim').trim(), fontSize: 12, fontFamily: 'Noto Sans SC' }
    },
    series: [{
      type: 'bar', data: data.map(d => d.value), barWidth: 9,
      itemStyle: {
        borderRadius: [0, 5, 5, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: css.getPropertyValue('--bar-a').trim() },
          { offset: 1, color: css.getPropertyValue('--bar-b').trim() }
        ])
      },
      label: { show: true, position: 'right', color: css.getPropertyValue('--gold-hi').trim(), fontSize: 11.5, fontFamily: 'Noto Sans SC' }
    }]
  });
  chart.off('click');
  chart.on('click', params => {
    setPathwayFilter(params.name);
    showPage('archive');
    toast('已筛选途径「' + params.name + '」· ' + params.value + ' 人');
  });
}
function refreshChart(){
  if (chart) { chart.resize(); }
}
window.addEventListener('resize', () => { if (chart) chart.resize(); });

/* ===================== 页面路由 ===================== */
const overviewPage = document.getElementById('page-overview');
const placeholderPage = document.getElementById('page-placeholder');
const archivePage = document.getElementById('page-archive');
const dkpPage = document.getElementById('page-dkp');
const settingsPage = document.getElementById('page-settings');
const forumPage = document.getElementById('page-forum');
const squadsPage = document.getElementById('page-squads');
const leaguePage = document.getElementById('page-league');

function showPage(name){
  // 论坛已关闭
  if (name === 'forum') {
    toast('论坛功能已关闭');
    name = 'overview';
  }
  const adminOnly = ['archive', 'dkp', 'league', 'settings'];
  if (!loggedIn && adminOnly.indexOf(name) >= 0) {
    pendingPageAfterLogin = name;
    openLogin();
    toast('该功能需要管理员登录');
    return;
  }
  const nav = document.querySelectorAll('.nav-item');
  nav.forEach(n => n.classList.toggle('active', n.dataset.page === name));
  const crumbB = document.querySelector('#page-overview .crumb b') || document.querySelector('.crumb b');
  const isOverview = name === 'overview';
  const isArchive = name === 'archive';
  const isDkp = name === 'dkp';
  const isSettings = name === 'settings';
  const isForum = false;
  const isSquads = name === 'squads';
  const isLeague = name === 'league';
  overviewPage.classList.toggle('active', isOverview);
  archivePage.classList.toggle('active', isArchive);
  if (dkpPage) dkpPage.classList.toggle('active', isDkp);
  if (settingsPage) settingsPage.classList.toggle('active', isSettings);
  if (forumPage) forumPage.classList.toggle('active', false);
  if (squadsPage) squadsPage.classList.toggle('active', isSquads);
  if (leaguePage) leaguePage.classList.toggle('active', isLeague);
  placeholderPage.classList.toggle('active', !isOverview && !isArchive && !isDkp && !isSettings && !isSquads && !isLeague);
  const titleP = document.querySelector('.tb-title p');
  const clubName = (typeof activeClub === 'function' && activeClub()) ? activeClub().name : '王下七武海';
  if (isOverview) {
    if (crumbB) crumbB.textContent = '总览';
    if (typeof updateClubChrome === 'function') updateClubChrome();
    else if (titleP) titleP.textContent = clubName + '数据总览';
    refreshOverview();
    refreshChart();
    if (typeof paintAlliancePanel === 'function') paintAlliancePanel();
  } else if (isArchive) {
    if (titleP) titleP.textContent = clubName + ' · 成员档案';
    ensureMembersLoaded()
      .then(async () => {
        if (typeof loadMigrateQueue === 'function') await loadMigrateQueue();
        renderMembers();
      })
      .catch(err => toast(err.message || '加载成员失败'));
  } else if (isSquads) {
    if (titleP) titleP.textContent = clubName + ' · 团队编组';
    if (typeof renderSquadsPage === 'function') renderSquadsPage();
  } else if (isLeague) {
    if (titleP) titleP.textContent = '王下七武海 · 联赛分析';
    const go = () => { if (typeof renderLeaguePage === 'function') renderLeaguePage(); };
    if (loggedIn && typeof ensureMembersLoaded === 'function') {
      ensureMembersLoaded().then(go).catch(go);
    } else go();
  } else if (isDkp) {
    if (titleP) titleP.textContent = clubName + ' · DKP管理';
    if (typeof renderDkpPage === 'function') renderDkpPage();
  } else if (isSettings) {
    if (titleP) titleP.textContent = '王下七武海 · 系统设置';
    if (typeof renderSettingsPage === 'function') renderSettingsPage();
  } else {
    const pg = PAGES[name];
    if (titleP) titleP.textContent = '王下七武海 · ' + pg.title;
    document.getElementById('phTitle').textContent = pg.title;
    document.getElementById('phDesc').textContent = pg.desc;
    document.getElementById('phIcon').innerHTML = ICONS[pg.icon] || '';
  }
  closeSidebar();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => showPage(item.dataset.page));
});
document.querySelectorAll('.panel-link[data-goto]').forEach(link => {
  link.addEventListener('click', () => showPage(link.dataset.goto));
});

/* ===================== 全局点击交互 ===================== */
function bindCardClicks(scope){
  scope.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => toast(card.dataset.tip || '当前数据'));
  });
}

document.querySelector('.brand').addEventListener('click', () => showPage('overview'));
document.getElementById('crumbHome')?.addEventListener('click', () => showPage('overview'));
document.getElementById('crumbHome2')?.addEventListener('click', () => showPage('overview'));
document.getElementById('crumbHomeDkp')?.addEventListener('click', () => showPage('overview'));
document.getElementById('crumbHomeSettings')?.addEventListener('click', () => showPage('overview'));
document.getElementById('crumbHomeForum')?.addEventListener('click', () => showPage('overview'));
document.getElementById('crumbHomeSquads')?.addEventListener('click', () => showPage('overview'));
document.getElementById('crumbHomeLeague')?.addEventListener('click', () => showPage('overview'));
document.getElementById('crumbCurrent')?.addEventListener('click', () => {
  const cur = document.querySelector('.nav-item.active')?.dataset.page;
  if (cur && cur !== 'overview') showPage(cur);
});
document.querySelector('.online')?.addEventListener('click', () => toast('数据保存在服务器，工会成员共用同一份名单与考勤'));
document.getElementById('backHome')?.addEventListener('click', () => showPage('overview'));

document.getElementById('squadList')?.addEventListener('click', e => {
  const row = e.target.closest('.squad-row');
  if (!row) return;
  toast('战团「' + row.dataset.name + '」编组 ' + row.dataset.mem + '，占比 ' + row.dataset.pct);
});

/* ===================== 主题切换 ===================== */
const themeSel = document.getElementById('themeSel');
const themeName = document.getElementById('themeName');
const THEME_TXT = { mist: '迷雾金绿', gold: '鎏金暗夜', abyss: '深渊幽蓝' };
themeSel.querySelector('.sel-box').addEventListener('click', e => {
  e.stopPropagation();
  themeSel.classList.toggle('open');
});
document.querySelectorAll('.theme-opt').forEach(opt => {
  opt.addEventListener('click', e => {
    e.stopPropagation();
    const v = opt.dataset.themeVal;
    document.body.dataset.theme = v;
    themeName.textContent = THEME_TXT[v];
    themeSel.querySelectorAll('.theme-opt').forEach(o => o.classList.toggle('on', o === opt));
    themeSel.classList.remove('open');
    refreshOverview();
    toast('界面主题已切换为「' + THEME_TXT[v] + '」');
  });
});
document.addEventListener('click', () => themeSel.classList.remove('open'));

/* ===================== 登录 ===================== */
const loginMask = document.getElementById('loginMask');
const loginBtn = document.getElementById('loginBtn');
let loggedIn = false;
let adminUsername = '';
let pendingPageAfterLogin = null;

function setLoggedIn(user){
  loggedIn = !!user;
  adminUsername = user || '';
  document.getElementById('loginTxt').textContent = loggedIn ? ('管理员 · ' + adminUsername) : '管理员登录';
  if (typeof updateWriteUI === 'function') updateWriteUI();
  if (typeof paintClubSwitcher === 'function') paintClubSwitcher();
  if (typeof renderMembers === 'function') renderMembers();
  if (typeof renderDkpPage === 'function') renderDkpPage();
  if (typeof renderSquadsPage === 'function' && squadsPage?.classList.contains('active')) renderSquadsPage();
  if (typeof renderLeaguePage === 'function' && leaguePage?.classList.contains('active')) renderLeaguePage();
  if (typeof renderSettingsPage === 'function' && settingsPage?.classList.contains('active')) renderSettingsPage();
  if (!loggedIn) {
    const cur = document.querySelector('.nav-item.active')?.dataset.page;
    if (cur && cur !== 'overview' && cur !== 'squads') showPage('overview');
  }
}

function openLogin(){
  if (loggedIn) {
    logoutAdmin();
    return;
  }
  document.body.classList.add('login-open');
  loginMask.classList.add('open');
  setTimeout(() => document.getElementById('accInput').focus(), 60);
}
function closeLogin(){
  loginMask.classList.remove('open');
  document.body.classList.remove('login-open');
  pendingPageAfterLogin = null;
}

async function ensureMembersLoaded(){
  if (!loggedIn) return [];
  if (Array.isArray(members) && members.length) return members;
  members = await apiLoadMembers();
  return members;
}

async function logoutAdmin(){
  await apiLogout();
  members = [];
  overviewCache = null;
  if (typeof migrateQueue !== 'undefined') migrateQueue = [];
  setLoggedIn('');
  toast('已退出登录');
  try {
    overviewCache = await apiLoadOverview();
  } catch (e) { /* ignore */ }
  showPage('overview');
}

loginBtn.addEventListener('click', openLogin);
document.getElementById('loginClose').addEventListener('click', closeLogin);
loginMask.addEventListener('click', e => { if (e.target === loginMask) closeLogin(); });
document.getElementById('loginSubmit').addEventListener('click', async () => {
  const acc = document.getElementById('accInput').value.trim();
  const pwd = document.getElementById('pwdInput').value;
  if (!acc || !pwd) { toast('请输入账号和密码'); return; }
  try {
    const data = await apiLogin(acc, pwd);
    setLoggedIn(data.username);
    document.getElementById('pwdInput').value = '';
    const go = pendingPageAfterLogin;
    pendingPageAfterLogin = null;
    closeLogin();
    toast('登录成功');
    try {
      if (typeof reloadClubScopedData === 'function') {
        await reloadClubScopedData();
      } else {
        members = await apiLoadMembers();
        attendanceEvents = await apiLoadEvents();
        overviewCache = await apiLoadOverview();
        refreshOverview();
      }
      if (typeof paintClubSwitcher === 'function') paintClubSwitcher();
    } catch (e) {
      toast(e.message || '数据加载失败');
    }
    if (go) {
      showPage(go);
    } else {
      const cur = document.querySelector('.nav-item.active')?.dataset.page || 'overview';
      if (cur === 'archive') renderMembers();
      if (cur === 'dkp') renderDkpPage();
      if (cur === 'settings') renderSettingsPage();
    }
  } catch (err) {
    toast(err.message || '账号或密码错误');
  }
});
document.getElementById('pwdInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('loginSubmit').click();
});

/* ===================== 设置页：导出 / 导入 ===================== */
function renderSettingsPage(){
  const canWrite = loggedIn;
  const box = document.getElementById('settingsBody');
  if (!box) return;
  box.innerHTML =
    (typeof renderOrgSettingsBlocks === 'function' ? renderOrgSettingsBlocks(canWrite) : '') +
    '<div class="settings-card">' +
      '<h3>数据备份</h3>' +
      '<p>导出成员与考勤为 JSON，便于备份或迁移到新服务器。</p>' +
      '<div class="settings-actions">' +
        (canWrite
          ? '<button type="button" class="btn-add" id="btnExport">导出 JSON</button>' +
            '<label class="btn-add btn-ghost" id="btnImportLabel">导入 JSON<input type="file" id="btnImport" accept="application/json,.json" hidden></label>'
          : '<span class="settings-hint">导出 / 导入需管理员登录</span>') +
      '</div>' +
    '</div>' +
    '<div class="settings-card">' +
      '<h3>账号说明</h3>' +
      '<p>管理员账号在服务器环境变量或 <code>.env</code> 中配置。访客可看<strong>总览</strong>与<strong>团队编组</strong>（只读），并用顶栏切换俱乐部；成员档案 / DKP / 联赛 / 设置仅管理员可见。论坛已关闭。</p>' +
      '<p class="settings-hint">当前状态：' + (canWrite ? ('已登录 · ' + esc(adminUsername)) : '访客') + '</p>' +
    '</div>';

  if (typeof paintOrgSettingsLists === 'function') paintOrgSettingsLists(canWrite);

  document.getElementById('btnExport')?.addEventListener('click', exportBackup);
  const file = document.getElementById('btnImport');
  if (file) {
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      try {
        const text = await f.text();
        const payload = JSON.parse(text);
        if (!confirm('导入将覆盖服务器上现有成员与考勤，确定继续？')) return;
        const res = await api('/api/import', { method: 'POST', body: JSON.stringify(payload) });
        members = res.members || [];
        attendanceEvents = res.events || [];
        toast('导入成功：成员 ' + members.length + ' · 活动 ' + attendanceEvents.length);
        refreshOverview();
        renderMembers();
        renderDkpPage();
      } catch (err) {
        toast(err.message || '导入失败');
      }
    });
  }
}

async function exportBackup(){
  if (!requireWrite('导出备份')) return;
  try {
    const data = await api('/api/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wangxia-club-backup-' + todayStrSafe() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出备份');
  } catch (err) {
    toast(err.message || '导出失败');
  }
}

function todayStrSafe(){
  const d = new Date();
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

/* ===================== 移动端侧栏 ===================== */
const sidebar = document.getElementById('sidebar');
const maskSide = document.getElementById('maskSide');
function closeSidebar(){ sidebar.classList.remove('open'); maskSide.classList.remove('show'); }
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.burger')) return;
  const b = document.createElement('div');
  b.className = 'burger';
  b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  document.querySelector('.tb-title').before(b);
  b.addEventListener('click', () => { sidebar.classList.add('open'); maskSide.classList.add('show'); });
  maskSide.addEventListener('click', closeSidebar);
});

/* ===================== Toast ===================== */
let toastTimer = null;
function toast(msg, ms){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), Math.max(1200, Number(ms) || 2200));
}

function setSyncStatus(ok, text){
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.innerHTML = '<span class="dot"></span>' + (text || (ok ? '服务器已连接' : '连接失败'));
  el.classList.toggle('err', !ok);
}

/* ===================== 启动：拉取共享数据 ===================== */
async function bootstrap(){
  try {
    if (apiToken) {
      try {
        const me = await apiMe();
        setLoggedIn(me.username);
      } catch (e) {
        setApiToken('');
        setLoggedIn('');
      }
    } else {
      setLoggedIn('');
    }
    const data = await apiLoadAll(loggedIn);
    overviewCache = data.overview;
    members = data.members || [];
    attendanceEvents = data.events || [];
    if (overviewCache && overviewCache.clubs) orgClubs = overviewCache.clubs;
    if (overviewCache && overviewCache.alliances) orgAlliances = overviewCache.alliances;
    if (typeof loadOrgClubs === 'function') await loadOrgClubs();
    if (typeof loadOrgAlliances === 'function') await loadOrgAlliances();
    else if (typeof paintAlliancePanel === 'function') paintAlliancePanel();
    if (typeof paintClubSwitcher === 'function') paintClubSwitcher();
    if (loggedIn && typeof loadMigrateQueue === 'function') await loadMigrateQueue();
    setSyncStatus(true, '服务器已连接 · 共享数据');

    // 若服务器为空，尝试迁移本机旧 localStorage 数据（仅提示一次）
    if (loggedIn && !members.length && !attendanceEvents.length) {
      await maybeMigrateLocal();
    }

    refreshOverview();
    if (typeof updateWriteUI === 'function') updateWriteUI();
  } catch (err) {
    setSyncStatus(false, '无法连接服务器');
    toast(err.message || '请先运行 ./start.sh 启动服务');
    refreshOverview();
  }
}

async function maybeMigrateLocal(){
  let localMembers = [];
  let localEvents = [];
  try { localMembers = JSON.parse(localStorage.getItem('beyonders-archive-members') || '[]'); } catch (e) { localMembers = []; }
  try { localEvents = JSON.parse(localStorage.getItem('beyonders-archive-attendance') || '[]'); } catch (e) { localEvents = []; }
  if (!Array.isArray(localMembers)) localMembers = [];
  if (!Array.isArray(localEvents)) localEvents = [];
  localMembers = localMembers.filter(m => m && m.name && String(m.name).trim() && !String(m.id || '').startsWith('seed-'));
  if (!localMembers.length && !localEvents.length) return;
  if (localStorage.getItem('beyonders-migrate-asked')) return;
  localStorage.setItem('beyonders-migrate-asked', '1');
  if (!confirm('检测到本机有旧版成员/考勤数据。是否导入到共享服务器？（需先登录管理员）')) return;
  pendingPageAfterLogin = 'settings';
  openLogin();
  toast('请先登录管理员，再到系统设置中导入 JSON；或登录后刷新再试自动导入');
  // 登录后若仍为空，管理员可在设置页手动导入；同时把本机数据下载成文件方便导入
  try {
    const blob = new Blob([JSON.stringify({ version: 1, members: localMembers, events: localEvents }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wangxia-local-migrate.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { /* ignore */ }
}

bindCardClicks(document.querySelector('.stats-hero'));
themeSel.querySelectorAll('.theme-opt').forEach(o => o.classList.toggle('on', o.dataset.themeVal === 'mist'));
bootstrap();
