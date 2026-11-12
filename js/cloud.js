/*
 * cloud.js
 * 会社ごとのデータをクラウド（Googleスプレッドシート＋Apps Script）へ保存し、
 * 専用URL（?id=...）からいつでも呼び出せるようにする機能。
 * バックエンド未設定でもアプリ自体はこれまで通りローカル保存のみで動作する
 * （このファイルの機能はすべてオプトイン）。
 */

const GAS_ENDPOINT_KEY = 'bkPlanSimulator.gasEndpoint';

function getGasEndpoint() {
  try { return localStorage.getItem(GAS_ENDPOINT_KEY) || ''; } catch (e) { return ''; }
}
function setGasEndpoint(url) {
  try { localStorage.setItem(GAS_ENDPOINT_KEY, url); } catch (e) { /* noop */ }
}

function getCloudIdFromUrl() {
  const params = new URLSearchParams(location.search);
  return params.get('id') || '';
}

let currentCloudId = getCloudIdFromUrl();

function setCloudUrlParam(id) {
  currentCloudId = id;
  const url = new URL(location.href);
  url.searchParams.set('id', id);
  history.replaceState(null, '', url.toString());
}

function buildCloudMeta() {
  try {
    // 必要契約件数/月は計算のたびに目標契約件数へ同期されるため、1回では収束しきらないことがある。
    // 保存する営業損益が画面表示と一致するよう、2回計算して収束させてから採用する。
    runFullCalculation(appState);
    const result = runFullCalculation(appState);
    return {
      openDate: appState.meta.openDate || '',
      year1OperatingIncome: result.summary.year1.operatingIncome,
      year2OperatingIncome: result.summary.year2.operatingIncome
    };
  } catch (e) {
    return {};
  }
}

/* ===================== クラウド保存モーダル ===================== */
function ensureCloudModal() {
  if (document.getElementById('cloudModalOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'cloudModalOverlay';
  overlay.className = 'cloud-modal-overlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div class="cloud-modal" role="dialog" aria-modal="true">
      <button type="button" class="cloud-modal-close" id="cloudModalCloseBtn" aria-label="閉じる">✕</button>
      <div id="cloudModalBody"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCloudModal(); });
  document.getElementById('cloudModalCloseBtn').onclick = closeCloudModal;
}
function openCloudModal(html, wide) {
  ensureCloudModal();
  document.getElementById('cloudModalBody').innerHTML = html;
  document.querySelector('#cloudModalOverlay .cloud-modal').classList.toggle('wide', !!wide);
  document.getElementById('cloudModalOverlay').style.display = 'flex';
}
function closeCloudModal() {
  const overlay = document.getElementById('cloudModalOverlay');
  if (overlay) overlay.style.display = 'none';
}

function renderSettingsForm(opts) {
  opts = opts || {};
  const current = getGasEndpoint();
  return `
    <h3>クラウド保存の設定</h3>
    <p class="small text-muted">Googleスプレッドシート＋Apps Scriptで発行したウェブアプリのURLを貼り付けてください。設定方法は同梱の README_GAS_SETUP.md をご覧ください。</p>
    <div class="field">
      <label>Apps ScriptウェブアプリのURL</label>
      <input type="text" id="gasEndpointInput" value="${esc(current)}" placeholder="https://script.google.com/macros/s/xxxxx/exec" autocomplete="off" style="width:100%">
    </div>
    ${opts.error ? `<p class="small" style="color:var(--color-warn)">${esc(opts.error)}</p>` : ''}
    <div class="field-row" style="margin-top:14px">
      <button type="button" class="btn-gold" id="gasEndpointSaveBtn">保存${opts.thenSave ? 'して保存を続ける' : ''}</button>
      <button type="button" class="btn-outline" id="gasEndpointCancelBtn">キャンセル</button>
    </div>`;
}

function openSettingsModal(thenSave) {
  openCloudModal(renderSettingsForm({ thenSave }));
  document.getElementById('gasEndpointCancelBtn').onclick = closeCloudModal;
  document.getElementById('gasEndpointSaveBtn').onclick = () => {
    const url = document.getElementById('gasEndpointInput').value.trim();
    if (!url) { openCloudModal(renderSettingsForm({ thenSave, error: 'URLを入力してください。' })); return; }
    setGasEndpoint(url);
    if (thenSave) saveToCloud();
    else closeCloudModal();
  };
}

function renderSavingState() {
  return `<h3>保存中…</h3><p class="text-muted">スプレッドシートへ保存しています。しばらくお待ちください。</p>`;
}

function renderSaveSuccess(id, companyName) {
  const url = new URL(location.href);
  url.searchParams.set('id', id);
  const shareUrl = url.toString();
  return `
    <h3>保存しました</h3>
    <p class="small text-muted">${esc(companyName)} 様専用のURLです。このURLを開くと、いつでもこの続きから編集できます。</p>
    <div class="field">
      <input type="text" id="cloudShareUrlInput" value="${esc(shareUrl)}" readonly style="width:100%" onclick="this.select()">
    </div>
    <div class="field-row" style="margin-top:10px">
      <button type="button" class="btn-gold" id="cloudCopyBtn">URLをコピー</button>
      <button type="button" class="btn-outline" id="cloudCloseBtn">閉じる</button>
    </div>
    <p class="small text-muted" style="margin-top:10px">※このURLを知っている人は誰でも閲覧・編集できます。共有先にはご注意ください。</p>`;
}

function saveToCloud() {
  if (serverMode) { saveToServer(); return; }
  const endpoint = getGasEndpoint();
  if (!endpoint) { openSettingsModal(true); return; }
  openCloudModal(renderSavingState());
  const payload = {
    id: currentCloudId || undefined,
    companyName: appState.meta.companyName || '',
    data: appState,
    meta: buildCloudMeta()
  };
  fetch(endpoint, { method: 'POST', body: JSON.stringify(payload) })
    .then(res => res.json())
    .then(json => {
      if (!json.ok) throw new Error(json.error || '保存に失敗しました');
      setCloudUrlParam(json.id);
      openCloudModal(renderSaveSuccess(json.id, appState.meta.companyName || '（会社名未入力）'));
      const copyBtn = document.getElementById('cloudCopyBtn');
      if (copyBtn) copyBtn.onclick = () => {
        const input = document.getElementById('cloudShareUrlInput');
        input.select();
        try { document.execCommand('copy'); copyBtn.textContent = 'コピーしました'; } catch (e) { /* noop */ }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(input.value).then(() => { copyBtn.textContent = 'コピーしました'; }).catch(() => {});
        }
      };
      const closeBtn = document.getElementById('cloudCloseBtn');
      if (closeBtn) closeBtn.onclick = closeCloudModal;
    })
    .catch(err => {
      openCloudModal(renderSettingsForm({ error: '保存に失敗しました：' + (err && err.message ? err.message : String(err)) }));
      document.getElementById('gasEndpointCancelBtn').onclick = closeCloudModal;
      document.getElementById('gasEndpointSaveBtn').onclick = () => {
        const url = document.getElementById('gasEndpointInput').value.trim();
        if (!url) return;
        setGasEndpoint(url);
        saveToCloud();
      };
    });
}

// ?id=... を伴ってアクセスされた場合、起動時にクラウドから該当データを読み込む。
// 成功時はtrueを返し、呼び出し元でその後の描画を行う。失敗時はローカルの状態のまま続行する。
function loadFromCloud(id) {
  if (serverMode) return loadFromServer(id);
  const endpoint = getGasEndpoint();
  if (!endpoint) {
    // このブラウザにエンドポイント未設定の状態で共有URLを開いた場合：設定を促す
    return Promise.resolve({ ok: false, needsSetup: true });
  }
  const url = new URL(endpoint);
  url.searchParams.set('id', id);
  return fetch(url.toString())
    .then(res => res.json())
    .then(json => {
      if (json.ok && json.data) {
        appState = fixCorruptedPercentFields(deepMerge(createDefaultState(), json.data));
        saveState();
        currentCloudId = id;
        return { ok: true };
      }
      return { ok: false, error: json.error };
    })
    .catch(err => ({ ok: false, error: String(err) }));
}

function initCloudUI() {
  const saveBtn = document.getElementById('cloudSaveBtn');
  const settingsBtn = document.getElementById('cloudSettingsBtn');
  if (saveBtn) saveBtn.onclick = () => saveToCloud();
  if (serverMode) { initServerUI(saveBtn, settingsBtn); return; }
  if (settingsBtn) settingsBtn.onclick = () => openSettingsModal(false);
}


/* ===================== サーバー保存モード（Railway等で公開した場合） =====================
 * このアプリを server.js 経由で開いている場合は、同じサーバーの /api に会社ごとのデータを
 * 保存する（Googleスプレッドシート不要）。GitHub Pages等で開いた場合は従来のGAS方式のまま。 */
let serverMode = false;
const ADMIN_PW_KEY = 'bkPlanSimulator.adminPw';

function detectServerMode() {
  return fetch('api/health', { cache: 'no-store' })
    .then(res => (res.ok ? res.json() : null))
    .then(j => { serverMode = !!(j && j.ok && j.app === 'bk-plan'); return serverMode; })
    .catch(() => false);
}
function getAdminPw() { try { return sessionStorage.getItem(ADMIN_PW_KEY) || ''; } catch (e) { return ''; } }
function setAdminPw(v) { try { sessionStorage.setItem(ADMIN_PW_KEY, v); } catch (e) { /* noop */ } }
function appPageBase() { return location.origin + location.pathname; }
function shareUrlFor(id) { return appPageBase() + '?id=' + id; }

function apiCall(method, path, body, withAdmin) {
  const headers = { 'Content-Type': 'application/json' };
  if (withAdmin) headers['x-admin-password'] = getAdminPw();
  return fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(res => res.json().catch(() => ({ ok: false, error: '応答を読み取れませんでした' })).then(j => { j.status = res.status; return j; }));
}

function loadFromServer(id) {
  return apiCall('GET', 'api/companies/' + encodeURIComponent(id))
    .then(json => {
      if (json.ok && json.data) {
        appState = fixCorruptedPercentFields(deepMerge(createDefaultState(), json.data));
        saveState();
        currentCloudId = id;
        return { ok: true };
      }
      return { ok: false, error: json.error };
    })
    .catch(err => ({ ok: false, error: String(err) }));
}

function payloadFor(state, name) {
  const st = JSON.parse(JSON.stringify(state));
  st.meta = Object.assign({}, st.meta, { companyName: name });
  return { companyName: name, data: st, meta: buildCloudMeta() };
}

function afterServerSave(id, name) {
  setCloudUrlParam(id);
  openCloudModal(renderServerSaved(id, name));
  const copyBtn = document.getElementById('cloudCopyBtn');
  if (copyBtn) copyBtn.onclick = () => {
    const input = document.getElementById('cloudShareUrlInput');
    input.select();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(() => { copyBtn.textContent = 'コピーしました'; }).catch(() => {});
    try { document.execCommand('copy'); copyBtn.textContent = 'コピーしました'; } catch (e) { /* noop */ }
  };
  const closeBtn = document.getElementById('cloudCloseBtn');
  if (closeBtn) closeBtn.onclick = closeCloudModal;
}
function renderServerSaved(id, name) {
  return `
    <h3>保存しました</h3>
    <p class="small text-muted">${esc(name)} 様専用のURLです。このURLを開くと、いつでもこの続きから編集できます。</p>
    <div class="field"><input type="text" id="cloudShareUrlInput" value="${esc(shareUrlFor(id))}" readonly style="width:100%" onclick="this.select()"></div>
    <div class="field-row" style="margin-top:10px">
      <button type="button" class="btn-gold" id="cloudCopyBtn">URLをコピー</button>
      <button type="button" class="btn-outline" id="cloudCloseBtn">閉じる</button>
    </div>
    <p class="small text-muted" style="margin-top:10px">※このURLを知っている人は誰でも閲覧・編集できます。共有先にはご注意ください。</p>`;
}

function nameFormHtml(opts) {
  return `
    <h3>${esc(opts.title)}</h3>
    <p class="small text-muted">${opts.desc}</p>
    <div class="field">
      <label>会社名</label>
      <input type="text" id="serverNameInput" value="${esc(opts.value || '')}" placeholder="例：株式会社○○不動産" autocomplete="off" style="width:100%">
    </div>
    <p class="small" id="serverNameError" style="color:var(--color-warn);min-height:1.2em"></p>
    <div class="field-row" style="margin-top:8px">
      <button type="button" class="btn-gold" id="serverNameOk">${esc(opts.okLabel)}</button>
      <button type="button" class="btn-outline" id="serverNameCancel">キャンセル</button>
    </div>`;
}
// 会社名入力モーダルを開き、確定された名前で onSubmit(name) を呼ぶ（Promiseを返す関数）
function askCompanyName(opts, onSubmit) {
  openCloudModal(nameFormHtml(opts));
  const input = document.getElementById('serverNameInput');
  const err = document.getElementById('serverNameError');
  input.focus(); input.select();
  document.getElementById('serverNameCancel').onclick = () => { if (opts.onCancel) opts.onCancel(); else closeCloudModal(); };
  const submit = () => {
    const name = input.value.trim();
    if (!name) { err.textContent = '会社名を入力してください。'; return; }
    const ok = document.getElementById('serverNameOk'); ok.disabled = true; ok.textContent = '保存中…';
    onSubmit(name).catch(e => {
      ok.disabled = false; ok.textContent = opts.okLabel;
      err.textContent = '失敗しました：' + (e && e.message ? e.message : e);
    });
  };
  document.getElementById('serverNameOk').onclick = submit;
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submit(); });
}

function failIfNotOk(json) { if (!json.ok) throw new Error(json.error || '保存に失敗しました'); return json; }

// 「保存」：保存済みの会社ならそのまま上書き、未保存なら会社名を確認して新規保存
function saveToServer() {
  if (currentCloudId) {
    const name = appState.meta.companyName || '（会社名未入力）';
    openCloudModal(renderSavingState());
    apiCall('PUT', 'api/companies/' + currentCloudId, payloadFor(appState, appState.meta.companyName || ''))
      .then(failIfNotOk).then(() => afterServerSave(currentCloudId, name))
      .catch(e => {
        openCloudModal(`<h3>保存に失敗しました</h3><p class="small" style="color:var(--color-warn)">${esc(e.message)}</p><button type="button" class="btn-outline" id="cloudCloseBtn">閉じる</button>`);
        document.getElementById('cloudCloseBtn').onclick = closeCloudModal;
      });
    return;
  }
  askCompanyName({
    title: '新しい会社として保存', value: appState.meta.companyName,
    desc: 'この内容を会社別のデータとして保存し、専用URLを発行します。', okLabel: '保存してURLを発行'
  }, name => apiCall('POST', 'api/companies', payloadFor(appState, name)).then(failIfNotOk).then(j => {
    appState.meta.companyName = name; saveState(); afterServerSave(j.id, name); if (typeof setActiveView === 'function') setActiveView(activeView);
  }));
}

// 「コピーして新規作成」：いま画面にある内容を丸ごとコピーして、別会社用のデータを作る（元は変更しない）
function copyAsNewCompany() {
  askCompanyName({
    title: 'コピーして別の会社用を作成',
    desc: 'いま画面にある内容をそのままコピーして、新しい会社用のデータを作ります。元のデータは変わりません。作成後は新しい会社の専用URLに切り替わります。',
    value: '', okLabel: 'コピーを作成'
  }, name => apiCall('POST', 'api/companies', Object.assign(payloadFor(appState, name), { copiedFrom: currentCloudId || undefined })).then(failIfNotOk).then(j => {
    appState.meta.companyName = name; appState.meta.createdAt = new Date().toISOString().slice(0, 10); saveState();
    afterServerSave(j.id, name); if (typeof setActiveView === 'function') setActiveView(activeView);
  }));
}

/* ---- 会社一覧（保存済みの会社を貯めて管理） ---- */
function openCompanyList(msg) {
  openCloudModal('<h3>会社一覧</h3><p class="text-muted">読み込み中…</p>', true);
  apiCall('GET', 'api/companies', undefined, true).then(json => {
    if (json.status === 401 || json.status === 403) { renderAdminLogin(json.error); return; }
    if (!json.ok) { openCloudModal(`<h3>会社一覧</h3><p style="color:var(--color-warn)">${esc(json.error || '読み込みに失敗しました')}</p>`, true); return; }
    renderCompanyList(json.companies, msg);
  }).catch(e => openCloudModal(`<h3>会社一覧</h3><p style="color:var(--color-warn)">${esc(String(e))}</p>`, true));
}
function renderAdminLogin(err) {
  openCloudModal(`
    <h3>会社一覧</h3>
    <p class="small text-muted">保存済みの会社一覧を見るには管理用パスワードが必要です。</p>
    <div class="field"><label>管理用パスワード</label><input type="password" id="adminPwInput" autocomplete="current-password" style="width:100%"></div>
    <p class="small" style="color:var(--color-warn);min-height:1.2em">${esc(getAdminPw() ? (err || '') : '')}</p>
    <div class="field-row"><button type="button" class="btn-gold" id="adminPwOk">開く</button><button type="button" class="btn-outline" id="adminPwCancel">キャンセル</button></div>`);
  const input = document.getElementById('adminPwInput'); input.focus();
  const go = () => { setAdminPw(input.value); openCompanyList(); };
  document.getElementById('adminPwOk').onclick = go;
  document.getElementById('adminPwCancel').onclick = closeCloudModal;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}
function fmtDateTime(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderCompanyList(list, msg) {
  const names = {}; list.forEach(c => { names[c.id] = c.companyName; });
  const rows = list.map(c => `
    <tr${c.id === currentCloudId ? ' class="row-highlight"' : ''}>
      <td>${esc(c.companyName || '（会社名なし）')}${c.copiedFrom && names[c.copiedFrom] ? `<div class="small text-muted">コピー元：${esc(names[c.copiedFrom])}</div>` : ''}</td>
      <td>${esc(c.openDate || '―')}</td>
      <td>${c.year1 === null ? '―' : yenAcctText(c.year1)}</td>
      <td>${c.year2 === null ? '―' : yenAcctText(c.year2)}</td>
      <td>${esc(fmtDateTime(c.updatedAt))}</td>
      <td class="company-actions">
        <button type="button" class="btn-gold btn-sm" data-act="open" data-id="${esc(c.id)}">開く</button>
        <button type="button" class="btn-outline btn-sm" data-act="copy" data-id="${esc(c.id)}">コピー</button>
        <button type="button" class="btn-ghost btn-sm" data-act="del" data-id="${esc(c.id)}">削除</button>
      </td>
    </tr>`).join('');
  openCloudModal(`
    <h3>会社一覧（${list.length}社）</h3>
    ${msg ? `<p class="small" style="color:var(--color-ok)">${esc(msg)}</p>` : ''}
    <div class="field-row" style="margin-bottom:10px">
      <button type="button" class="btn-gold btn-sm" id="listNewBtn">＋ 初期値から新規作成</button>
    </div>
    ${list.length ? `<div class="table-scroll"><table class="plain company-table">
      <thead><tr><th>会社名</th><th>オープン予定日</th><th>1年目 営業損益</th><th>2年目 営業損益</th><th>最終更新</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<p class="text-muted">まだ保存された会社がありません。「保存」またはコピーで会社を追加してください。</p>'}
    <p class="small text-muted" style="margin-top:10px">営業損益は最後に保存した時点の数字です。</p>`, true);

  document.getElementById('listNewBtn').onclick = () => askCompanyName({
    title: '初期値から新規作成', desc: '標準の初期値で、新しい会社用のデータを作ります。', value: '', okLabel: '作成して開く',
    onCancel: () => openCompanyList()
  }, name => {
    const st = createDefaultState(); st.meta.companyName = name;
    return apiCall('POST', 'api/companies', { companyName: name, data: st, meta: {} }).then(failIfNotOk)
      .then(j => { location.assign(shareUrlFor(j.id)); });
  });
  document.querySelectorAll('#cloudModalBody [data-act]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id'); const act = btn.getAttribute('data-act');
      const c = list.find(x => x.id === id);
      if (act === 'open') location.assign(shareUrlFor(id));
      if (act === 'copy') askCompanyName({
        title: `「${c.companyName}」をコピー`, desc: '保存済みの内容をそのままコピーして、別の会社用を作ります。', value: '', okLabel: 'コピーを作成',
        onCancel: () => openCompanyList()
      }, name => apiCall('POST', `api/companies/${id}/copy`, { companyName: name }).then(failIfNotOk).then(() => openCompanyList(`「${name}」を作成しました。`)));
      if (act === 'del' && confirm(`「${c.companyName}」のデータを完全に削除します。元に戻せません。よろしいですか？`)) {
        apiCall('DELETE', 'api/companies/' + id, undefined, true).then(j => {
          if (!j.ok) { alert(j.error || '削除できませんでした'); return; }
          if (id === currentCloudId) { currentCloudId = ''; const u = new URL(location.href); u.searchParams.delete('id'); history.replaceState(null, '', u.toString()); }
          openCompanyList('削除しました。');
        });
      }
    };
  });
}

function initServerUI(saveBtn, settingsBtn) {
  const box = document.querySelector('.cloud-actions');
  if (saveBtn) { saveBtn.textContent = '☁ 保存'; saveBtn.title = '会社別データとして保存し、専用URLを発行します'; }
  if (settingsBtn) settingsBtn.remove(); // GAS接続設定は不要
  if (!box || document.getElementById('cloudListBtn')) return;
  const mk = (id, text, title, fn) => { const b = document.createElement('button'); b.id = id; b.type = 'button'; b.className = 'btn-outline btn-sm'; b.textContent = text; b.title = title; b.onclick = fn; box.appendChild(b); };
  mk('cloudCopyNewBtn', '📋 コピーして新規作成', 'いまの内容を別の会社用にコピーします', () => copyAsNewCompany());
  mk('cloudListBtn', '📁 会社一覧', '保存済みの会社を一覧・管理します', () => openCompanyList());
}
