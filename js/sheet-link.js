/*
 * sheet-link.js
 * 「給与整合性」「インセンティブ検討」「能力判定」「決定事項」は、数式つきのGoogleスプレッドシート
 * （物件王雛型のシートをそのまま移したもの）で運用する。このファイルは
 *   1. アプリの計算結果を、スプレッドシートの「連動データ」シートへ貼り付ける表に変換する
 *   2. 事業計画書に、スプレッドシートへのリンク欄を出す
 * を受け持つ。
 *
 * 連動データの行位置はスプレッドシート側（雛型の数式）と対応しているため、並びを変えないこと。
 */

// 雛型（Googleスプレッドシート）。「コピーを作成」で会社ごとのファイルを作る元。
const SHEET_TEMPLATE_URL = 'https://docs.google.com/spreadsheets/d/1H8em4V-B--ooagHGIrnfO_r9MmPAi2MvLKntBwzCE_w/edit';

const SHEET_TABS = [
  { name: '給与整合性', desc: 'スタッフごとの年収と必要売上の目安から、給与水準が適正かを判定' },
  { name: 'インセンティブ検討', desc: '成果・勤続・マネジメントの評価ごとのインセンティブ原資と配分' },
  { name: '能力判定', desc: '技能・個人評価を本人／指導者／店長の3者で採点し、ランク（S〜D）を判定' },
  { name: '決定事項', desc: 'エリア・反響目標・売上イメージの確認書（署名欄つき）' }
];

// 連動データ（A列＝項目、B列＝値）。1行目から貼り付ける。
function buildSheetLinkRows(state, result) {
  const st = state, r = result;
  const pl2 = r.pl2, bp = r.businessPlan, sum = r.summary;
  const roles = ['店長（経験者）', 'エージェント', 'エージェント', 'エージェント', 'サポート', 'サポート'];
  const sal = [
    r.staff.managers[0], r.staff.agents[0], r.staff.agents[1], r.staff.agents[2],
    r.staff.supports[0], r.staff.supports[1]
  ].map(v => Math.round(v || 0));
  const m0 = k => (pl2.lines[k] && pl2.lines[k][0]) || 0;
  const areas = st.areas || [];
  const areaRows = [];
  for (let i = 0; i < 3; i++) {
    const a = areas[i];
    areaRows.push([a ? (a.name || '') : '', a ? (Number(a.households) || 0) : 0]);
    areaRows.push(['', 0]); // 雛型は2行1組（エリア名／世帯数の組が2枠ずつ）
  }
  const estProps = areas.reduce((s, a) => s + ((Number(a.households) || 0) / 10000) * 100, 0);
  const y1 = sum.year1, y2 = sum.year2;
  const rows = [
    ['連動データ（事業計画シミュレーターからコピー）', ''],
    ['※このシートのA1を選んで貼り付けると、他のシートに反映されます', ''],
    ['社名', (st.meta && st.meta.companyName) || ''],
    ['スタッフ人数', r.staff.totalHeadcount]
  ];
  roles.forEach((role, i) => rows.push([role, sal[i]])); // 5〜10行目
  rows.push(
    ['法定福利費（月・全員分）', Math.round(m0('legalWelfare'))],
    ['旅費交通費（月）', Math.round(m0('travel'))],
    ['通信費（月）', Math.round(m0('communication'))],
    ['消耗品費（月）', Math.round(m0('consumables'))],
    ['事務用品費（月）', Math.round(m0('officeSupplies'))],
    ['諸会費（月）', Math.round(m0('dues'))],
    ['備品費（年額）', Math.round(r.otherCostsAnnual.equipmentLumpSum)],
    ['水道光熱費（月）', Math.round(m0('utilities'))],
    ['リース料（月）', Math.round(m0('lease'))],
    ['租税公課（月）', Math.round(m0('tax'))],
    ['雑費（月）', Math.round(m0('misc'))],
    ['研修費（月・コンサル費含む）', Math.round(m0('training') + m0('consulting'))],
    ['店舗経費（月）', Math.round(m0('storeRunning'))],
    ['想定売上（2年目・売上総損益 年間）', Math.round(pl2.grossProfitSumYear)],
    ['インセンティブ原資（年額・入力）', 0],
    ['予測物件数', Math.round(estProps)],
    ['会員登録目標/月', Math.round(bp.targetLeads)],
    ['広告予算/月', Math.round(bp.ppcBudgetMonth)],
    ['広告予算/オープンより半年（月額）', Math.round(bp.ppcBudgetBoosted)]
  );
  areaRows.forEach((ar, i) => rows.push([ar[0] || '', ar[1]])); // 30〜35行目
  rows.push(['エリア数', Math.max(1, areas.length)]);
  // 決定事項の「売上（粗利益）イメージ」：PLの各行（按分した利益）をそのまま示す
  const gp = (y, key) => Math.round(y[key].amount);
  rows.push(
    ['1年目 仲介手数料（粗利益）', Math.round(y1.brokerage.amount)],
    ['1年目 リフォーム（粗利益）', gp(y1, 'reform')],
    ['1年目 自社請負（粗利益）', gp(y1, 'selfBuild')],
    ['1年目 他社紹介（粗利益）', Math.round(y1.referral.amount)],
    ['2年目 仲介手数料（粗利益）', Math.round(y2.brokerage.amount)],
    ['2年目 リフォーム（粗利益）', gp(y2, 'reform')],
    ['2年目 自社請負（粗利益）', gp(y2, 'selfBuild')],
    ['2年目 他社紹介（粗利益）', Math.round(y2.referral.amount)]
  );
  return rows;
}

function sheetLinkTsv(state, result) {
  return buildSheetLinkRows(state, result)
    .map(r => r.map(v => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}

// クリップボードへコピー（Clipboard API が使えない環境向けに従来方式へフォールバック）
function copySheetLinkData() {
  const result = runFullCalculation(appState);
  const text = sheetLinkTsv(appState, result);
  const done = ok => alert(ok
    ? '連動データをコピーしました。\nスプレッドシートの「連動データ」シートのA1セルを選んで、貼り付け（Ctrl+V / ⌘V）してください。'
    : 'コピーできませんでした。ブラウザの権限をご確認ください。');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    done(ok);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true), fallback);
  } else fallback();
}

function sheetUrlValid(u) {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(String(u || '').trim());
}

// ---- 会社名 → ファイル名・フォルダ名（コンパクトに） ----
// 「株式会社」「有限会社」等と空白・記号を除き、20文字までにする。例：株式会社〇〇不動産 → 〇〇不動産
function compactCompanyName(name) {
  let n = String(name || '').replace(/[\s　]+/g, '');
  n = n.replace(/株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|（株）|\(株\)|㈱|（有）|\(有\)|㈲/g, '');
  n = n.replace(/[\\\/:*?"<>|]/g, '');
  return n.slice(0, 20);
}
function sheetFolderName() {
  const n = appState.meta && appState.meta.companyName;
  return isPlaceholderCompany(n) ? '' : compactCompanyName(n);
}
function sheetFileName() { const n = sheetFolderName(); return n ? n + '_事業計画' : ''; }
function isPlaceholderCompany(name) { return !String(name || '').trim() || /[〇○]{2,}/.test(String(name)); }

// ---- 自動作成（Apps Script：SheetFactory.gs）の接続設定 ----
// 配布版では SHEET_FACTORY_URL にデプロイしたウェブアプリのURLを直接書いておくと、全員がそのまま使える。
// 空のままでも、画面の「連携設定」から各自のブラウザに登録できる。
const SHEET_FACTORY_URL = 'https://script.google.com/macros/s/AKfycbwHlylbMuW--LhFesiS57mE0Mo9gW4RL7VY1U-z6UuuwhIp6I15LCJdXaD_FdmKwlrP/exec';
const SHEET_FACTORY_KEY = 'bkPlanSimulator.sheetFactory';
function getSheetFactory() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(SHEET_FACTORY_KEY) || '{}') || {}; } catch (e) { o = {}; }
  return { url: (o.url || SHEET_FACTORY_URL || '').trim(), key: o.key || '' };
}
function saveSheetFactory(url, key) {
  try { localStorage.setItem(SHEET_FACTORY_KEY, JSON.stringify({ url: (url || '').trim(), key: key || '' })); } catch (e) { /* noop */ }
}
function callSheetFactory(payload) {
  const f = getSheetFactory();
  if (!f.url) return Promise.reject(new Error('自動作成の連携先が未設定です'));
  // text/plain にすると、ブラウザの事前確認（CORSプリフライト）なしで送れる
  return fetch(f.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: f.key }, payload)) })
    .then(r => r.json())
    .then(j => { if (!j.ok) throw new Error(j.error || '失敗しました'); return j; });
}

// ---- 会社フォルダに入れる「シミュレーター結果（スプレッドシート）」と「アプリへのリンク」 ----
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function driveFileBaseName() { const n = sheetFolderName(); return n ? n + '_事業計画シミュレーター' : ''; }
// 保存済みの会社（専用URLあり）なら、このアプリの該当データを開くURL。未保存なら空
function currentAppUrl() {
  return (typeof currentCloudId !== 'undefined' && currentCloudId && typeof shareUrlFor === 'function') ? shareUrlFor(currentCloudId) : '';
}
async function driveFilesPayload() {
  const base = driveFileBaseName();
  const out = { companyName: (appState.meta && appState.meta.companyName) || '' };
  if (!base) return out;
  try {
    out.xlsxBase64 = bytesToBase64(await buildSummaryChartBytes());   // 「サマリー」「グラフ」だけの Excel
    out.xlsxName = base;
    out.simCells = buildSimCells(appState, runFullCalculation(appState));   // ひな形に書き込む値
  } catch (e) { console.warn('Excelの作成に失敗', e); }
  const url = currentAppUrl();
  if (url) { out.appUrl = url; out.linkName = base + '（リンク）'; }
  return out;
}
function filesWarn(j) { return j.filesError ? '\n\n※会社フォルダへのシミュレーター結果／リンクの保存に失敗しました：' + j.filesError : ''; }
function hashStr(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return String(h); }
function driveSyncSignature() {
  const st = Object.assign({}, appState); delete st.sheets;
  return hashStr(JSON.stringify(st) + '|' + currentAppUrl());
}

function createCompanySheet() {
  const name = (appState.meta && appState.meta.companyName) || '';
  if (isPlaceholderCompany(name)) {
    alert('先に「① 事業計画入力 → 基本情報」で会社名を入力してください。');
    return;
  }
  const result = runFullCalculation(appState);
  const btn = document.getElementById('sheetCreateBtn');
  if (btn) { btn.disabled = true; btn.textContent = '作成中…（10〜30秒かかります）'; }
  driveFilesPayload().then(files => callSheetFactory(Object.assign({
    action: 'create', companyName: name, folderName: sheetFolderName(), fileName: sheetFileName(),
    rows: buildSheetLinkRows(appState, result)
  }, files))).then(j => {
    appState.sheets = Object.assign({}, appState.sheets, { url: j.url, folderUrl: j.folderUrl });
    saveState(true);
    if (typeof scheduleCloudAutoSave === 'function') scheduleCloudAutoSave();
    driveSyncMarkDone();
    renderReport();
    const warn = (j.protectError ? '\n\n※保護（編集ロック）の設定に失敗しました：' + j.protectError : '') + filesWarn(j);
    alert((j.existed
      ? '同じ名前のスプレッドシートが既にあったため、それを開けるようにしました（連動データは最新に更新しました）。'
      : 'フォルダ「' + j.folderName + '」にスプレッドシートを作成しました（シミュレーター結果も入ります）。\n以後、入力が止まると自動で最新に更新されます。') + warn);
  }).catch(err => {
    alert('作成できませんでした：' + err.message);
    renderReport();
  });
}

function sheetIdOfState() {
  const m = /\/d\/([\w-]+)/.exec((appState.sheets && appState.sheets.url) || '');
  return m ? m[1] : '';
}

// 「今すぐ更新」ボタン：連動データ・配色・保護・シミュレーター結果・リンクをすべて最新にする
function updateSheetValues() {
  const id = sheetIdOfState();
  if (!id) return;
  const result = runFullCalculation(appState);
  const btn = document.getElementById('sheetUpdateBtn');
  if (btn) { btn.disabled = true; btn.textContent = '更新中…'; }
  driveFilesPayload().then(files => callSheetFactory(Object.assign({ action: 'update', sheetId: id, rows: buildSheetLinkRows(appState, result) }, files)))
    .then(j => {
      driveSyncMarkDone();
      alert('スプレッドシートの「連動データ」とシミュレーター結果を最新の内容に更新しました。' + (j.protectError ? '\n\n※保護（編集ロック）の設定に失敗しました：' + j.protectError : '') + filesWarn(j));
      renderReport();
    })
    .catch(err => { alert('更新できませんでした：' + err.message); renderReport(); });
}

// ---- 自動更新：入力が止まって少し経ったら、連動データとシミュレーター結果を自動で最新にする ----
const DRIVE_AUTO_KEY = 'bkPlanSimulator.driveAutoSync';      // '0' なら自動更新オフ
const DRIVE_PENDING_KEY = 'bkPlanSimulator.driveSyncPending'; // 未反映の変更があるスプレッドシートID
const DRIVE_LAST_KEY = 'bkPlanSimulator.driveSyncLast';       // 最後に反映した内容の目印（シートID:署名）
const DRIVE_SYNC_DELAY_MS = 45000;
let driveSyncTimer = null, driveSyncBusy = false;
const driveSyncInfo = { at: null, error: '' };

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* noop */ } }
function driveAutoOn() { return lsGet(DRIVE_AUTO_KEY) !== '0'; }
function driveSyncReady() {
  return driveAutoOn() && !!getSheetFactory().url && !!sheetIdOfState() && !isPlaceholderCompany(appState.meta && appState.meta.companyName);
}
function driveSyncMarkDone() {
  lsSet(DRIVE_PENDING_KEY, null);
  lsSet(DRIVE_LAST_KEY, sheetIdOfState() + ':' + driveSyncSignature());
  driveSyncInfo.at = new Date(); driveSyncInfo.error = '';
}
function driveSyncStatusText() {
  if (!driveAutoOn()) return '自動更新はオフです。';
  if (driveSyncBusy) return '更新中…';
  if (driveSyncInfo.error) return '自動更新に失敗しました：' + driveSyncInfo.error + '（次の入力時に再試行します）';
  if (driveSyncTimer) return '入力が止まったら自動で更新します…';
  if (driveSyncInfo.at) {
    const p = n => String(n).padStart(2, '0'), d = driveSyncInfo.at;
    return '最終の自動更新：' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  return 'この画面で入力を変えると、自動で更新されます。';
}
function driveSyncShowStatus() {
  const el = document.getElementById('driveSyncStatus');
  if (el) el.textContent = driveSyncStatusText();
}

function scheduleDriveSync(delayMs) {
  if (!driveSyncReady()) return;
  lsSet(DRIVE_PENDING_KEY, sheetIdOfState());
  if (driveSyncTimer) clearTimeout(driveSyncTimer);
  driveSyncTimer = setTimeout(runDriveSync, typeof delayMs === 'number' ? delayMs : DRIVE_SYNC_DELAY_MS);
  driveSyncShowStatus();
}

async function runDriveSync() {
  driveSyncTimer = null;
  if (!driveSyncReady()) return;
  if (driveSyncBusy) { scheduleDriveSync(5000); return; }
  const id = sheetIdOfState();
  if (lsGet(DRIVE_LAST_KEY) === id + ':' + driveSyncSignature()) { lsSet(DRIVE_PENDING_KEY, null); driveSyncShowStatus(); return; } // 前回から変更なし
  driveSyncBusy = true; driveSyncShowStatus();
  try {
    const sig = driveSyncSignature();
    const files = await driveFilesPayload();
    const rows = buildSheetLinkRows(appState, runFullCalculation(appState));
    const j = await callSheetFactory(Object.assign({ action: 'update', sheetId: id, light: true, rows: rows }, files));
    if (driveSyncSignature() === sig) driveSyncMarkDone();   // 送っている間にさらに入力があれば、次の予約に任せる
    else { driveSyncInfo.at = new Date(); driveSyncInfo.error = ''; }
    if (j.filesError) driveSyncInfo.error = j.filesError;
  } catch (e) {
    driveSyncInfo.error = e && e.message ? e.message : String(e);
    console.warn('drive auto sync failed', e);
  } finally {
    driveSyncBusy = false; driveSyncShowStatus();
  }
}

// 起動時：前回、反映前に画面を閉じた変更が残っていれば、すぐ反映する
function bootDriveSync() {
  if (lsGet(DRIVE_PENDING_KEY) && lsGet(DRIVE_PENDING_KEY) === sheetIdOfState()) scheduleDriveSync(3000);
}
// 画面を離れる（別タブへ移動・閉じる）ときは、待たずにすぐ反映する
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && driveSyncTimer) { clearTimeout(driveSyncTimer); runDriveSync(); }
});

// ---- 新規作成した会社を、開いた時に自動でGoogleドライブへ作る ----
// 条件：サーバー保存の会社（自動保存あり）で、スプレッドシートがまだ無く、会社名が入っていて、連携先が設定済み。
// 「新規作成」「コピーして新規作成」どちらで作った会社も、入力画面を開いた直後に作られる。
let driveCreateBusy = false;
function showDriveCreateStatus(text, isError) {
  let el = document.getElementById('driveCreateStatus');
  if (!el) {
    const box = document.querySelector('.cloud-actions');
    if (!box) return;
    el = document.createElement('span'); el.id = 'driveCreateStatus'; el.className = 'cloud-auto-status small text-muted'; el.setAttribute('aria-live', 'polite');
    box.insertBefore(el, box.firstChild);
  }
  el.textContent = text || ''; el.style.color = isError ? 'var(--color-warn)' : ''; el.style.display = text ? '' : 'none';
}
function driveCreateReady() {
  return typeof serverMode !== 'undefined' && serverMode && !!currentCloudId
    && !!(appState.meta && appState.meta.autoSave) && !sheetIdOfState()
    && !!getSheetFactory().url && !isPlaceholderCompany(appState.meta && appState.meta.companyName);
}
async function autoCreateDriveSheet() {
  if (driveCreateBusy || !driveCreateReady()) return;
  driveCreateBusy = true;
  showDriveCreateStatus('Googleドライブに作成中…（10〜30秒かかります）');
  try {
    const result = runFullCalculation(appState);
    const files = await driveFilesPayload();
    const j = await callSheetFactory(Object.assign({
      action: 'create', companyName: appState.meta.companyName, folderName: sheetFolderName(), fileName: sheetFileName(),
      rows: buildSheetLinkRows(appState, result)
    }, files));
    appState.sheets = Object.assign({}, appState.sheets, { url: j.url, folderUrl: j.folderUrl });
    saveState(true);
    if (typeof scheduleCloudAutoSave === 'function') scheduleCloudAutoSave();   // スプレッドシートのURLを会社データにも保存
    driveSyncMarkDone();
    showDriveCreateStatus('Googleドライブに作成しました' + ((j.protectError || j.filesError) ? '（一部の設定に失敗しました）' : ''));
    if (activeView === 'report') renderReport();
  } catch (e) {
    showDriveCreateStatus('Googleドライブへの作成に失敗しました：' + (e && e.message ? e.message : e) + '（事業計画書の画面から作成できます）', true);
    console.warn('auto create drive sheet failed', e);
  } finally { driveCreateBusy = false; }
}

function renderSheetLinksSection() {
  const sh = appState.sheets || {};
  const url = (sh.url || '').trim();
  const folderUrl = (sh.folderUrl || '').trim();
  const ok = sheetUrlValid(url);
  const factory = getSheetFactory();
  const auto = !!factory.url;
  const cards = SHEET_TABS.map(t => `
    <li class="sheet-card">
      <div class="sheet-card-name">${esc(t.name)}</div>
      <div class="sheet-card-desc">${esc(t.desc)}</div>
    </li>`).join('');
  const fname = sheetFileName();
  const templateCopy = `${esc(SHEET_TEMPLATE_URL.replace(/\/(edit|view)?(#.*|\?.*)?$/, ''))}/copy`;
  return `
    <section class="report-section sheet-links">
      <h2>詳細資料（スプレッドシート）</h2>
      <p class="small">下の4つは、数式つきのGoogleスプレッドシートで確認・編集できます。会社ごとにGoogleドライブの「事業計画書／会社名」フォルダへ保管します。</p>
      <ul class="sheet-cards">${cards}</ul>
      <div class="sheet-actions no-print">
        ${ok ? `
          <div class="sheet-main-actions">
            <a class="btn-gold" id="sheetOpenBtn" href="${esc(url)}" target="_blank" rel="noopener">📑 スプレッドシートを開く</a>
            ${folderUrl ? `<a class="btn-outline" id="sheetFolderBtn" href="${esc(folderUrl)}" target="_blank" rel="noopener">📂 会社フォルダを開く</a>` : ''}
            ${auto ? `<button type="button" class="btn-outline" id="sheetUpdateBtn">🔄 今すぐ更新</button>` : ''}
          </div>
          ${auto ? `<div class="sheet-sync">
            <label><input type="checkbox" id="driveAutoSyncChk" ${driveAutoOn() ? 'checked' : ''}> 入力が止まったら自動で更新する</label>
            <span class="small text-muted" id="driveSyncStatus">${esc(driveSyncStatusText())}</span>
          </div>
          <p class="small">会社フォルダには、スプレッドシート（事業計画・シミュレーター結果）${currentAppUrl() ? '、アプリのリンク' : ''}が入ります。${currentAppUrl() ? '' : '（アプリのリンクは、会社データを「☁ 保存」すると入ります）'}</p>` : ''}` : (auto ? `
          <div class="sheet-main-actions">
            <button type="button" class="btn-gold" id="sheetCreateBtn">📁 会社フォルダを作ってスプレッドシートを作成</button>
          </div>
          <p class="small">作成先：Googleドライブ「事業計画書」→「${esc(sheetFolderName() || '会社名')}」／ ファイル名：${esc(fname || '会社名_事業計画')}</p>` : `
          <p class="small">この会社のスプレッドシートはまだ登録されていません。</p>`)}

        <details class="sheet-manual" ${!ok && !auto ? 'open' : ''}>
          <summary>${auto ? '手動で作る・URLを登録する場合' : '作り方（手動）'}</summary>
          <div class="sheet-manual-body">
            <div class="sheet-manual-row">
              <a class="btn-outline" id="sheetCopyTemplateBtn" href="${templateCopy}" target="_blank" rel="noopener">① 雛型をコピーして作成</a>
              <span class="small">コピー画面の名前欄に、次のファイル名を入れてください：</span>
              <button type="button" class="btn-outline btn-sm" id="sheetCopyNameBtn" ${fname ? '' : 'disabled'}>${esc(fname || '（会社名を入力してください）')}　📋</button>
            </div>
            <div class="sheet-manual-row">
              <button type="button" class="btn-outline" id="sheetCopyDataBtn">② 連動データをコピー</button>
              <span class="small">コピー先の「連動データ」シートのA1に貼り付け</span>
            </div>
            <div class="sheet-url-row">
              <label for="sheetUrlInput" class="small">③ 作成したスプレッドシートのURLを登録</label>
              <input type="url" id="sheetUrlInput" class="sheet-url-input" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(url)}">
              <button type="button" class="btn-outline" id="sheetUrlSaveBtn">登録</button>
            </div>
            <p class="small sheet-howto">ドライブでは「事業計画書」フォルダの中に会社名のフォルダを作り、そこへ入れてください。会社データを保存すると、次回から事業計画書のボタンで開けます。</p>
          </div>
        </details>

        <details class="sheet-manual">
          <summary>自動作成の連携設定${auto ? '（設定済み）' : '（未設定）'}</summary>
          <div class="sheet-manual-body">
            <p class="small">管理者が Apps Script（gas-backend/SheetFactory.gs）をデプロイして発行したURLを登録すると、ボタン1つで会社フォルダとスプレッドシートが作られます。設定方法は gas-backend/README_GAS_SETUP.md を参照してください。</p>
            <div class="sheet-url-row">
              <input type="url" id="sheetFactoryUrl" class="sheet-url-input" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(factory.url)}">
              <input type="text" id="sheetFactoryKey" class="sheet-key-input" placeholder="合言葉（設定した場合のみ）" value="${esc(factory.key)}" autocomplete="off">
              <button type="button" class="btn-outline" id="sheetFactorySaveBtn">保存</button>
            </div>
          </div>
        </details>
      </div>
      ${ok ? `<p class="print-only small">スプレッドシート：${esc(url)}</p>` : ''}
    </section>`;
}

function bindSheetLinks() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('sheetCopyDataBtn', copySheetLinkData);
  on('sheetCreateBtn', createCompanySheet);
  on('sheetUpdateBtn', updateSheetValues);
  const chk = document.getElementById('driveAutoSyncChk');
  if (chk) chk.onchange = () => {
    lsSet(DRIVE_AUTO_KEY, chk.checked ? '1' : '0');
    if (chk.checked) scheduleDriveSync(); else if (driveSyncTimer) { clearTimeout(driveSyncTimer); driveSyncTimer = null; }
    driveSyncShowStatus();
  };
  on('sheetCopyNameBtn', () => {
    const t = sheetFileName();
    if (!t) return;
    const done = () => alert('ファイル名「' + t + '」をコピーしました。コピー画面の名前欄に貼り付けてください。');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => alert(t));
    else alert(t);
  });
  on('sheetFactorySaveBtn', () => {
    const u = (document.getElementById('sheetFactoryUrl').value || '').trim();
    if (u && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) {
      alert('Apps Script のウェブアプリURL（https://script.google.com/macros/s/…/exec）を入力してください。');
      return;
    }
    saveSheetFactory(u, (document.getElementById('sheetFactoryKey').value || '').trim());
    renderReport();
  });
  on('sheetUrlSaveBtn', () => {
    const v = (document.getElementById('sheetUrlInput').value || '').trim();
    if (v && !sheetUrlValid(v)) {
      alert('GoogleスプレッドシートのURL（https://docs.google.com/spreadsheets/d/…）を入力してください。');
      return;
    }
    appState.sheets = Object.assign({}, appState.sheets, { url: v });
    saveState();
    renderReport();
  });
}
