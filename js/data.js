/* ===================== 页面元数据 ===================== */
const PAGES = {
  overview: { title: '成员档案', desc: '' },
  archive:  { title: '成员档案', desc: '管理成员登记、途径归属、非凡评分与晋升记录。', icon: 'archive' },
  squads:   { title: '团队编组', desc: '三团编制：每团五小队、每队六人，可指定团长并拖拽调位。', icon: 'squads' },
  dkp:      { title: 'DKP管理', desc: '活动出勤与贡献积分（DKP）的记录与结算。', icon: 'dkp' },
  league:   { title: '联赛分析', desc: 'GvG 战报：宣战 / 四方 / 终末等，评分对比与个人输出·战略分析。', icon: 'league' },
  builds:   { title: '推荐配置', desc: '各途径推荐技能配置与装备方案。', icon: 'builds' },
  forum:    { title: '论坛分享', desc: '开放发帖分享配置与心得，支持图片与视频。', icon: 'forum' },
  settings: { title: '系统设置', desc: '数据库同步、界面主题与权限管理。', icon: 'settings' }
};
const ICONS = {
  archive: '<svg viewBox="0 0 24 24"><path d="M4 4h16v4H4z"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/></svg>',
  squads: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.7-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15.5 14.2c2.6.3 4.4 1.9 5 4.8"/></svg>',
  dkp: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M15 9.2c-.6-1-1.7-1.6-3-1.6-1.8 0-3 .9-3 2.3 0 3.2 6 1.3 6 4.5 0 1.4-1.3 2.4-3.2 2.4-1.4 0-2.6-.7-3.1-1.8"/></svg>',
  league: '<svg viewBox="0 0 24 24"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></svg>',
  builds: '<svg viewBox="0 0 24 24"><path d="M4 8h10"/><circle cx="17.5" cy="8" r="2.4"/><path d="M20 8h1"/><path d="M4 16h3"/><circle cx="10.5" cy="16" r="2.4"/><path d="M13 16h8"/></svg>',
  forum: '<svg viewBox="0 0 24 24"><path d="M4 5h16v10H8l-4 4z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/></svg>'
};

const SQUAD_CAP = 30;
const SQUAD_ORDER = ['一团', '二团', '三团'];
const SQUAD_TEAM_COUNT = 5;
const SQUAD_SLOT_COUNT = 6;

/** 从 members 汇总总览所需数据 */
function computeOverviewFromMembers(list){
  const all = list || [];
  const totalRegistered = all.length;
  const totalScoreNum = all.reduce((s, m) => s + (Number(m.score) || 0), 0);
  const scored = all.filter(m => (Number(m.score) || 0) > 0);
  const avgScoreNum = scored.length
    ? Math.round(scored.reduce((s, m) => s + (Number(m.score) || 0), 0) / scored.length)
    : 0;

  const squads = SQUAD_ORDER.map(name => {
    const count = all.filter(m =>
      m.squad === name && m.status === '在帮' && m.team && m.slot
    ).length;
    const fill = Math.min(100, Math.round((count / SQUAD_CAP) * 100));
    return {
      name,
      fill,
      pct: fill + '%',
      mem: count + '/' + SQUAD_CAP
    };
  });

  // 仅展示当前实际出现的途径（无成员时为空图，不填充假计数）
  const pathwayMap = {};
  all.forEach(m => {
    const p = m.pathway || '未指定';
    pathwayMap[p] = (pathwayMap[p] || 0) + 1;
  });
  const pathways = Object.keys(pathwayMap)
    .sort((a, b) => pathwayMap[b] - pathwayMap[a] || a.localeCompare(b, 'zh'))
    .map(name => ({ name, value: pathwayMap[name] }));

  return {
    totalRegistered,
    totalScore: totalScoreNum.toLocaleString('en-US'),
    totalScoreNum,
    avgScore: avgScoreNum ? avgScoreNum.toLocaleString('en-US') : '—',
    avgScoreNum,
    readiness: [{ group: '王下七武海', squads }],
    pathways
  };
}
