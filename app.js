/* ============================================================
   经济学词典 · Econ Lexicon — app logic
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- Cloud client ---------------- */

  var PUBLIC_CONFIG = {
    endpoint: 'https://econ-lexicon.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_IvtEXYhjdGRRwAy4QyaS4B_ZbSYSihtH1H7Ie7g6cDT79c5A9ODoAtf'
  };

  var cloud = null;
  if (window.WorkBuddyCloud && typeof window.WorkBuddyCloud.createWorkBuddyCloud === 'function') {
    cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
      publishableKey: PUBLIC_CONFIG.publishableKey
    });
  }

  /* ---------------- Categories ---------------- */

  var CATS = [
    { name: '微观经济学', fg: '#1c4a3a', bg: '#e9f0eb' },
    { name: '宏观经济学', fg: '#2a4a7c', bg: '#e8eefa' },
    { name: '金融学', fg: '#8a5a15', bg: '#f7eedd' },
    { name: '国际经济学', fg: '#6a3d68', bg: '#f2e9f2' },
    { name: '行为经济学', fg: '#b4552c', bg: '#f9eae2' }
  ];

  function catVars(name) {
    for (var i = 0; i < CATS.length; i++) {
      if (CATS[i].name === name) {
        return '--cat-fg:' + CATS[i].fg + ';--cat-bg:' + CATS[i].bg;
      }
    }
    return '--cat-fg:#5d574c;--cat-bg:#f0ece3';
  }

  function catOrder(name) {
    for (var i = 0; i < CATS.length; i++) {
      if (CATS[i].name === name) return i;
    }
    return 99;
  }

  /* ---------------- Helpers ---------------- */

  function $(sel) { return document.querySelector(sel); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer = null;
  function toast(message, kind) {
    var node = $('#toast');
    node.textContent = message;
    node.className = 'toast show' + (kind ? ' ' + kind : '');
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.className = 'toast ' + (kind || '');
    }, 3200);
  }

  function errText(err, fallback) {
    if (!err) return fallback;
    var msg = err.message || err.error_description || err.msg || '';
    if (!msg) return fallback;
    return msg;
  }

  /* 给任何请求加超时，避免界面永远停在「正在加载」 */
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        var e = new Error((label || '请求') + '超时');
        e.kind = 'timeout';
        reject(e);
      }, ms);
      promise.then(function (v) {
        clearTimeout(timer);
        resolve(v);
      }, function (e) {
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  /* 把各种失败翻译成人话，并保留排障所需的代码 */
  function describeError(err) {
    var code = (err && (err.code || (err.cause && err.cause.code))) || '';
    var status = (err && (err.status || err.statusCode)) || 0;
    var raw = errText(err, '');
    var detail = [];
    if (code) detail.push('code: ' + code);
    if (status) detail.push('HTTP ' + status);
    if (err && err.requestId) detail.push('requestId: ' + err.requestId);
    detail = detail.join('  ·  ');

    if (code === 'ACCESS_TOKEN_KID_INVALID') {
      return {
        kind: 'credential',
        title: '云端数据库拒绝了这次请求',
        message: '数据表和访问权限都是正常的，是云端网关没有接受这次请求的访问凭据（环境凭据问题），不是你的操作有误。可以点「重新加载」再试。',
        detail: detail
      };
    }
    if (code === 'MISSING_CREDENTIALS') {
      return {
        kind: 'credential',
        title: '云端访问凭据缺失',
        message: '当前请求没有带上有效的云端凭据，请刷新后重试。',
        detail: detail
      };
    }
    if (err && err.kind === 'timeout') {
      return {
        kind: 'timeout',
        title: '连接云端超时',
        message: '网络较慢或云端暂时没有响应，请点「重新加载」再试一次。',
        detail: detail
      };
    }
    if (!status || /Failed to fetch|NetworkError|fetch failed|Load failed/i.test(raw)) {
      if (isLocalPreview()) {
        return {
          kind: 'preview',
          title: '本地预览连不上云端',
          message: '云端数据只对发布后的线上地址开放，在本地文件或预览窗口里读不到词条。请打开线上链接查看。',
          detail: detail || raw
        };
      }
      return {
        kind: 'network',
        title: '连不上云端',
        message: '请检查网络连接后重试。如果一直失败，可能是云端服务暂时不可用。',
        detail: detail || raw
      };
    }
    if (code === '42P01') {
      return {
        kind: 'schema',
        title: '数据表不存在',
        message: '云端数据库里没有找到词条表，需要重新初始化数据表。',
        detail: detail
      };
    }
    if (code === '42501') {
      return {
        kind: 'permission',
        title: '没有访问权限',
        message: '云端数据库拒绝了这次读写，可能是权限策略配置有变化。',
        detail: detail
      };
    }
    return {
      kind: 'unknown',
      title: '词条没能加载出来',
      message: raw || '出现未知错误，请稍后重试。',
      detail: detail
    };
  }

  /* ---------------- State ---------------- */

  var state = {
    terms: [],
    query: '',
    category: '全部',
    session: null,
    adminQuery: '',
    loading: true,
    loadError: null,
    snapshot: false
  };

  /* ---------------- Browse rendering ---------------- */

  function allCategories() {
    var list = CATS.map(function (c) { return c.name; });
    state.terms.forEach(function (t) {
      if (t.category && list.indexOf(t.category) === -1) list.push(t.category);
    });
    return list;
  }

  function sortedTerms() {
    return state.terms.slice().sort(function (a, b) {
      var oa = catOrder(a.category), ob = catOrder(b.category);
      if (oa !== ob) return oa - ob;
      var ca = a.category || '', cb = b.category || '';
      if (ca !== cb) return ca.localeCompare(cb, 'zh-Hans-CN');
      return String(a.term || '').localeCompare(String(b.term || ''), 'zh-Hans-CN');
    });
  }

  function visibleTerms() {
    var q = state.query.trim().toLowerCase();
    return sortedTerms().filter(function (t) {
      if (state.category !== '全部' && t.category !== state.category) return false;
      if (!q) return true;
      var hay = [t.term || '', t.short_def || '', t.detail || '', t.example || '', t.category || '']
        .join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function renderChips() {
    var counts = {};
    state.terms.forEach(function (t) {
      counts[t.category] = (counts[t.category] || 0) + 1;
    });

    var html = '<button class="chip' + (state.category === '全部' ? ' is-active' : '') + '" data-cat="全部">全部<small>' +
      state.terms.length + '</small></button>';

    allCategories().forEach(function (name) {
      if (!counts[name] && state.category !== name) return;
      html += '<button class="chip' + (state.category === name ? ' is-active' : '') +
        '" data-cat="' + esc(name) + '">' + esc(name) + '<small>' + (counts[name] || 0) + '</small></button>';
    });

    $('#chips').innerHTML = html;
  }

  function cardHTML(t) {
    return '<button class="card" data-id="' + esc(t.id) + '" style="' + catVars(t.category) + '">' +
      '<span class="badge" style="' + catVars(t.category) + '">' + esc(t.category) + '</span>' +
      '<h3 class="card-term">' + esc(t.term) + '</h3>' +
      '<p class="card-def">' + esc(t.short_def) + '</p>' +
      '<span class="card-more">展开解释 →</span>' +
      '</button>';
  }

  function renderBrowse() {
    var grid = $('#grid');
    var empty = $('#empty');
    var line = $('#resultLine');

    $('#statTerms').textContent = state.terms.length || '0';
    $('#statCats').textContent = Object.keys(state.terms.reduce(function (acc, t) {
      acc[t.category] = 1; return acc;
    }, {})).length || '0';

    renderChips();

    if (state.loading) {
      grid.innerHTML = new Array(6).join('<div class="sk"></div>') + '<div class="sk"></div>';
      grid.hidden = false;
      empty.hidden = true;
      line.textContent = '正在加载词条…';
      return;
    }

    var list = visibleTerms();

    if (!list.length) {
      grid.innerHTML = '';
      grid.hidden = true;
      empty.hidden = false;

      var emptyTitle = $('#emptyTitle');
      var emptySub = $('#emptySub');
      var emptyDetail = $('#emptyDetail');
      var emptyBtn = $('#btnResetFilter');

      if (state.loadError) {
        emptyTitle.textContent = state.loadError.title;
        emptySub.textContent = state.loadError.message;
        if (state.loadError.detail) {
          emptyDetail.hidden = false;
          emptyDetail.textContent = state.loadError.detail;
        } else {
          emptyDetail.hidden = true;
          emptyDetail.textContent = '';
        }
        emptyBtn.textContent = '重新加载';
        emptyBtn.setAttribute('data-mode', 'retry');
        line.innerHTML = '未能连接云端数据库';
      } else {
        emptyTitle.textContent = '没有找到相关词条';
        emptySub.textContent = '换个关键词，或者点下面的按钮回到全部词条。';
        emptyDetail.hidden = true;
        emptyDetail.textContent = '';
        emptyBtn.textContent = '查看全部词条';
        emptyBtn.setAttribute('data-mode', 'reset');
        line.innerHTML = '没有匹配的词条';
      }
      return;
    }

    grid.hidden = false;
    empty.hidden = true;
    grid.innerHTML = list.map(cardHTML).join('');

    var bits = [];
    if (state.query.trim()) bits.push('“<b>' + esc(state.query.trim()) + '</b>” 找到 <b>' + list.length + '</b> 条');
    else bits.push('共 <b>' + list.length + '</b> 条词条');
    if (state.category !== '全部') bits.push('分类：<b>' + esc(state.category) + '</b>');
    if (state.snapshot) bits.push('<span class="snap-hint">本地快照 · 只读镜像</span>');
    line.innerHTML = bits.join(' · ');
  }

  /* ---------------- Detail modal ---------------- */

  function openDetail(id) {
    var term = null;
    for (var i = 0; i < state.terms.length; i++) {
      if (String(state.terms[i].id) === String(id)) { term = state.terms[i]; break; }
    }
    if (!term) return;

    var html = '<button class="modal-close" data-close aria-label="关闭">✕</button>' +
      '<div class="detail">' +
        '<div class="detail-top"><span class="badge" style="' + catVars(term.category) + '">' +
          esc(term.category) + '</span></div>' +
        '<h2 class="detail-term">' + esc(term.term) + '</h2>' +
        '<p class="detail-short">' + esc(term.short_def) + '</p>' +
        '<div class="detail-section">' +
          '<h3>详细解释</h3>' +
          '<p class="prose">' + esc(term.detail || '—') + '</p>' +
        '</div>' +
        '<div class="detail-example">' +
          '<h3>生活例子</h3>' +
          '<p class="prose">' + esc(term.example || '—') + '</p>' +
        '</div>' +
      '</div>';

    openModal(html, 'modal-detail');
  }

  /* ---------------- Modal plumbing ---------------- */

  function openModal(html, extraClass) {
    var overlay = $('#overlay');
    var modal = $('#modal');
    modal.className = 'modal' + (extraClass ? ' ' + extraClass : '');
    modal.innerHTML = html;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.scrollTop = 0;
  }

  function closeModal() {
    var overlay = $('#overlay');
    overlay.hidden = true;
    $('#modal').innerHTML = '';
    document.body.style.overflow = '';
  }

  function confirmDialog(title, desc, onConfirm) {
    var html = '<button class="modal-close" data-close aria-label="关闭">✕</button>' +
      '<h2 class="modal-title">' + esc(title) + '</h2>' +
      '<p class="muted" style="line-height:1.8;margin-bottom:24px">' + esc(desc) + '</p>' +
      '<div class="form-actions" style="border-top:0;padding-top:0">' +
        '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
        '<button type="button" class="btn btn-primary" id="confirmOk" style="background:#a63d2f;box-shadow:none">确认删除</button>' +
      '</div>';
    openModal(html, 'modal-form');
    $('#confirmOk').addEventListener('click', function () {
      closeModal();
      onConfirm();
    });
  }

  /* ---------------- Data access ---------------- */

  function loadTerms() {
    state.loading = true;
    state.loadError = null;
    state.snapshot = false;
    renderBrowse();

    return withTimeout(
      Promise.resolve().then(function () {
        return cloud.database
          .from('terms')
          .select('id, term, category, short_def, detail, example, created_at')
          .order('id', { ascending: true })
          .limit(2000);
      }),
      15000,
      '连接云端数据库'
    ).then(function (res) {
      if (!res) throw new Error('云端返回了空响应');
      if (res.error) throw res.error;
      state.terms = (res.data || []).filter(function (t) { return t && t.term; });
      state.loading = false;
      state.loadError = null;
      renderBrowse();
      if (isAdminView()) renderAdmin();
    }).catch(function (err) {
      /* 云端读取失败 → 尝试本地快照 terms.json */
      return loadSnapshot().then(function (rows) {
        if (rows.length) {
          state.terms = rows;
          state.loading = false;
          state.loadError = null;
          state.snapshot = true;
          renderBrowse();
          if (isAdminView()) renderAdmin();
          return;
        }
        state.loading = false;
        state.loadError = describeError(err);
        state.terms = [];
        state.snapshot = false;
        renderBrowse();
        if (isAdminView()) renderAdmin();
      });
    });
  }

  function isAdminView() {
    return (location.hash.replace(/^#\/?/, '') || '') === 'admin';
  }

  /* 云端读不到时（如 GitHub Pages 等镜像域名被网关拦截），退回本地词条快照 */
  function loadSnapshot() {
    return withTimeout(
      fetch('./terms.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }),
      8000,
      '读取本地词条快照'
    ).then(function (rows) {
      return (Array.isArray(rows) ? rows : []).filter(function (t) { return t && t.term; });
    }).catch(function () {
      return [];
    });
  }

  /* 保留发布链接上的业务参数（sharecode 等），只去掉登录回调参数 */
  function keepQuery() {
    var u = new URL(location.href);
    ['code', 'state', 'provider'].forEach(function (k) { u.searchParams.delete(k); });
    return u.search || '';
  }

  function isLocalPreview() {
    if (location.protocol === 'file:') return true;
    return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(location.hostname || '');
  }

  /* ---------------- Admin ---------------- */

  var pendingOtp = null;
  var resendTimer = null;

  function renderAdmin() {
    if (!cloud) {
      $('#adminLogin').hidden = true;
      $('#adminDash').hidden = true;
      toast('云端服务加载失败，请刷新页面重试', 'err');
      return;
    }
    var loggedIn = !!state.session;
    $('#adminLogin').hidden = loggedIn;
    $('#adminDash').hidden = !loggedIn;

    var statusNode = $('#cloudStatus');
    if (statusNode) {
      statusNode.className = 'cloud-status';
      if (state.loading) {
        statusNode.textContent = '正在检查云端连接…';
      } else if (state.snapshot) {
        statusNode.className = 'cloud-status is-bad';
        statusNode.textContent = '云端数据库：当前域名无法连接（正在显示本地快照）。请到官方站点进行登录和管理。';
      } else if (state.loadError) {
        statusNode.className = 'cloud-status is-bad';
        statusNode.textContent = '云端数据库：连接异常（' + (state.loadError.kind === 'credential' ? '凭据被拒绝' : state.loadError.title) + '）';
      } else {
        statusNode.className = 'cloud-status is-ok';
        statusNode.textContent = '云端数据库：正常，已加载 ' + state.terms.length + ' 条词条';
      }
    }

    if (!loggedIn) {
      pendingOtp = null;
      var methods = $('#loginMethods');
      var ro = $('#loginReadonly');
      if (methods && ro) {
        methods.hidden = !!state.snapshot;
        ro.hidden = !state.snapshot;
      }
      return;
    }

    var user = state.session.user || {};
    var who = user.name || user.nickname || '已登录';
    $('#adminWho').textContent = who + ' · 已登录，可编辑全部词条' +
      (state.loadError ? '（注意：当前云端连接异常，保存可能失败）' : '');
    renderAdminList();
  }

  function renderAdminList() {
    var q = state.adminQuery.trim().toLowerCase();
    var list = sortedTerms().filter(function (t) {
      if (!q) return true;
      return [t.term, t.category, t.short_def].join(' ').toLowerCase().indexOf(q) !== -1;
    });

    $('#adminCount').textContent = '共 ' + state.terms.length + ' 条' + (q ? '，匹配 ' + list.length + ' 条' : '');

    if (!list.length) {
      $('#adminList').innerHTML = '<div class="admin-empty">' +
        (state.terms.length ? '没有匹配的词条' : '还没有词条，点右上角「＋ 新增词条」开始添加。') +
        '</div>';
      return;
    }

    $('#adminList').innerHTML = list.map(function (t) {
      return '<div class="row">' +
        '<div class="row-main">' +
          '<div class="row-title"><span class="badge" style="' + catVars(t.category) + '">' +
            esc(t.category) + '</span><strong>' + esc(t.term) + '</strong></div>' +
          '<p class="row-def">' + esc(t.short_def) + '</p>' +
        '</div>' +
        '<div class="row-actions">' +
          '<button class="btn btn-mini" data-edit="' + esc(t.id) + '">编辑</button>' +
          '<button class="btn btn-mini btn-danger" data-del="' + esc(t.id) + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function openEditor(id) {
    var term = null;
    if (id != null) {
      for (var i = 0; i < state.terms.length; i++) {
        if (String(state.terms[i].id) === String(id)) { term = state.terms[i]; break; }
      }
      if (!term) return;
    }

    var cats = allCategories();
    if (term && term.category && cats.indexOf(term.category) === -1) cats.push(term.category);

    var options = cats.map(function (c) {
      return '<option value="' + esc(c) + '"' + (term && term.category === c ? ' selected' : '') + '>' +
        esc(c) + '</option>';
    }).join('') + '<option value="__new">＋ 新增分类…</option>';

    var html = '<button class="modal-close" data-close aria-label="关闭">✕</button>' +
      '<h2 class="modal-title">' + (term ? '编辑词条' : '新增词条') + '</h2>' +
      '<form class="form" id="termForm" novalidate>' +
        '<label class="field"><span>名词 <i>*</i></span>' +
          '<input name="term" maxlength="60" placeholder="例如：机会成本" value="' + esc(term ? term.term : '') + '"></label>' +
        '<label class="field"><span>分类 <i>*</i></span>' +
          '<select name="category" id="catSelect">' + options + '</select></label>' +
        '<label class="field" id="newCatField" hidden><span>新分类名称</span>' +
          '<input name="newCategory" maxlength="20" placeholder="例如：计量经济学"></label>' +
        '<label class="field"><span>简短定义 <i>*</i></span>' +
          '<textarea name="short_def" rows="2" maxlength="300" placeholder="一句话说清它是什么">' +
            esc(term ? term.short_def : '') + '</textarea></label>' +
        '<label class="field"><span>详细解释</span>' +
          '<textarea name="detail" rows="6" maxlength="3000" placeholder="展开说说它的来龙去脉、成立条件和常见误解">' +
            esc(term ? (term.detail || '') : '') + '</textarea></label>' +
        '<label class="field"><span>生活例子</span>' +
          '<textarea name="example" rows="4" maxlength="1500" placeholder="用一个日常场景让它落地">' +
            esc(term ? (term.example || '') : '') + '</textarea></label>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn btn-ghost" data-close>取消</button>' +
          '<button type="submit" class="btn btn-primary" id="btnSave">保存</button>' +
        '</div>' +
      '</form>';

    openModal(html, 'modal-form');

    var form = $('#termForm');
    var select = $('#catSelect');
    var newCatField = $('#newCatField');

    select.addEventListener('change', function () {
      newCatField.hidden = select.value !== '__new';
      if (!newCatField.hidden) $('#newCatField input').focus();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var category = String(fd.get('category') || '');
      if (category === '__new') category = String(fd.get('newCategory') || '').trim();

      var payload = {
        term: String(fd.get('term') || '').trim(),
        category: category.trim(),
        short_def: String(fd.get('short_def') || '').trim(),
        detail: String(fd.get('detail') || '').trim(),
        example: String(fd.get('example') || '').trim()
      };

      if (!payload.term) return toast('请填写名词', 'err');
      if (!payload.category) return toast('请选择或填写分类', 'err');
      if (!payload.short_def) return toast('请填写简短定义', 'err');

      var btn = $('#btnSave');
      btn.disabled = true;
      btn.textContent = '保存中…';

      saveTerm(payload, term ? term.id : null).then(function () {
        closeModal();
        toast(term ? '已更新词条' : '已新增词条', 'ok');
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = '保存';
        toast(describeError(err).message || '保存失败，请重试', 'err');
      });
    });
  }

  function saveTerm(payload, id) {
    payload.updated_at = new Date().toISOString();

    if (id != null) {
      return cloud.database.from('terms').update(payload).eq('id', id).select().then(function (res) {
        if (res.error) throw res.error;
        if (!Array.isArray(res.data) || !res.data.length) {
          throw new Error('没有更新任何数据，可能是登录已失效，请重新登录');
        }
        return loadTerms();
      });
    }

    return cloud.database.from('terms').insert(payload).select().then(function (res) {
      if (res.error) throw res.error;
      if (!Array.isArray(res.data) || !res.data.length) {
        throw new Error('新增失败，请确认登录状态后重试');
      }
      return loadTerms();
    });
  }

  function deleteTerm(id) {
    return cloud.database.from('terms').delete().eq('id', id).select().then(function (res) {
      if (res.error) throw res.error;
      if (!Array.isArray(res.data) || !res.data.length) {
        throw new Error('没有删除任何数据，可能已不存在或登录已失效');
      }
      toast('已删除词条', 'ok');
      return loadTerms();
    }).catch(function (err) {
      toast(describeError(err).message || '删除失败，请重试', 'err');
    });
  }

  /* ---------------- Auth ---------------- */

  function setSession(session) {
    state.session = session || null;
  }

  function refreshSession() {
    return cloud.auth.getSession().then(function (res) {
      setSession(res && res.data ? res.data : null);
    }).catch(function () {
      setSession(null);
    });
  }

  function signInWithWorkBuddy() {
    if (typeof cloud.auth.signInWithOAuth !== 'function') {
      showLoginError('当前环境暂不支持该登录方式，请改用邮箱验证码');
      return;
    }
    sessionStorage.setItem('econ.wantAdmin', '1');

    // 保留当前地址上的业务参数（例如发布链接的 sharecode），否则登录回来会被挡在门外
    var back = new URL(location.href);
    back.pathname = '/';
    back.hash = '#admin';
    ['code', 'state', 'provider'].forEach(function (k) { back.searchParams.delete(k); });

    cloud.auth.signInWithOAuth({ provider: 'workbuddy', redirectTo: back.toString() })
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.url) throw new Error('无法发起登录，请稍后重试');
        location.assign(res.data.url);
      })
      .catch(function (err) {
        sessionStorage.removeItem('econ.wantAdmin');
        showLoginError(errText(err, 'WorkBuddy 登录暂不可用，请改用邮箱验证码'));
      });
  }

  function showLoginError(message) {
    var node = $('#loginError');
    if (!message) { node.hidden = true; node.textContent = ''; return; }
    node.hidden = false;
    node.textContent = message;
  }

  function sendEmailCode() {
    if (typeof cloud.auth.sendOtp !== 'function') {
      showLoginError('当前环境暂不支持邮箱验证码，请使用 WorkBuddy 账号登录');
      return Promise.resolve();
    }
    var email = $('#email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showLoginError('请输入正确的邮箱地址');
      return Promise.resolve();
    }
    showLoginError('');

    var btn = $('#btnSendCode');
    btn.disabled = true;
    btn.textContent = '发送中…';

    return cloud.auth.sendOtp({ email: email }).then(function (res) {
      if (res.error) throw res.error;
      pendingOtp = {
        email: email,
        verificationId: res.data.verificationId,
        isExistingUser: res.data.isExistingUser
      };
      toast('验证码已发送，请查看邮箱', 'ok');
      startResendCountdown();
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = '获取验证码';
      showLoginError(errText(err, '验证码发送失败，请稍后重试'));
    });
  }

  function startResendCountdown() {
    var btn = $('#btnSendCode');
    var left = 60;
    clearInterval(resendTimer);
    btn.disabled = true;
    btn.textContent = left + 's 后重发';
    resendTimer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(resendTimer);
        btn.disabled = false;
        btn.textContent = '重新获取';
        return;
      }
      btn.textContent = left + 's 后重发';
    }, 1000);
  }

  function submitEmailLogin() {
    var email = $('#email').value.trim();
    var code = $('#otp').value.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showLoginError('请输入正确的邮箱地址');
      return Promise.resolve();
    }
    if (!pendingOtp || pendingOtp.email !== email) {
      showLoginError('请先为当前邮箱获取验证码');
      return Promise.resolve();
    }
    if (!/^\d{4,8}$/.test(code)) {
      showLoginError('请输入收到的验证码');
      return Promise.resolve();
    }

    showLoginError('');
    var btn = $('#btnLogin');
    btn.disabled = true;
    btn.textContent = '登录中…';

    return cloud.auth.verifyOtp({
      email: pendingOtp.email,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token: code
    }).then(function (res) {
      if (res.error) throw res.error;
      pendingOtp = null;
      setSession(res.data);
      btn.disabled = false;
      btn.textContent = '登录';
      $('#otp').value = '';
      toast('登录成功', 'ok');
      renderAdmin();
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = '登录';
      showLoginError(errText(err, '登录失败，请检查验证码'));
    });
  }

  function logout() {
    cloud.auth.signOut().then(function () {
      setSession(null);
      renderAdmin();
      toast('已退出登录');
    }).catch(function () {
      toast('退出失败，请稍后重试', 'err');
    });
  }

  /* ---------------- OAuth callback dispatcher ---------------- */

  function handleCallback() {
    var url = new URL(location.href);
    var hasCode = url.searchParams.has('code');
    var hasError = url.searchParams.has('error');
    if (!hasCode && !hasError) return Promise.resolve(false);

    var provider = url.searchParams.get('provider');
    if (provider !== 'workbuddy' && provider !== 'wechat') return Promise.resolve(false);

    var handler = provider === 'workbuddy'
      ? cloud.auth.handleWorkBuddyCallback
      : cloud.auth.handleWechatWebCallback;

    if (typeof handler !== 'function') {
      showLoginError('当前登录方式暂不可用，请改用邮箱验证码');
      return Promise.resolve(false);
    }

    return handler.call(cloud.auth).then(function (res) {
      if (res.error) {
        var msg = errText(res.error, '登录未完成，请重试');
        sessionStorage.removeItem('econ.wantAdmin');
        if (!isAdminView()) history.replaceState(null, '', url.pathname + keepQuery() + '#admin');
        showLoginError(msg);
        toast(msg, 'err');
        return false;
      }
      if (res.data) {
        ['code', 'state', 'provider'].forEach(function (k) { url.searchParams.delete(k); });
        history.replaceState(null, '', url.pathname + url.search + url.hash);
        setSession(res.data);
        sessionStorage.setItem('econ.wantAdmin', '1');
        return true;
      }
      return false;
    }).catch(function (err) {
      var msg = errText(err, '登录未完成，请重试');
      if (!isAdminView()) history.replaceState(null, '', url.pathname + keepQuery() + '#admin');
      showLoginError(msg);
      toast(msg, 'err');
      return false;
    });
  }

  /* ---------------- Routing ---------------- */

  function route() {
    var admin = isAdminView();
    $('#view-browse').hidden = admin;
    $('#view-admin').hidden = !admin;
    $('#navBrowse').classList.toggle('is-active', !admin);
    $('#navAdmin').classList.toggle('is-active', admin);
    if (admin) {
      renderAdmin();
      document.title = '管理后台 · 经济学词典';
    } else {
      document.title = '经济学词典 · 名词解释';
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------------- Event wiring ---------------- */

  function wire() {
    var search = $('#search');
    search.addEventListener('input', function () {
      state.query = search.value;
      $('#clearSearch').hidden = !search.value;
      renderBrowse();
    });

    $('#clearSearch').addEventListener('click', function () {
      search.value = '';
      state.query = '';
      $('#clearSearch').hidden = true;
      renderBrowse();
      search.focus();
    });

    $('#chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      state.category = chip.getAttribute('data-cat') || '全部';
      renderBrowse();
    });

    $('#grid').addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      openDetail(card.getAttribute('data-id'));
    });

    $('#btnResetFilter').addEventListener('click', function (e) {
      if (e.currentTarget.getAttribute('data-mode') === 'retry') {
        loadTerms();
        return;
      }
      search.value = '';
      state.query = '';
      state.category = '全部';
      $('#clearSearch').hidden = true;
      renderBrowse();
    });

    var overlay = $('#overlay');
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    $('#modal').addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) closeModal();
      if (e.key === '/' && document.activeElement !== $('#search') && !isAdminView()) {
        e.preventDefault();
        $('#search').focus();
      }
    });

    $('#navBrowse').addEventListener('click', function () {
      if (!location.hash || location.hash === '#admin') {
        history.replaceState(null, '', location.pathname + keepQuery());
        route();
      }
    });

    $('#brandLink').addEventListener('click', function (e) {
      e.preventDefault();
      history.replaceState(null, '', location.pathname + keepQuery());
      route();
    });

    /* admin */
    $('#btnWorkbuddy').addEventListener('click', signInWithWorkBuddy);
    $('#btnSendCode').addEventListener('click', sendEmailCode);
    $('#btnLogin').addEventListener('click', submitEmailLogin);
    $('#otp').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitEmailLogin();
    });
    $('#btnLogout').addEventListener('click', logout);
    $('#btnNew').addEventListener('click', function () { openEditor(null); });

    $('#adminSearch').addEventListener('input', function () {
      state.adminQuery = $('#adminSearch').value;
      renderAdminList();
    });

    $('#adminList').addEventListener('click', function (e) {
      var editBtn = e.target.closest('[data-edit]');
      if (editBtn) { openEditor(editBtn.getAttribute('data-edit')); return; }

      var delBtn = e.target.closest('[data-del]');
      if (delBtn) {
        var id = delBtn.getAttribute('data-del');
        var name = '';
        for (var i = 0; i < state.terms.length; i++) {
          if (String(state.terms[i].id) === String(id)) { name = state.terms[i].term; break; }
        }
        confirmDialog('删除「' + name + '」？', '删除后不可恢复，访客也将看不到这条词条。', function () {
          deleteTerm(id);
        });
      }
    });

    window.addEventListener('hashchange', route);
  }

  /* ---------------- Boot ---------------- */

  function boot() {
    wire();

    if (!cloud) {
      state.loading = false;
      state.loadError = {
        kind: 'sdk',
        title: '云端组件没有加载成功',
        message: '页面的云端脚本没有加载完成，通常是网络问题。请刷新页面重试；如果一直在加载，请检查网络或稍后再试。',
        detail: 'window.WorkBuddyCloud 未就绪'
      };
      renderBrowse();
      route();
      return;
    }

    if (typeof cloud.auth.onAuthStateChange === 'function') {
      cloud.auth.onAuthStateChange(function (event, session) {
        if (event === 'SIGNED_OUT') setSession(null);
        else if (session) setSession(session);
      });
    }

    handleCallback()
      .then(refreshSession)
      .then(function () {
        if (sessionStorage.getItem('econ.wantAdmin') === '1') {
          sessionStorage.removeItem('econ.wantAdmin');
          if (!isAdminView()) {
            history.replaceState(null, '', location.pathname + '#admin');
          }
        }
        route();
        return loadTerms();
      })
      .catch(function () {
        route();
        return loadTerms();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
