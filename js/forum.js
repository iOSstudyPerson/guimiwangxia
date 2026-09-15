/* ===================== 论坛分享（上下混排 + 点赞 + 昵称联想） ===================== */
let forumPosts = [];
let forumLimits = null;
let forumView = 'list';
let forumDetailId = null;
let savedEditorRange = null;

function formatForumTime(ts){
  const d = new Date((ts || 0) * 1000);
  if (!ts || isNaN(d.getTime())) return '—';
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function memberNameSuggestions(){
  const list = (typeof members !== 'undefined' && Array.isArray(members)) ? members : [];
  const names = [];
  const seen = new Set();
  list.forEach(m => {
    const n = (m && m.name || '').trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
    names.push(n);
  });
  return names.sort((a, b) => a.localeCompare(b, 'zh'));
}

function postBlocks(p){
  if (p && Array.isArray(p.blocks) && p.blocks.length) return p.blocks;
  const blocks = [];
  if (p && p.body) blocks.push({ type: 'text', text: p.body });
  (p && p.media || []).forEach(m => {
    if (m && (m.kind === 'image' || m.kind === 'video' || m.type === 'image' || m.type === 'video')) {
      blocks.push({
        type: m.kind || m.type,
        url: m.url,
        key: m.key,
        name: m.name || ''
      });
    }
  });
  return blocks;
}

async function loadForumMeta(){
  try { forumLimits = await api('/api/forum/meta'); }
  catch (e) { forumLimits = null; }
}

async function loadForumPosts(){
  const data = await api('/api/forum/posts');
  forumPosts = data.posts || [];
}

function renderForumPage(){
  const root = document.getElementById('forumRoot');
  if (!root) return;
  if (forumView === 'compose') { renderForumCompose(root); return; }
  if (forumView === 'detail') { renderForumDetail(root); return; }
  renderForumList(root);
}

function renderForumList(root){
  const tips = (forumLimits && forumLimits.tips) || '开放发帖：免登录；可点赞；他人仅浏览；管理员可删帖。';
  const cosOk = forumLimits ? forumLimits.cosReady : true;
  const canDel = typeof loggedIn !== 'undefined' && loggedIn;

  root.innerHTML =
    '<div class="arch-head">' +
      '<div><h2>论坛分享</h2><div class="sub">' + esc(tips) + '</div></div>' +
      '<div class="btn-add" id="forumNewBtn"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>发帖</div>' +
    '</div>' +
    (!cosOk ? '<div class="forum-banner warn">COS 未配置密钥：无法上传图片/视频。</div>' : '') +
    '<div class="forum-limits" id="forumLimitsTip"></div>' +
    '<div class="forum-list" id="forumList"></div>';

  const lim = forumLimits && forumLimits.limits;
  if (lim) {
    document.getElementById('forumLimitsTip').textContent =
      '限制：昵称必填 · 标题 ≤' + lim.titleMax + ' · 正文 ≤' + lim.bodyMax +
      ' · 图 ≤' + lim.imageMaxMB + 'MB×' + lim.imageMax +
      ' · 视频 ≤' + lim.videoMaxMB + 'MB×' + lim.videoMax +
      ' · 间隔 ' + Math.round(lim.cooldownSec / 60) + ' 分钟 · 列表按热度排序';
  }

  const list = document.getElementById('forumList');
  if (!forumPosts.length) {
    list.innerHTML = '<div class="arch-empty" style="padding:40px 12px">还没有帖子，来发第一篇配置分享吧</div>';
  } else {
    list.innerHTML = forumPosts.map(p => {
      const blocks = postBlocks(p);
      const imgN = p.imageCount != null ? p.imageCount : blocks.filter(b => b.type === 'image').length;
      const vidN = p.videoCount != null ? p.videoCount : blocks.filter(b => b.type === 'video').length;
      const meta = [];
      if (imgN) meta.push(imgN + ' 图');
      if (vidN) meta.push(vidN + ' 视频');
      const preview = p.preview || (blocks.find(b => b.type === 'text') || {}).text || '';
      const liked = p.liked ? ' liked' : '';
      return (
        '<div class="forum-card" data-pid="' + esc(p.id) + '">' +
          '<div class="forum-card-top">' +
            '<div class="forum-card-title">' + esc(p.title) + '</div>' +
            '<button type="button" class="like-btn' + liked + '" data-like="' + esc(p.id) + '" title="点赞">' +
              '<span class="like-ico">♥</span><span class="like-n">' + (p.likes || 0) + '</span>' +
            '</button>' +
          '</div>' +
          '<div class="forum-card-meta">' + esc(p.author || '') + ' · ' + formatForumTime(p.createdAt) +
            (meta.length ? ' · ' + meta.join(' · ') : '') + '</div>' +
          '<div class="forum-card-preview">' + esc(String(preview).slice(0, 120)) + (String(preview).length > 120 ? '…' : '') + '</div>' +
          (canDel ? '<div class="forum-card-ops"><span class="op del" data-forum-del="' + esc(p.id) + '">删除</span></div>' : '') +
        '</div>'
      );
    }).join('');
  }

  document.getElementById('forumNewBtn')?.addEventListener('click', () => {
    forumView = 'compose';
    renderForumPage();
  });

  list.addEventListener('click', async e => {
    const likeBtn = e.target.closest('[data-like]');
    if (likeBtn) {
      e.stopPropagation();
      await toggleForumLike(likeBtn.dataset.like);
      return;
    }
    const del = e.target.closest('[data-forum-del]');
    if (del) {
      e.stopPropagation();
      if (!confirm('确认删除该帖？COS 附件也会尝试删除。')) return;
      try {
        await api('/api/forum/posts/' + encodeURIComponent(del.dataset.forumDel), { method: 'DELETE' });
        toast('已删除');
        await refreshForum();
      } catch (err) { toast(err.message || '删除失败'); }
      return;
    }
    const card = e.target.closest('.forum-card');
    if (!card) return;
    forumDetailId = card.dataset.pid;
    forumView = 'detail';
    renderForumPage();
  });
}

async function toggleForumLike(pid){
  try {
    const res = await api('/api/forum/posts/' + encodeURIComponent(pid) + '/like', {
      method: 'POST',
      body: '{}'
    });
    const updated = res.post;
    const idx = forumPosts.findIndex(x => String(x.id) === String(pid));
    if (idx > -1) forumPosts[idx] = updated;
    if (forumView === 'detail' && String(forumDetailId) === String(pid)) {
      renderForumPage();
    } else if (forumView === 'list') {
      // 局部更新按钮，避免整表闪烁；热度排序变化时再整页刷新
      const btn = document.querySelector('[data-like="' + CSS.escape(pid) + '"]');
      if (btn) {
        btn.classList.toggle('liked', !!updated.liked);
        const n = btn.querySelector('.like-n');
        if (n) n.textContent = updated.likes || 0;
      }
      // 重新排序列表
      forumPosts.sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.createdAt || 0) - (a.createdAt || 0));
      renderForumList(document.getElementById('forumRoot'));
    }
    toast(updated.liked ? '已点赞' : '已取消点赞');
  } catch (err) {
    toast(err.message || '点赞失败');
  }
}

function gridCountClass(n){
  if (n <= 1) return 'count-1';
  if (n === 2) return 'count-2';
  if (n === 4) return 'count-4';
  return 'count-3';
}

/** 连续图片合并为九宫格；图与图之间有文字/视频则仍上下排列 */
function renderBlocksHtml(blocks){
  const parts = [];
  const list = blocks || [];
  let i = 0;
  while (i < list.length) {
    const b = list[i];
    if (b && b.type === 'image') {
      const imgs = [];
      while (i < list.length && list[i] && list[i].type === 'image') {
        if (list[i].url) imgs.push(list[i]);
        i++;
      }
      if (!imgs.length) continue;
      const cls = gridCountClass(imgs.length);
      parts.push(
        '<div class="forum-img-grid ' + cls + '">' +
          imgs.map((img, idx) =>
            '<button type="button" class="forum-img-cell" data-gidx="' + idx + '" aria-label="查看大图">' +
              '<img src="' + esc(img.url) + '" alt="" loading="lazy">' +
            '</button>'
          ).join('') +
        '</div>'
      );
      continue;
    }
    if (b && b.type === 'text') {
      parts.push('<div class="forum-block text">' + esc(b.text || '').replace(/\n/g, '<br>') + '</div>');
      i++;
      continue;
    }
    if (b && b.type === 'video') {
      parts.push('<div class="forum-block video"><video src="' + esc(b.url) + '" controls playsinline></video></div>');
      i++;
      continue;
    }
    i++;
  }
  return parts.join('');
}

let forumLightboxUrls = [];
let forumLightboxIdx = 0;

function ensureForumLightbox(){
  let mask = document.getElementById('forumLightbox');
  if (mask) return mask;
  mask = document.createElement('div');
  mask.id = 'forumLightbox';
  mask.className = 'forum-lightbox';
  mask.hidden = true;
  mask.innerHTML =
    '<button type="button" class="forum-lb-close" aria-label="关闭">×</button>' +
    '<button type="button" class="forum-lb-nav prev" aria-label="上一张">‹</button>' +
    '<img class="forum-lb-img" alt="">' +
    '<button type="button" class="forum-lb-nav next" aria-label="下一张">›</button>' +
    '<div class="forum-lb-count"></div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', e => {
    if (e.target === mask || e.target.classList.contains('forum-lb-close')) closeForumLightbox();
  });
  mask.querySelector('.forum-lb-nav.prev')?.addEventListener('click', e => {
    e.stopPropagation();
    showForumLightboxAt(forumLightboxIdx - 1);
  });
  mask.querySelector('.forum-lb-nav.next')?.addEventListener('click', e => {
    e.stopPropagation();
    showForumLightboxAt(forumLightboxIdx + 1);
  });
  document.addEventListener('keydown', e => {
    if (mask.hidden) return;
    if (e.key === 'Escape') closeForumLightbox();
    if (e.key === 'ArrowLeft') showForumLightboxAt(forumLightboxIdx - 1);
    if (e.key === 'ArrowRight') showForumLightboxAt(forumLightboxIdx + 1);
  });
  return mask;
}

function showForumLightboxAt(idx){
  const mask = ensureForumLightbox();
  if (!forumLightboxUrls.length) return;
  const n = forumLightboxUrls.length;
  forumLightboxIdx = ((idx % n) + n) % n;
  const img = mask.querySelector('.forum-lb-img');
  const count = mask.querySelector('.forum-lb-count');
  const prev = mask.querySelector('.forum-lb-nav.prev');
  const next = mask.querySelector('.forum-lb-nav.next');
  img.src = forumLightboxUrls[forumLightboxIdx];
  count.textContent = n > 1 ? (forumLightboxIdx + 1) + ' / ' + n : '';
  const multi = n > 1;
  if (prev) prev.hidden = !multi;
  if (next) next.hidden = !multi;
}

function openForumLightbox(urls, idx){
  forumLightboxUrls = (urls || []).filter(Boolean);
  if (!forumLightboxUrls.length) return;
  const mask = ensureForumLightbox();
  mask.hidden = false;
  document.body.classList.add('forum-lb-open');
  showForumLightboxAt(idx || 0);
}

function closeForumLightbox(){
  const mask = document.getElementById('forumLightbox');
  if (!mask) return;
  mask.hidden = true;
  document.body.classList.remove('forum-lb-open');
  const img = mask.querySelector('.forum-lb-img');
  if (img) img.removeAttribute('src');
  forumLightboxUrls = [];
}

function bindForumImageLightbox(scope){
  const root = scope || document;
  root.querySelectorAll('.forum-img-grid').forEach(grid => {
    if (grid.dataset.lbBound) return;
    grid.dataset.lbBound = '1';
    grid.addEventListener('click', e => {
      const cell = e.target.closest('.forum-img-cell');
      if (!cell || !grid.contains(cell)) return;
      const urls = [...grid.querySelectorAll('.forum-img-cell img')].map(el => el.currentSrc || el.src);
      const idx = Number(cell.dataset.gidx) || 0;
      openForumLightbox(urls, idx);
    });
  });
}

function renderForumDetail(root){
  const p = forumPosts.find(x => String(x.id) === String(forumDetailId));
  const canDel = typeof loggedIn !== 'undefined' && loggedIn;
  if (!p) {
    root.innerHTML = '<div class="arch-empty">帖子不存在<div class="back-btn" id="forumBack" style="margin-top:16px">返回列表</div></div>';
    document.getElementById('forumBack')?.addEventListener('click', () => { forumView = 'list'; renderForumPage(); });
    return;
  }
  const blocks = postBlocks(p);
  const liked = p.liked ? ' liked' : '';
  root.innerHTML =
    '<div class="forum-detail-bar">' +
      '<div class="back-btn" id="forumBack">← 返回列表</div>' +
      '<div class="forum-detail-actions">' +
        '<button type="button" class="like-btn' + liked + '" id="forumDetailLike"><span class="like-ico">♥</span><span class="like-n">' + (p.likes || 0) + '</span></button>' +
        (canDel ? '<span class="op del" id="forumDetailDel">删除本帖</span>' : '') +
      '</div>' +
    '</div>' +
    '<article class="forum-detail">' +
      '<h2>' + esc(p.title) + '</h2>' +
      '<div class="forum-card-meta">' + esc(p.author || '') + ' · ' + formatForumTime(p.createdAt) + '</div>' +
      '<div class="forum-blocks">' + renderBlocksHtml(blocks) + '</div>' +
    '</article>';

  bindForumImageLightbox(root);
  document.getElementById('forumBack')?.addEventListener('click', () => { forumView = 'list'; renderForumPage(); });
  document.getElementById('forumDetailLike')?.addEventListener('click', () => toggleForumLike(p.id));
  document.getElementById('forumDetailDel')?.addEventListener('click', async () => {
    if (!confirm('确认删除该帖？')) return;
    try {
      await api('/api/forum/posts/' + encodeURIComponent(p.id), { method: 'DELETE' });
      toast('已删除');
      forumView = 'list';
      await refreshForum();
    } catch (err) { toast(err.message || '删除失败'); }
  });
}

function renderForumCompose(root){
  const lim = (forumLimits && forumLimits.limits) || {
    titleMax: 40, bodyMax: 5000, authorMax: 20, imageMax: 6, videoMax: 1, imageMaxMB: 5, videoMaxMB: 80
  };
  const names = memberNameSuggestions();
  const options = names.map(n => '<option value="' + esc(n) + '"></option>').join('');

  root.innerHTML =
    '<div class="forum-detail-bar"><div class="back-btn" id="forumBack">← 返回列表</div></div>' +
    '<div class="forum-compose-wrap">' +
      '<p class="settings-hint" style="margin-bottom:12px">编辑所见即所得：在正文里直接打字，用工具栏在光标处插入图片/视频。昵称必填。</p>' +
      '<div class="field"><label>昵称 <span style="color:var(--gold)">*</span></label>' +
        '<input id="fAuthor" list="memberNameList" maxlength="' + lim.authorMax + '" placeholder="点击输入，可联想成员姓名" autocomplete="off">' +
        '<datalist id="memberNameList">' + options + '</datalist>' +
      '</div>' +
      '<div class="field"><label>标题 <span style="color:var(--gold)">*</span></label>' +
        '<input id="fTitle" maxlength="' + lim.titleMax + '" placeholder="例如：战士开荒配置分享">' +
      '</div>' +
      '<div class="forum-editor-toolbar">' +
        '<button type="button" class="roll-tool" id="fBtnImg">插入图片</button>' +
        '<button type="button" class="roll-tool" id="fBtnVid">插入视频</button>' +
        '<span class="settings-hint">图 ≤' + lim.imageMaxMB + 'MB×' + lim.imageMax +
          ' · 视频 ≤' + lim.videoMaxMB + 'MB×' + lim.videoMax + '</span>' +
      '</div>' +
      '<article class="forum-detail forum-compose-doc">' +
        '<div class="forum-card-meta" id="fMetaPreview">正文预览区 · 与浏览样式一致</div>' +
        '<div class="forum-blocks forum-editor" id="fEditor" contenteditable="true" ' +
          'data-placeholder="在这里直接写内容…选中位置后点上方按钮插入图片/视频"></div>' +
      '</article>' +
      '<div class="btn primary" id="fSubmit" style="margin-top:16px">发 布</div>' +
      '<input type="file" id="fImgPick" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>' +
      '<input type="file" id="fVidPick" accept="video/mp4,video/webm" hidden>' +
    '</div>';

  const editor = document.getElementById('fEditor');
  editor.innerHTML = '<div class="forum-block text"><br></div>';

  document.getElementById('forumBack')?.addEventListener('click', () => { forumView = 'list'; renderForumPage(); });
  document.getElementById('fSubmit')?.addEventListener('click', submitForumPost);
  document.getElementById('fBtnImg')?.addEventListener('click', () => {
    saveEditorSelection();
    document.getElementById('fImgPick').click();
  });
  document.getElementById('fBtnVid')?.addEventListener('click', () => {
    saveEditorSelection();
    document.getElementById('fVidPick').click();
  });
  document.getElementById('fImgPick')?.addEventListener('change', async e => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const file of files) {
      await uploadAndInsertMedia(file, 'image');
    }
  });
  document.getElementById('fVidPick')?.addEventListener('change', async e => {
    const file = (e.target.files || [])[0];
    e.target.value = '';
    if (file) await uploadAndInsertMedia(file, 'video');
  });

  editor.addEventListener('paste', e => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  const syncEmpty = () => {
    const empty = !editor.innerText || !editor.innerText.replace(/\s/g, '');
    editor.classList.toggle('is-empty', empty);
  };
  editor.addEventListener('input', syncEmpty);
  syncEmpty();
  // 点媒体上的删除
  editor.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm-media]');
    if (!rm) return;
    e.preventDefault();
    const wrap = rm.closest('.forum-block');
    const grid = wrap && wrap.closest('.forum-img-grid');
    if (wrap) wrap.remove();
    if (grid) {
      const left = grid.querySelectorAll('.forum-block.image[data-key]').length;
      if (!left) grid.remove();
      else updateEditorGridClass(grid);
    }
    ensureEditorNotEmpty();
    syncEmpty();
  });
}

function saveEditorSelection(){
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { savedEditorRange = null; return; }
  const editor = document.getElementById('fEditor');
  const range = sel.getRangeAt(0);
  if (editor && editor.contains(range.commonAncestorContainer)) {
    savedEditorRange = range.cloneRange();
  } else {
    savedEditorRange = null;
  }
}

function restoreEditorSelection(){
  const editor = document.getElementById('fEditor');
  if (!editor) return;
  editor.focus();
  const sel = window.getSelection();
  if (savedEditorRange) {
    sel.removeAllRanges();
    sel.addRange(savedEditorRange);
  } else {
    // 移到末尾
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function ensureEditorNotEmpty(){
  const editor = document.getElementById('fEditor');
  if (!editor) return;
  if (!editor.querySelector('.forum-block, .forum-img-grid')) {
    editor.innerHTML = '<div class="forum-block text"><br></div>';
  }
}

function countEditorMedia(kind){
  const editor = document.getElementById('fEditor');
  if (!editor) return 0;
  return editor.querySelectorAll('.forum-block.' + kind + '[data-key]').length;
}

async function uploadAndInsertMedia(file, kind){
  const lim = (forumLimits && forumLimits.limits) || {};
  if (kind === 'image' && countEditorMedia('image') >= (lim.imageMax || 6)) {
    toast('图片已达上限'); return;
  }
  if (kind === 'video' && countEditorMedia('video') >= (lim.videoMax || 1)) {
    toast('视频已达上限'); return;
  }

  toast('正在上传「' + file.name + '」…');
  try {
    const sign = await api('/api/forum/upload-sign', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        filename: file.name,
        contentType: file.type || (kind === 'image' ? 'image/jpeg' : 'video/mp4'),
        size: file.size
      })
    });
    const put = await fetch(sign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': sign.contentType },
      body: file
    });
    if (!put.ok) {
      const t = await put.text().catch(() => '');
      throw new Error('COS 上传失败 ' + put.status + (t ? ': ' + t.slice(0, 120) : ''));
    }
    insertMediaNode(kind, sign.publicUrl, sign.key, file.name);
    toast('上传成功');
  } catch (err) {
    toast(err.message || '上传失败');
  }
}

function isEmptyTextBlock(el){
  if (!el || !el.classList || !el.classList.contains('text')) return false;
  const t = (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').replace(/\s/g, '');
  return !t;
}

function updateEditorGridClass(grid){
  if (!grid) return;
  const n = grid.querySelectorAll('.forum-block.image[data-key]').length;
  grid.className = 'forum-img-grid ' + gridCountClass(Math.max(1, n));
}

function createImageBlock(url, key, name){
  const wrap = document.createElement('div');
  wrap.className = 'forum-block image';
  wrap.contentEditable = 'false';
  wrap.dataset.key = key;
  wrap.dataset.name = name || '';
  wrap.dataset.url = url;
  wrap.innerHTML =
    '<img src="' + esc(url) + '" alt="">' +
    '<button type="button" class="media-rm" data-rm-media title="删除">×</button>';
  return wrap;
}

function ensureTextAfter(node){
  const next = node.nextElementSibling;
  if (next && next.classList.contains('text')) return next;
  const afterText = document.createElement('div');
  afterText.className = 'forum-block text';
  afterText.innerHTML = '<br>';
  node.after(afterText);
  return afterText;
}

function placeCaretIn(el, atStart){
  const sel = window.getSelection();
  if (!sel || !el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!!atStart);
  sel.removeAllRanges();
  sel.addRange(range);
  savedEditorRange = range.cloneRange();
}

function findEditorAnchor(editor){
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  while (node && node !== editor) {
    if (node.nodeType === 1) {
      if (node.classList.contains('forum-img-grid')) return node;
      if (node.classList.contains('forum-block')) {
        return node.closest('.forum-img-grid') || node;
      }
    }
    node = node.parentNode;
  }
  return null;
}

function insertMediaNode(kind, url, key, name){
  const editor = document.getElementById('fEditor');
  if (!editor) return;
  restoreEditorSelection();

  if (kind === 'video') {
    const wrap = document.createElement('div');
    wrap.className = 'forum-block video';
    wrap.contentEditable = 'false';
    wrap.dataset.key = key;
    wrap.dataset.name = name || '';
    wrap.dataset.url = url;
    wrap.innerHTML =
      '<video src="' + esc(url) + '" controls playsinline></video>' +
      '<button type="button" class="media-rm" data-rm-media title="删除">×</button>';

    const anchor = findEditorAnchor(editor);
    if (anchor && anchor.parentNode === editor) anchor.after(wrap);
    else editor.appendChild(wrap);
    placeCaretIn(ensureTextAfter(wrap), true);
    return;
  }

  const img = createImageBlock(url, key, name);
  const anchor = findEditorAnchor(editor);
  let grid = null;

  if (anchor && anchor.classList.contains('forum-img-grid')) {
    grid = anchor;
  } else if (anchor && anchor.parentNode === editor && isEmptyTextBlock(anchor)) {
    const prev = anchor.previousElementSibling;
    if (prev && prev.classList.contains('forum-img-grid')) grid = prev;
  }

  if (!grid) {
    if (anchor && anchor.parentNode === editor) {
      if (isEmptyTextBlock(anchor)) {
        const prev = anchor.previousElementSibling;
        if (prev && prev.classList.contains('forum-img-grid')) {
          grid = prev;
        } else {
          grid = document.createElement('div');
          grid.contentEditable = 'false';
          anchor.before(grid);
        }
      } else {
        // 当前块有文字或是视频 → 在其后新开一组图
        grid = document.createElement('div');
        grid.contentEditable = 'false';
        anchor.after(grid);
      }
    } else {
      let last = editor.lastElementChild;
      while (last && isEmptyTextBlock(last)) last = last.previousElementSibling;
      if (last && last.classList.contains('forum-img-grid')) {
        grid = last;
      } else {
        grid = document.createElement('div');
        grid.contentEditable = 'false';
        if (last) last.after(grid);
        else editor.appendChild(grid);
      }
    }
  }

  grid.appendChild(img);
  updateEditorGridClass(grid);

  const afterText = ensureTextAfter(grid);
  let walk = grid.nextElementSibling;
  while (walk && walk !== afterText) {
    const next = walk.nextElementSibling;
    if (isEmptyTextBlock(walk)) walk.remove();
    walk = next;
  }
  // 兜底：把「图 + 空文字 + 图」折叠进九宫格（防止旧结构残留）
  collapseEditorImageRuns(editor);
  const home = (img.isConnected && img.closest('.forum-img-grid')) || (grid.isConnected && grid) || editor.querySelector('.forum-img-grid:last-of-type');
  if (home) placeCaretIn(ensureTextAfter(home), true);
}

/** 将编辑器里被空文字隔开的连续图片合并为九宫格 */
function collapseEditorImageRuns(editor){
  if (!editor) return;
  let guard = 0;
  while (guard++ < 40) {
    const loose = editor.querySelector(':scope > .forum-block.image[data-key]');
    if (!loose) break;
    const grid = document.createElement('div');
    grid.contentEditable = 'false';
    loose.before(grid);
    grid.appendChild(loose);

    let n = grid.nextElementSibling;
    while (n) {
      if (isEmptyTextBlock(n)) {
        const after = n.nextElementSibling;
        if (after && ((after.classList.contains('image') && after.dataset.key) || after.classList.contains('forum-img-grid'))) {
          n.remove();
          n = after;
          continue;
        }
        break;
      }
      if (n.classList.contains('image') && n.dataset.key) {
        const next = n.nextElementSibling;
        grid.appendChild(n);
        n = next;
        continue;
      }
      if (n.classList.contains('forum-img-grid')) {
        const next = n.nextElementSibling;
        [...n.querySelectorAll('.forum-block.image[data-key]')].forEach(im => grid.appendChild(im));
        n.remove();
        n = next;
        continue;
      }
      break;
    }
    updateEditorGridClass(grid);
    ensureTextAfter(grid);
  }

  // 合并相邻图格（中间仅空文字）
  let g = editor.querySelector(':scope > .forum-img-grid');
  while (g) {
    let n = g.nextElementSibling;
    while (n && isEmptyTextBlock(n)) {
      const after = n.nextElementSibling;
      if (after && after.classList.contains('forum-img-grid')) {
        n.remove();
        n = after;
      } else break;
    }
    if (n && n.classList.contains('forum-img-grid')) {
      const next = n.nextElementSibling;
      [...n.querySelectorAll('.forum-block.image[data-key]')].forEach(im => g.appendChild(im));
      n.remove();
      updateEditorGridClass(g);
      n = next;
      continue;
    }
    updateEditorGridClass(g);
    g = g.nextElementSibling && g.nextElementSibling.classList?.contains('forum-img-grid')
      ? g.nextElementSibling
      : (() => {
          let x = g.nextElementSibling;
          while (x && !x.classList.contains('forum-img-grid')) x = x.nextElementSibling;
          return x;
        })();
  }
}

function extractBlocksFromEditor(){
  const editor = document.getElementById('fEditor');
  const blocks = [];
  if (!editor) return blocks;

  const pushText = (raw) => {
    const text = String(raw || '').replace(/\u00a0/g, ' ');
    if (!text.replace(/\s/g, '')) return;
    blocks.push({ type: 'text', text: text.replace(/\n{3,}/g, '\n\n').trimEnd() });
  };

  const pushImage = (el) => {
    if (!el || !el.dataset || !el.dataset.key) return;
    blocks.push({
      type: 'image',
      url: el.dataset.url || (el.querySelector('img') && el.querySelector('img').src) || '',
      key: el.dataset.key,
      name: el.dataset.name || ''
    });
  };

  editor.childNodes.forEach(node => {
    if (node.nodeType === 3) {
      pushText(node.textContent);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;
    if (el.classList.contains('forum-img-grid')) {
      el.querySelectorAll('.forum-block.image[data-key]').forEach(pushImage);
      return;
    }
    if (el.classList.contains('image') && el.dataset.key) {
      pushImage(el);
      return;
    }
    if (el.classList.contains('video') && el.dataset.key) {
      blocks.push({
        type: 'video',
        url: el.dataset.url || (el.querySelector('video') && el.querySelector('video').src) || '',
        key: el.dataset.key,
        name: el.dataset.name || ''
      });
      return;
    }
    if (el.classList.contains('text') || el.tagName === 'DIV' || el.tagName === 'P') {
      pushText(el.innerText || el.textContent || '');
    }
  });
  return blocks;
}

async function submitForumPost(){
  const title = (document.getElementById('fTitle')?.value || '').trim();
  const author = (document.getElementById('fAuthor')?.value || '').trim();
  const blocks = extractBlocksFromEditor();

  if (!author) { toast('请填写昵称'); document.getElementById('fAuthor')?.focus(); return; }
  if (!title) { toast('请填写标题'); return; }
  if (!blocks.length || !blocks.some(b => b.type === 'text')) {
    toast('请至少写一段文字');
    document.getElementById('fEditor')?.focus();
    return;
  }
  try {
    await api('/api/forum/posts', {
      method: 'POST',
      body: JSON.stringify({ title, author, blocks })
    });
    toast('发布成功');
    forumView = 'list';
    await refreshForum();
  } catch (err) {
    toast(err.message || '发布失败');
  }
}

async function refreshForum(){
  await loadForumMeta();
  await loadForumPosts();
  renderForumPage();
}
