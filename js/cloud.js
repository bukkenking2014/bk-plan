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
function openCloudModal(html) {
  ensureCloudModal();
  document.getElementById('cloudModalBody').innerHTML = html;
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
        appState = deepMerge(createDefaultState(), json.data);
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
  if (settingsBtn) settingsBtn.onclick = () => openSettingsModal(false);
}
