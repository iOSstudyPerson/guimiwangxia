/* ===================== 联赛分析 L1 ===================== */
const LEAGUE_MODE_UI = {
  duel: { label: '俱乐部宣战', sideNames: ['我方', '对方'], clubsPerSide: 1 },
  fours: { label: '四方联赛', sideNames: ['势力一', '势力二', '势力三', '势力四'], clubsPerSide: 1 },
  endhunt: { label: '终末猎杀', sideNames: ['我方联盟', '对方联盟'], clubsPerSide: 2 },
  city: { label: '猎城战', sideNames: ['势力一', '势力二', '势力三', '势力四'], clubsPerSide: 2 },
  plateau: { label: '高原战', sideNames: ['势力一', '势力二', '势力三', '势力四'], clubsPerSide: 2 }
};

let leagueView = 'list';
let leagueMatches = [];
let leagueDetail = null;
let leagueDraft = null;
let leagueSort = { key: 'kda', dir: -1 };
let leagueRules = null;
let leagueOcrReady = null;
let leagueClubMemory = [];

const LEAGUE_RULES_FALLBACK = {
  title: '联赛分析计算规则',
  metrics: [
    { label: 'KDA', formula: '(击杀 + 助攻) / max(死亡, 1)', note: '死亡为 0 时按 1 计算。' },
    { label: '参团率', formula: '(击杀 + 助攻) / max(本俱乐部击杀合计, 1)', note: '仅在本俱乐部内比较。' },
    { label: '战略分', formula: '100 × (0.35×玩家伤占比 + 0.25×承伤占比 + 0.25×治疗占比 + 0.15×对怪占比)', note: '占比相对本俱乐部合计；衡量多维贡献。' },
    { label: '势力合计分', formula: '该势力下各俱乐部总分相加', note: '用于势力对比条。' }
  ]
};

function leagueRulesHtml(){
  const rules = leagueRules || LEAGUE_RULES_FALLBACK;
  const metrics = rules.metrics || [];
  const board = (rules.gameBoard && rules.gameBoard.note) ||
    '结算图常见：昵称 · 击杀/死亡/助攻 · 玩家伤/承伤/治疗 · 对怪；「3.6万」= 36000。';
  return (
    '<details class="league-rules">' +
      '<summary>' + esc(rules.title || '计算规则') + '</summary>' +
      '<ul>' + metrics.map(m =>
        '<li><b>' + esc(m.label) + '</b>：<code>' + esc(m.formula) + '</code>' +
          (m.note ? ('<div class="league-rules-note">' + esc(m.note) + '</div>') : '') +
        '</li>'
      ).join('') + '</ul>' +
      '<p class="league-rules-note">' + esc(board) + '</p>' +
      '<p class="league-rules-note">录入项：击杀 / 助攻 / 死亡 / 玩家伤 / 承伤 / 治疗 / 对怪；俱乐部总分直接填结算分。指标在保存后自动计算。</p>' +
    '</details>'
  );
}

async function ensureLeagueMeta(){
  if (leagueRules && leagueOcrReady != null) return;
  try {
    const data = await api('/api/league/meta');
    leagueRules = data.rules || LEAGUE_RULES_FALLBACK;
    leagueOcrReady = !!data.ocrReady;
  } catch (e) {
    leagueRules = LEAGUE_RULES_FALLBACK;
    leagueOcrReady = false;
  }
}

async function loadLeagueClubMemory(){
  try {
    const data = await api('/api/league/clubs');
    leagueClubMemory = data.clubs || [];
  } catch (e) {
    leagueClubMemory = [];
  }
}

function formatClubScore(n){
  return Number(n || 0).toLocaleString('en-US');
}

function leagueInsightsHtml(insights){
  if (!insights) return '';
  const warnings = insights.warnings || [];
  const conclusions = insights.conclusions || [];
  const comparisons = insights.comparisons || [];
  const level = insights.level || 'ok';
  const levelLab = level === 'rich' ? '数据较全' : (level === 'partial' ? '数据部分齐全' : '数据不足');
  return (
    '<section class="league-insights level-' + esc(level) + '">' +
      '<h3 class="league-sec-h">本场结论 <span class="league-insight-level">' + esc(levelLab) + '</span></h3>' +
      (warnings.length
        ? '<div class="league-insight-warn"><b>需注意</b><ul>' +
            warnings.map(w => '<li>' + esc(w) + '</li>').join('') +
          '</ul></div>'
        : '') +
      (conclusions.length
        ? '<div class="league-insight-ok"><b>结论</b><ul>' +
            conclusions.map(w => '<li>' + esc(w) + '</li>').join('') +
          '</ul></div>'
        : '<p class="league-rules-note">暂无结论，请先完善俱乐部评分与双方个人战绩。</p>') +
      (comparisons.length
        ? '<div class="league-cmp-grid">' + comparisons.map(c => {
            const gap = c.gapPct;
            const gapText = gap == null ? '—' : ((gap > 0 ? '+' : '') + gap + '%');
            const cls = gap == null ? '' : (gap > 5 ? 'up' : (gap < -5 ? 'down' : 'flat'));
            return (
              '<div class="league-cmp-card">' +
                '<div class="k">' + esc(c.label) + '</div>' +
                '<div class="v">本会 ' + formatClubScore(c.home) + '</div>' +
                '<div class="v dim">' + esc(c.foeLabel || '对方') + ' ' + formatClubScore(c.foe) + '</div>' +
                '<div class="gap ' + cls + '">' + gapText + '</div>' +
              '</div>'
            );
          }).join('') + '</div>'
        : '') +
    '</section>'
  );
}

function leagueClubMemoryHtml(){
  if (!leagueClubMemory.length) {
    return '<div class="arch-empty" style="padding:18px">暂无对手俱乐部历史。保存含对方俱乐部的战报后会出现在这里。</div>';
  }
  return (
    '<div class="league-club-memory">' +
      leagueClubMemory.slice(0, 24).map(c =>
        '<div class="league-club-mem-card">' +
          '<div class="n">' + esc(c.name) + '</div>' +
          '<div class="m">交手 ' + (c.meetCount || 0) + ' 次 · 最近 ' + esc(c.lastDate || '—') + '</div>' +
          '<div class="s">最近评分 <b>' + formatClubScore(c.lastScore) + '</b>' +
            (c.avgScore ? (' · 均 ' + formatClubScore(Math.round(c.avgScore))) : '') +
          '</div>' +
        '</div>'
      ).join('') +
    '</div>'
  );
}

function fileToLeagueOcrImage(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1800;
        let w = img.width;
        let h = img.height;
        if (w > maxW) {
          h = Math.round(h * (maxW / w));
          w = maxW;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({
          dataUrl,
          base64: dataUrl.split(',')[1] || ''
        });
      };
      img.onerror = () => reject(new Error('图片无法解码'));
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

let _tesseractLoading = null;
function loadTesseractLib(){
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (_tesseractLoading) return _tesseractLoading;
  _tesseractLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.async = true;
    s.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error('本地 OCR 库加载失败'));
    };
    s.onerror = () => reject(new Error('本地 OCR 库加载失败（需可访问 CDN）'));
    document.head.appendChild(s);
  });
  return _tesseractLoading;
}

async function runLocalBrowserOcr(dataUrl){
  toast('浏览器本地 OCR 处理中…（首次需下载中文模型，可能较慢）', 8000);
  const Tesseract = await loadTesseractLib();
  const worker = await Tesseract.createWorker('chi_sim', 1, {
    logger: m => {
      if (!m || m.status !== 'recognizing text') return;
      const pct = Math.round((m.progress || 0) * 100);
      if (pct === 0 || pct === 100 || pct % 20 === 0) {
        toast('浏览器本地 OCR 处理中… ' + pct + '%', 4000);
      }
    }
  });
  try {
    const result = await worker.recognize(dataUrl);
    return (result && result.data && result.data.text) || '';
  } finally {
    try { await worker.terminate(); } catch (e) { /* ignore */ }
  }
}

function applyOcrPlayersToClub(club, imported, engineLabel){
  if (!imported.length) {
    toast('未识别到选手行，请换更清晰的结算图或改用粘贴文本', 3500);
    return false;
  }
  const hasStats = (club.players || []).some(p =>
    p.name || p.kills || p.assists || p.deaths || p.dmgPlayer || p.dmgTaken || p.healing || p.dmgMonster
  );
  if (hasStats && !confirm('识别到 ' + imported.length + ' 人。将按昵称合并覆盖战绩数字，继续？')) {
    return false;
  }
  mergeOcrPlayersIntoClub(club, imported);
  toast('已导入 ' + imported.length + ' 人（' + (engineLabel || 'OCR') + '）· 请核对', 3500);
  return true;
}

function mergeOcrPlayersIntoClub(club, imported){
  const map = {};
  (club.players || []).forEach(p => {
    const key = (p.name || '').trim();
    if (key) map[key] = Object.assign({}, p);
  });
  imported.forEach(p => {
    const key = (p.name || '').trim();
    if (!key) return;
    const prev = map[key];
    const next = {
      id: (prev && prev.id) || '',
      memberId: p.memberId || (prev && prev.memberId) || '',
      name: key,
      pathway: p.pathway || (prev && prev.pathway) || '',
      kills: Number(p.kills || 0),
      assists: Number(p.assists || 0),
      deaths: Number(p.deaths || 0),
      dmgPlayer: Number(p.dmgPlayer || 0),
      dmgTaken: Number(p.dmgTaken || 0),
      healing: Number(p.healing || 0),
      dmgMonster: Number(p.dmgMonster || 0)
    };
    map[key] = prev
      ? Object.assign({}, prev, {
          memberId: next.memberId || prev.memberId,
          pathway: next.pathway || prev.pathway,
          kills: next.kills, assists: next.assists, deaths: next.deaths,
          dmgPlayer: next.dmgPlayer, dmgTaken: next.dmgTaken,
          healing: next.healing, dmgMonster: next.dmgMonster
        })
      : next;
  });
  club.players = Object.values(map);
  club._open = true;
}

function emptyClub(name, isHome){
  return { id: '', name: name || '', score: 0, isHome: !!isHome, players: [] };
}

function emptyPlayer(name, memberId, pathway){
  return {
    id: '', memberId: memberId ? String(memberId) : '', name: name || '',
    pathway: pathway || '',
    kills: 0, assists: 0, deaths: 0,
    dmgPlayer: 0, dmgTaken: 0, healing: 0, dmgMonster: 0
  };
}

function lookupMemberPathway(name, memberId){
  const list = typeof members !== 'undefined' ? members : [];
  let hit = null;
  if (memberId) hit = list.find(m => String(m.id) === String(memberId));
  if (!hit && name) hit = list.find(m => m.name === name);
  return hit ? (hit.pathway || '') : '';
}

function resolvePlayerPathway(p){
  return (p && p.pathway) || lookupMemberPathway(p && p.name, p && p.memberId) || '';
}

function blankLeagueDraft(mode){
  const meta = LEAGUE_MODE_UI[mode] || LEAGUE_MODE_UI.duel;
  return {
    id: '',
    date: (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10)),
    mode,
    title: '',
    result: '',
    note: '',
    eventId: '',
    sides: meta.sideNames.map((sn, si) => ({
      id: '',
      name: sn,
      clubs: Array.from({ length: meta.clubsPerSide }, (_, ci) =>
        emptyClub(si === 0 && ci === 0 ? '王下七武海' : '', si === 0 && ci === 0)
      )
    }))
  };
}

function renderLeaguePage(){
  const root = document.getElementById('leagueRoot');
  if (!root) return;
  ensureLeagueMeta().finally(() => {
    loadLeagueClubMemory().finally(() => {
      if (leagueView === 'detail' && leagueDetail) {
        paintLeagueDetail(root);
        return;
      }
      if (leagueView === 'edit' && leagueDraft) {
        paintLeagueEditor(root);
        return;
      }
      leagueView = 'list';
      root.innerHTML = '<div class="arch-empty">加载战报…</div>';
      api('/api/league/matches')
        .then(data => {
          leagueMatches = data.matches || [];
          paintLeagueList(root);
        })
        .catch(err => {
          root.innerHTML = '<div class="arch-empty">' + esc(err.message || '加载失败') + '</div>';
        });
    });
  });
}

function paintLeagueList(root){
  const canWrite = typeof loggedIn !== 'undefined' && loggedIn;
  root.innerHTML =
    '<div class="arch-head">' +
      '<div><h2>联赛分析</h2><div class="sub">赛后战报与敌我差距结论；俱乐部评分会记入简史。可关联 DKP。</div></div>' +
      '<div class="arch-mini">' +
        '<div class="mini-chip">战报 <b>' + leagueMatches.length + '</b></div>' +
        (canWrite ? '<div class="btn-add" id="leagueAddBtn"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>新建战报</div>' : '') +
      '</div>' +
    '</div>' +
    leagueRulesHtml() +
    (leagueMatches.length
      ? '<div class="league-list">' + leagueMatches.map(m => {
          const vs = (m.sideNames || []).map((n, i) => {
            const sc = (m.sideScores || [])[i];
            return esc(n) + (sc != null ? (' <b>' + Number(sc).toLocaleString('en-US') + '</b>') : '');
          }).join('<span class="league-vs">vs</span>');
          return (
            '<button type="button" class="league-card" data-mid="' + esc(m.id) + '">' +
              '<div class="league-card-top">' +
                '<span class="league-mode">' + esc(m.modeLabel || m.mode) + '</span>' +
                '<span class="league-date">' + esc(m.date) + '</span>' +
              '</div>' +
              '<div class="league-card-title">' + esc(m.title || m.modeLabel || '战报') + '</div>' +
              '<div class="league-card-vs">' + vs + '</div>' +
              '<div class="league-card-meta">' +
                (m.result ? ('结果 ' + esc(m.result) + ' · ') : '') +
                (m.playerCount || 0) + ' 人数据' +
                (m.eventId ? ' · 已关联 DKP' : '') +
              '</div>' +
            '</button>'
          );
        }).join('') + '</div>'
      : '<div class="arch-empty">暂无战报' + (canWrite ? '，点击上方新建' : '') + '</div>') +
    '<h3 class="league-sec-h" style="margin-top:18px">俱乐部简史</h3>' +
    '<p class="league-rules-note">只记录交手过的对手工会（不含本帮），方便下次对照评分。</p>' +
    leagueClubMemoryHtml();

  document.getElementById('leagueAddBtn')?.addEventListener('click', () => {
    if (!requireWrite('新建战报')) return;
    leagueDraft = blankLeagueDraft('duel');
    leagueView = 'edit';
    paintLeagueEditor(root);
  });
  root.querySelectorAll('.league-card[data-mid]').forEach(btn => {
    btn.addEventListener('click', () => openLeagueDetail(btn.dataset.mid));
  });
}

async function openLeagueDetail(id){
  const root = document.getElementById('leagueRoot');
  root.innerHTML = '<div class="arch-empty">加载详情…</div>';
  try {
    const data = await api('/api/league/matches/' + encodeURIComponent(id));
    leagueDetail = data.match;
    leagueView = 'detail';
    paintLeagueDetail(root);
  } catch (err) {
    toast(err.message || '加载失败');
    leagueView = 'list';
    renderLeaguePage();
  }
}

function allPlayersFlat(match){
  const rows = [];
  (match.sides || []).forEach(s => {
    (s.clubs || []).forEach(c => {
      (c.players || []).forEach(p => {
        rows.push({
          ...p,
          sideName: s.name,
          clubName: c.name,
          isHome: c.isHome
        });
      });
    });
  });
  return rows;
}

function paintLeagueDetail(root){
  const m = leagueDetail;
  const canWrite = typeof loggedIn !== 'undefined' && loggedIn;
  const players = allPlayersFlat(m);
  const sortKey = leagueSort.key;
  const dir = leagueSort.dir;
  const sorted = players.slice().sort((a, b) => {
    const av = Number(a[sortKey] != null ? a[sortKey] : 0);
    const bv = Number(b[sortKey] != null ? b[sortKey] : 0);
    if (av === bv) return (a.name || '').localeCompare(b.name || '', 'zh');
    return (av - bv) * dir;
  });

  const scoreBars = (m.sides || []).map(s => {
    const max = Math.max(1, ...((m.sides || []).map(x => x.totalScore || 0)));
    const pct = Math.round(((s.totalScore || 0) / max) * 100);
    return (
      '<div class="league-score-row">' +
        '<span class="n">' + esc(s.name) + '</span>' +
        '<span class="track"><span class="fill" style="width:' + pct + '%"></span></span>' +
        '<span class="v">' + Number(s.totalScore || 0).toLocaleString('en-US') + '</span>' +
      '</div>'
    );
  }).join('');

  root.innerHTML =
    '<div class="forum-detail-bar">' +
      '<div class="back-btn" id="leagueBack">← 返回列表</div>' +
      '<div class="forum-detail-actions">' +
        (canWrite ? '<span class="op" id="leagueEdit">编辑</span><span class="op del" id="leagueDel">删除</span>' : '') +
      '</div>' +
    '</div>' +
    '<article class="forum-detail league-detail">' +
      '<div class="league-mode">' + esc(m.modeLabel || m.mode) + '</div>' +
      '<h2>' + esc(m.title || m.modeLabel || '战报') + '</h2>' +
      '<div class="forum-card-meta">' + esc(m.date) +
        (m.result ? (' · 结果 ' + esc(m.result)) : '') +
        (m.eventId ? ' · 已关联 DKP' : '') +
      '</div>' +
      (m.note ? ('<p class="league-note">' + esc(m.note) + '</p>') : '') +
      leagueRulesHtml() +
      leagueInsightsHtml(m.insights) +
      '<h3 class="league-sec-h">势力评分</h3>' +
      '<div class="league-score-box">' + scoreBars + '</div>' +
      '<div class="league-clubs-sum">' +
        (m.sides || []).map(s =>
          '<div class="league-side-block">' +
            '<div class="league-side-h">' + esc(s.name) + ' · 评分合计 ' + formatClubScore(s.totalScore) + '</div>' +
            (s.clubs || []).map(c =>
              '<div class="league-club-line">' +
                (c.isHome ? '<span class="home-tag">本会</span>' : '') +
                esc(c.name) + ' · 俱乐部评分 <b>' + formatClubScore(c.score) + '</b>' +
                ' · ' + (c.players || []).length + ' 人' +
              '</div>'
            ).join('') +
          '</div>'
        ).join('') +
      '</div>' +
      '<h3 class="league-sec-h">个人数据</h3>' +
      '<div class="league-sort-bar">' +
        [['kills','击杀'],['assists','助攻'],['deaths','死亡'],['kda','KDA'],['dmgPlayer','玩家伤'],['dmgTaken','承伤'],['healing','治疗'],['dmgMonster','对怪'],['strategyScore','战略分']]
          .map(([k, lab]) =>
            '<button type="button" class="squad-pick-chip' + (sortKey === k ? ' on' : '') + '" data-sort="' + k + '">' + lab + '</button>'
          ).join('') +
      '</div>' +
      (sorted.length
        ? '<div class="arch-table-wrap"><table class="arch-table league-table"><thead><tr>' +
            '<th>玩家</th><th>职业</th><th>势力/俱乐部</th><th>击杀</th><th>助攻</th><th>死亡</th><th>KDA</th><th>参团</th>' +
            '<th>玩家伤</th><th>承伤</th><th>治疗</th><th>对怪</th><th>战略分</th>' +
          '</tr></thead><tbody>' +
          sorted.map(p =>
            '<tr>' +
              '<td class="t-name">' + esc(p.name) + (p.isHome ? ' <span class="home-tag">本</span>' : '') + '</td>' +
              '<td class="t-path">' + esc(resolvePlayerPathway(p) || '—') + '</td>' +
              '<td>' + esc(p.sideName) + ' / ' + esc(p.clubName) + '</td>' +
              '<td>' + p.kills + '</td><td>' + p.assists + '</td><td>' + p.deaths + '</td>' +
              '<td>' + p.kda + '</td><td>' + (p.participatePct || '—') + '</td>' +
              '<td>' + Number(p.dmgPlayer || 0).toLocaleString('en-US') + '</td>' +
              '<td>' + Number(p.dmgTaken || 0).toLocaleString('en-US') + '</td>' +
              '<td>' + Number(p.healing || 0).toLocaleString('en-US') + '</td>' +
              '<td>' + Number(p.dmgMonster || 0).toLocaleString('en-US') + '</td>' +
              '<td>' + (p.strategyScore != null ? p.strategyScore : '—') + '</td>' +
            '</tr>'
          ).join('') +
          '</tbody></table></div>'
        : '<div class="arch-empty" style="padding:24px">本场尚未录入个人数据</div>') +
    '</article>';

  document.getElementById('leagueBack')?.addEventListener('click', () => {
    leagueView = 'list';
    leagueDetail = null;
    renderLeaguePage();
  });
  document.getElementById('leagueEdit')?.addEventListener('click', () => {
    leagueDraft = JSON.parse(JSON.stringify(m));
    // normalize field names for editor
    leagueDraft.sides = (m.sides || []).map(s => ({
      id: s.id,
      name: s.name,
      clubs: (s.clubs || []).map(c => ({
        id: c.id,
        name: c.name,
        score: c.score,
        isHome: c.isHome,
        players: (c.players || []).map(p => ({
          id: p.id,
          memberId: p.memberId || '',
          name: p.name,
          pathway: resolvePlayerPathway(p),
          kills: p.kills,
          assists: p.assists,
          deaths: p.deaths,
          dmgPlayer: p.dmgPlayer,
          dmgTaken: p.dmgTaken,
          healing: p.healing,
          dmgMonster: p.dmgMonster
        }))
      }))
    }));
    leagueView = 'edit';
    paintLeagueEditor(root);
  });
  document.getElementById('leagueDel')?.addEventListener('click', async () => {
    if (!confirm('确认删除该战报？')) return;
    try {
      await api('/api/league/matches/' + encodeURIComponent(m.id), { method: 'DELETE' });
      toast('已删除');
      leagueView = 'list';
      leagueDetail = null;
      renderLeaguePage();
    } catch (err) { toast(err.message || '删除失败'); }
  });
  root.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.sort;
      if (leagueSort.key === k) leagueSort.dir *= -1;
      else { leagueSort.key = k; leagueSort.dir = -1; }
      paintLeagueDetail(root);
    });
  });
}

function paintLeagueEditor(root){
  const d = leagueDraft;
  const canWrite = typeof loggedIn !== 'undefined' && loggedIn;
  if (!canWrite) {
    toast('需要管理员登录');
    leagueView = 'list';
    renderLeaguePage();
    return;
  }
  const events = (typeof attendanceEvents !== 'undefined' ? attendanceEvents : [])
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  root.innerHTML =
    '<div class="forum-detail-bar">' +
      '<div class="back-btn" id="leagueEditBack">← 取消</div>' +
      '<div class="btn primary" id="leagueSave" style="margin:0;padding:8px 18px">保存战报</div>' +
    '</div>' +
    '<div class="league-editor">' +
      '<div class="member-grid">' +
        '<div class="field"><label>日期 *</label><input type="date" id="lgDate" value="' + esc(d.date || '') + '"></div>' +
        '<div class="field"><label>模式 *</label><select id="lgMode">' +
          Object.keys(LEAGUE_MODE_UI).map(k =>
            '<option value="' + k + '"' + (d.mode === k ? ' selected' : '') + '>' + LEAGUE_MODE_UI[k].label + '</option>'
          ).join('') +
        '</select></div>' +
        '<div class="field full"><label>标题</label><input id="lgTitle" maxlength="80" value="' + esc(d.title || '') + '" placeholder="例如：周三宣战复盘"></div>' +
        '<div class="field"><label>结果</label><input id="lgResult" maxlength="40" value="' + esc(d.result || '') + '" placeholder="胜 / 负 / 第2名…"></div>' +
        '<div class="field"><label>关联 DKP 活动</label><select id="lgEvent">' +
          '<option value="">（不关联）</option>' +
          events.map(e =>
            '<option value="' + esc(e.id) + '"' + (String(d.eventId || '') === String(e.id) ? ' selected' : '') + '>' +
              esc(e.date + ' · ' + e.name) +
            '</option>'
          ).join('') +
        '</select></div>' +
        '<div class="field full"><label>备注</label><input id="lgNote" maxlength="500" value="' + esc(d.note || '') + '"></div>' +
      '</div>' +
      '<p class="league-editor-tip">对照游戏结算：击杀/死亡/助攻 · 玩家伤/承伤/治疗（如 3.6万/2.7万/6506）· 对怪。OCR 会把「万」换成整数并映射到表单列；导入后请核对。本会还可从 DKP 导入出席。</p>' +
      leagueRulesHtml() +
      '<div id="lgSides"></div>' +
    '</div>';

  const pathOpts = (typeof PATHWAYS !== 'undefined' ? PATHWAYS : []);

  const playerHead =
    '<div class="league-player-head" aria-hidden="true">' +
      '<span>昵称</span><span>职业</span><span>击杀</span><span>助攻</span><span>死亡</span>' +
      '<span>玩家伤</span><span>承伤</span><span>治疗</span><span>对怪</span><span></span>' +
    '</div>';

  const paintSides = () => {
    const box = document.getElementById('lgSides');
    box.innerHTML = (d.sides || []).map((s, si) =>
      '<div class="league-edit-side" data-si="' + si + '">' +
        '<div class="league-edit-side-h">' +
          '<input class="lg-side-name" data-si="' + si + '" value="' + esc(s.name) + '" placeholder="势力名">' +
          '<button type="button" class="roll-tool" data-add-club="' + si + '">+ 俱乐部</button>' +
        '</div>' +
        (s.clubs || []).map((c, ci) => {
          const n = (c.players || []).length;
          if (c._open == null) c._open = n <= 8;
          const filter = c._pathFilter || '';
          const visibleCount = filter
            ? (c.players || []).filter(p => resolvePlayerPathway(p) === filter).length
            : n;
          return (
          '<div class="league-edit-club' + (c._open ? ' is-open' : '') + '" data-si="' + si + '" data-ci="' + ci + '">' +
            '<div class="league-edit-club-h">' +
              '<button type="button" class="league-club-fold" data-toggle-club="' + si + '-' + ci + '" title="展开/收起名单">' +
                '<span class="fold-caret">' + (c._open ? '▾' : '▸') + '</span>' +
                '<span class="fold-label">参赛 ' + n + ' 人' + (filter ? ' · 筛 ' + visibleCount : '') + '</span>' +
              '</button>' +
              '<input list="leagueClubList" class="lg-club-name" data-si="' + si + '" data-ci="' + ci + '" value="' + esc(c.name) + '" placeholder="俱乐部名">' +
              '<label class="lg-score-lab" title="游戏结算里的俱乐部评分">' +
                '<span>俱乐部评分</span>' +
                '<input class="lg-club-score" type="number" min="0" data-si="' + si + '" data-ci="' + ci + '" value="' + (c.score || 0) + '" placeholder="如 7050273">' +
              '</label>' +
              '<label class="lg-home"><input type="checkbox" class="lg-club-home" data-si="' + si + '" data-ci="' + ci + '"' + (c.isHome ? ' checked' : '') + '>本会</label>' +
              (c.isHome
                ? '<button type="button" class="roll-tool" data-import-dkp="' + si + '-' + ci + '">从 DKP 导入出席</button>'
                : '') +
              '<button type="button" class="roll-tool" data-ocr-img="' + si + '-' + ci + '">截图 OCR</button>' +
              '<button type="button" class="roll-tool" data-ocr-text="' + si + '-' + ci + '">粘贴文本</button>' +
              '<button type="button" class="op del" data-del-club="' + si + '-' + ci + '">删俱乐部</button>' +
            '</div>' +
            '<div class="league-club-body">' +
              (n
                ? '<div class="league-path-filter">' +
                    '<span>职业筛选</span>' +
                    '<select class="lg-path-filter" data-si="' + si + '" data-ci="' + ci + '">' +
                      '<option value="">全部职业</option>' +
                      pathOpts.map(p =>
                        '<option value="' + esc(p) + '"' + (filter === p ? ' selected' : '') + '>' + esc(p) + '</option>'
                      ).join('') +
                    '</select>' +
                  '</div>'
                : '') +
              '<div class="league-players">' +
                (n ? playerHead : '') +
                (c.players || []).map((p, pi) => renderPlayerRow(si, ci, pi, p, filter)).join('') +
              '</div>' +
              '<button type="button" class="roll-tool" data-add-player="' + si + '-' + ci + '">+ 添加选手</button>' +
            '</div>' +
          '</div>'
          );
        }).join('') +
      '</div>'
    ).join('');
    bindLeagueEditorEvents(box);
  };

  const renderPlayerRow = (si, ci, pi, p, filter) => {
    const path = resolvePlayerPathway(p);
    const hidden = filter && path !== filter;
    return (
      '<div class="league-player-row' + (hidden ? ' is-filtered' : '') + '" data-si="' + si + '" data-ci="' + ci + '" data-pi="' + pi + '" data-pathway="' + esc(path) + '">' +
        '<input list="leagueMemberList" class="lg-p-name" placeholder="昵称" value="' + esc(p.name || '') + '">' +
        '<span class="lg-p-path" title="职业">' + esc(path || '—') + '</span>' +
        '<input type="number" min="0" class="lg-p-k" title="击杀" placeholder="击杀" value="' + (p.kills || 0) + '">' +
        '<input type="number" min="0" class="lg-p-a" title="助攻" placeholder="助攻" value="' + (p.assists || 0) + '">' +
        '<input type="number" min="0" class="lg-p-d" title="死亡" placeholder="死亡" value="' + (p.deaths || 0) + '">' +
        '<input type="number" min="0" class="lg-p-dp" title="对玩家伤害" placeholder="玩家伤" value="' + (p.dmgPlayer || 0) + '">' +
        '<input type="number" min="0" class="lg-p-dt" title="承受伤害" placeholder="承伤" value="' + (p.dmgTaken || 0) + '">' +
        '<input type="number" min="0" class="lg-p-h" title="治疗量" placeholder="治疗" value="' + (p.healing || 0) + '">' +
        '<input type="number" min="0" class="lg-p-dm" title="对怪物伤害" placeholder="对怪" value="' + (p.dmgMonster || 0) + '">' +
        '<button type="button" class="op del" data-del-player="' + si + '-' + ci + '-' + pi + '">×</button>' +
      '</div>'
    );
  };

  // inject datalist once
  if (!document.getElementById('leagueMemberList')) {
    const dl = document.createElement('datalist');
    dl.id = 'leagueMemberList';
    document.body.appendChild(dl);
  }
  const dl = document.getElementById('leagueMemberList');
  const names = (typeof members !== 'undefined' ? members : [])
    .filter(m => m && m.name)
    .map(m => m.name)
    .sort((a, b) => a.localeCompare(b, 'zh'));
  dl.innerHTML = names.map(n => '<option value="' + esc(n) + '"></option>').join('');

  if (!document.getElementById('leagueClubList')) {
    const cdl = document.createElement('datalist');
    cdl.id = 'leagueClubList';
    document.body.appendChild(cdl);
  }
  document.getElementById('leagueClubList').innerHTML = (leagueClubMemory || [])
    .map(c => '<option value="' + esc(c.name) + '"></option>')
    .join('');

  function readEditorIntoDraft(){
    d.date = document.getElementById('lgDate').value;
    d.mode = document.getElementById('lgMode').value;
    d.title = document.getElementById('lgTitle').value.trim();
    d.result = document.getElementById('lgResult').value.trim();
    d.note = document.getElementById('lgNote').value.trim();
    d.eventId = document.getElementById('lgEvent').value || '';
    root.querySelectorAll('.lg-side-name').forEach(inp => {
      const si = Number(inp.dataset.si);
      if (d.sides[si]) d.sides[si].name = inp.value.trim();
    });
    root.querySelectorAll('.league-edit-club').forEach(clubEl => {
      const si = Number(clubEl.dataset.si);
      const ci = Number(clubEl.dataset.ci);
      const club = d.sides[si] && d.sides[si].clubs[ci];
      if (!club) return;
      const keepOpen = club._open;
      const keepFilter = club._pathFilter;
      club.name = clubEl.querySelector('.lg-club-name')?.value.trim() || '';
      club.score = Number(clubEl.querySelector('.lg-club-score')?.value || 0);
      club.isHome = !!clubEl.querySelector('.lg-club-home')?.checked;
      club.players = [];
      clubEl.querySelectorAll('.league-player-row').forEach(row => {
        const name = row.querySelector('.lg-p-name')?.value.trim() || '';
        if (!name) return;
        let memberId = '';
        let pathway = '';
        if (typeof members !== 'undefined') {
          const hit = members.find(m => m.name === name);
          if (hit) {
            memberId = hit.id;
            pathway = hit.pathway || '';
          }
        }
        if (!pathway) pathway = row.dataset.pathway || '';
        club.players.push({
          id: '',
          memberId,
          name,
          pathway,
          kills: Number(row.querySelector('.lg-p-k')?.value || 0),
          assists: Number(row.querySelector('.lg-p-a')?.value || 0),
          deaths: Number(row.querySelector('.lg-p-d')?.value || 0),
          dmgPlayer: Number(row.querySelector('.lg-p-dp')?.value || 0),
          dmgTaken: Number(row.querySelector('.lg-p-dt')?.value || 0),
          healing: Number(row.querySelector('.lg-p-h')?.value || 0),
          dmgMonster: Number(row.querySelector('.lg-p-dm')?.value || 0)
        });
      });
      if (keepOpen != null) club._open = keepOpen;
      if (keepFilter != null) club._pathFilter = keepFilter;
    });
  }

  function bindLeagueEditorEvents(box){
    box.querySelectorAll('[data-add-club]').forEach(btn => {
      btn.addEventListener('click', () => {
        readEditorIntoDraft();
        const si = Number(btn.dataset.addClub);
        d.sides[si].clubs.push(emptyClub('', false));
        paintSides();
      });
    });
    box.querySelectorAll('[data-del-club]').forEach(btn => {
      btn.addEventListener('click', () => {
        readEditorIntoDraft();
        const [si, ci] = btn.dataset.delClub.split('-').map(Number);
        if ((d.sides[si].clubs || []).length <= 1) { toast('每方至少保留 1 个俱乐部'); return; }
        d.sides[si].clubs.splice(ci, 1);
        paintSides();
      });
    });
    box.querySelectorAll('[data-add-player]').forEach(btn => {
      btn.addEventListener('click', () => {
        readEditorIntoDraft();
        const [si, ci] = btn.dataset.addPlayer.split('-').map(Number);
        d.sides[si].clubs[ci].players.push(emptyPlayer());
        d.sides[si].clubs[ci]._open = true;
        paintSides();
      });
    });
    box.querySelectorAll('[data-del-player]').forEach(btn => {
      btn.addEventListener('click', () => {
        readEditorIntoDraft();
        const [si, ci, pi] = btn.dataset.delPlayer.split('-').map(Number);
        d.sides[si].clubs[ci].players.splice(pi, 1);
        paintSides();
      });
    });
    box.querySelectorAll('[data-import-dkp]').forEach(btn => {
      btn.addEventListener('click', () => {
        readEditorIntoDraft();
        const [si, ci] = btn.dataset.importDkp.split('-').map(Number);
        const club = d.sides[si] && d.sides[si].clubs[ci];
        if (!club) return;
        const eid = d.eventId || document.getElementById('lgEvent')?.value || '';
        if (!eid) {
          toast('请先在上方选择「关联 DKP 活动」');
          return;
        }
        const ev = (typeof attendanceEvents !== 'undefined' ? attendanceEvents : [])
          .find(e => String(e.id) === String(eid));
        if (!ev) { toast('找不到该 DKP 活动'); return; }
        const presentIds = Object.keys(ev.records || {}).filter(id => ev.records[id] === 'present');
        if (!presentIds.length) {
          toast('该活动还没有出勤记录');
          return;
        }
        const byId = {};
        (typeof members !== 'undefined' ? members : []).forEach(m => { byId[String(m.id)] = m; });
        const imported = presentIds.map(id => {
          const m = byId[String(id)];
          return emptyPlayer(m ? m.name : '', id, m ? m.pathway : '');
        }).filter(p => p.name);
        if (!imported.length) {
          toast('出勤名单对不上成员表');
          return;
        }
        const existing = club.players || [];
        const hasStats = existing.some(p =>
          p.name || p.kills || p.assists || p.deaths || p.dmgPlayer || p.dmgTaken || p.healing || p.dmgMonster
        );
        if (hasStats) {
          if (!confirm('将合并导入：已有同名保留战绩，缺席出勤的人补进名单（战绩为 0）。继续？')) return;
          const map = {};
          existing.forEach(p => {
            const key = (p.name || '').trim();
            if (key) map[key] = p;
          });
          imported.forEach(p => {
            if (!map[p.name]) map[p.name] = p;
            else if (!map[p.name].memberId && p.memberId) map[p.name].memberId = p.memberId;
          });
          club.players = Object.values(map);
        } else {
          club.players = imported;
        }
        club.isHome = true;
        club._open = true;
        toast('已导入 ' + imported.length + ' 名出勤 · 请补战绩数字');
        paintSides();
      });
    });

    const runOcrImport = async (si, ci, payload, opts) => {
      const club = d.sides[si] && d.sides[si].clubs[ci];
      if (!club) return;
      const options = opts || {};
      try {
        const res = await api('/api/league/ocr', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!applyOcrPlayersToClub(club, res.players || [], res.engine || 'OCR')) return;
        paintSides();
      } catch (err) {
        const canFallback = options.allowLocalFallback && options.dataUrl && (err.data?.fallback || err.status === 503 || err.status >= 400);
        if (!canFallback) {
          toast(err.message || '识别失败', 3500);
          return;
        }
        const reason = err.data?.quota
          ? '腾讯云免费额度可能已用完'
          : (err.message || '腾讯云 OCR 失败');
        toast(reason + '，正在切换浏览器本地 OCR…', 4500);
        try {
          const text = await runLocalBrowserOcr(options.dataUrl);
          if (!String(text || '').trim()) {
            toast('本地 OCR 未识别到文字，请换图或粘贴文本', 3500);
            return;
          }
          toast('本地识别完成，正在解析战绩…', 3000);
          const res = await api('/api/league/ocr', {
            method: 'POST',
            body: JSON.stringify({ text: String(text) })
          });
          if (!applyOcrPlayersToClub(club, res.players || [], '本地 OCR')) return;
          paintSides();
        } catch (localErr) {
          toast((localErr && localErr.message) || '本地 OCR 失败', 4000);
        }
      }
    };

    box.querySelectorAll('[data-ocr-img]').forEach(btn => {
      btn.addEventListener('click', () => {
        readEditorIntoDraft();
        const [si, ci] = btn.dataset.ocrImg.split('-').map(Number);
        let input = document.getElementById('leagueOcrFile');
        if (!input) {
          input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/jpeg,image/png,image/webp,image/bmp';
          input.id = 'leagueOcrFile';
          input.hidden = true;
          document.body.appendChild(input);
        }
        input.onchange = async () => {
          const file = input.files && input.files[0];
          input.value = '';
          if (!file) return;
          try {
            const img = await fileToLeagueOcrImage(file);
            if (leagueOcrReady === false) {
              toast('未配置腾讯云 OCR，直接使用浏览器本地 OCR…', 4000);
              const text = await runLocalBrowserOcr(img.dataUrl);
              if (!String(text || '').trim()) {
                toast('本地 OCR 未识别到文字，请换图或粘贴文本', 3500);
                return;
              }
              toast('本地识别完成，正在解析战绩…', 3000);
              await runOcrImport(si, ci, { text: String(text) });
              return;
            }
            toast('腾讯云 OCR 处理中…', 6000);
            await runOcrImport(si, ci, { imageBase64: img.base64 }, {
              allowLocalFallback: true,
              dataUrl: img.dataUrl
            });
          } catch (err) {
            toast(err.message || '读图失败', 3500);
          }
        };
        input.click();
      });
    });

    box.querySelectorAll('[data-ocr-text]').forEach(btn => {
      btn.addEventListener('click', async () => {
        readEditorIntoDraft();
        const [si, ci] = btn.dataset.ocrText.split('-').map(Number);
        const text = prompt('粘贴结算文本（游戏格式，每行）：\n昵称 击杀/死亡/助攻 玩家伤/承伤/治疗 对怪\n例：某某野兽 1/0/0 3.6万/2.7万/6506 8');
        if (text == null || !String(text).trim()) return;
        toast('文本解析中…', 2500);
        await runOcrImport(si, ci, { text: String(text) });
      });
    });

    box.querySelectorAll('.lg-club-home').forEach(cb => {
      cb.addEventListener('change', () => {
        readEditorIntoDraft();
        paintSides();
      });
    });
    box.querySelectorAll('[data-toggle-club]').forEach(btn => {
      btn.addEventListener('click', () => {
        readEditorIntoDraft();
        const [si, ci] = btn.dataset.toggleClub.split('-').map(Number);
        const club = d.sides[si] && d.sides[si].clubs[ci];
        if (!club) return;
        club._open = !club._open;
        paintSides();
      });
    });
    box.querySelectorAll('.lg-path-filter').forEach(sel => {
      sel.addEventListener('change', () => {
        readEditorIntoDraft();
        const si = Number(sel.dataset.si);
        const ci = Number(sel.dataset.ci);
        const club = d.sides[si] && d.sides[si].clubs[ci];
        if (!club) return;
        club._pathFilter = sel.value || '';
        club._open = true;
        paintSides();
      });
    });
    box.querySelectorAll('.lg-p-name').forEach(inp => {
      inp.addEventListener('change', () => {
        const row = inp.closest('.league-player-row');
        if (!row) return;
        const path = lookupMemberPathway(inp.value.trim(), '');
        row.dataset.pathway = path;
        const pathEl = row.querySelector('.lg-p-path');
        if (pathEl) pathEl.textContent = path || '—';
      });
    });
  }

  paintSides();

  document.getElementById('leagueEditBack')?.addEventListener('click', () => {
    if (leagueDraft && leagueDraft.id) {
      leagueView = 'detail';
      openLeagueDetail(leagueDraft.id);
    } else {
      leagueView = 'list';
      leagueDraft = null;
      renderLeaguePage();
    }
  });

  document.getElementById('leagueSave')?.addEventListener('click', async () => {
    readEditorIntoDraft();
    if (!leagueDraft.date) { toast('请填写日期'); return; }
    if (!(leagueDraft.sides || []).length) { toast('缺少势力'); return; }
    const payload = {
      date: leagueDraft.date,
      mode: leagueDraft.mode,
      title: leagueDraft.title,
      result: leagueDraft.result,
      note: leagueDraft.note,
      eventId: leagueDraft.eventId || null,
      sides: leagueDraft.sides
    };
    try {
      let res;
      if (leagueDraft.id) {
        res = await api('/api/league/matches/' + encodeURIComponent(leagueDraft.id), {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        res = await api('/api/league/matches', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      toast('战报已保存');
      await loadLeagueClubMemory();
      leagueDetail = res.match;
      leagueDraft = null;
      leagueView = 'detail';
      paintLeagueDetail(root);
    } catch (err) {
      toast(err.message || '保存失败');
    }
  });

  // mode change handler (single)
  const modeEl = document.getElementById('lgMode');
  if (modeEl) {
    modeEl.onchange = () => {
      readEditorIntoDraft();
      const mode = modeEl.value;
      if (mode === leagueDraft.mode) return;
      if (!confirm('切换模式会重建势力结构（个人数据需重填），继续？')) {
        modeEl.value = leagueDraft.mode;
        return;
      }
      const keep = {
        date: leagueDraft.date,
        title: leagueDraft.title,
        result: leagueDraft.result,
        note: leagueDraft.note,
        eventId: leagueDraft.eventId,
        id: leagueDraft.id
      };
      leagueDraft = Object.assign(blankLeagueDraft(mode), keep);
      paintLeagueEditor(root);
    };
  }
}
