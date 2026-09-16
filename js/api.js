/* ===================== API 客户端（共享服务） ===================== */
const API_TOKEN_KEY = 'beyonders-archive-token';
const API_BASE = '';

let apiToken = localStorage.getItem(API_TOKEN_KEY) || '';

function setApiToken(token){
  apiToken = token || '';
  if (apiToken) localStorage.setItem(API_TOKEN_KEY, apiToken);
  else localStorage.removeItem(API_TOKEN_KEY);
}

async function api(path, options){
  const opts = options || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (apiToken) headers.Authorization = 'Bearer ' + apiToken;
  let res;
  try {
    res = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
  } catch (e) {
    const err = new Error('无法连接服务器，请确认已启动 server.py');
    err.offline = true;
    throw err;
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { error: text || '响应异常' }; }
  if (!res.ok) {
    const err = new Error((data && data.error) || ('请求失败 ' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function apiLogin(username, password){
  const data = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  setApiToken(data.token);
  return data;
}

async function apiLogout(){
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch (e) { /* ignore */ }
  setApiToken('');
}

async function apiMe(){
  return api('/api/me');
}

async function apiLoadOverview(){
  return api('/api/overview' + (typeof clubQuery === 'function' ? clubQuery() : ''));
}

async function apiLoadEvents(){
  const e = await api('/api/events' + (typeof clubQuery === 'function' ? clubQuery() : ''));
  return (e && e.events) || [];
}

async function apiLoadMembers(){
  const m = await api('/api/members' + (typeof clubQuery === 'function' ? clubQuery() : ''));
  return (m && m.members) || [];
}

/** 访客拉取总览+活动；管理员额外拉取完整成员名单 */
async function apiLoadAll(isAdmin){
  const tasks = [apiLoadOverview(), apiLoadEvents()];
  if (isAdmin) tasks.push(apiLoadMembers());
  const results = await Promise.all(tasks);
  return {
    overview: results[0] || null,
    events: results[1] || [],
    members: isAdmin ? (results[2] || []) : []
  };
}

function requireWrite(actionLabel){
  if (typeof loggedIn !== 'undefined' && loggedIn) return true;
  if (typeof openLogin === 'function') openLogin();
  if (typeof toast === 'function') toast((actionLabel || '该操作') + '需要管理员登录');
  return false;
}
