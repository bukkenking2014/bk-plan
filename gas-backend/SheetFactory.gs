/**
 * 事業計画シミュレーター - 会社別スプレッドシート自動作成（Google Apps Script）
 *
 * 事業計画書の「📁 会社フォルダを作ってスプレッドシートを作成」ボタンから呼ばれ、
 *   マイドライブ（またはROOT_FOLDER_IDで指定した場所）
 *     └ 事業計画書／            … 管理者用の親フォルダ（なければ作成）
 *         └ 会社名／            … 会社ごとのフォルダ（なければ作成）
 *             └ 会社名_事業計画  … 雛型のコピー（社名・連動データ入り）
 * を作り、スプレッドシートとフォルダのURLをアプリへ返します。
 *
 * 作成したスプレッドシートは、数式・設定値（率や基準値）・連動データを「保護」し、
 * 入力欄（名前・日付・評価・チェックなど）だけを編集できる状態にします（applyProtection_）。
 *
 * ▼ Code.gs（クラウド保存用）とは別のプロジェクトとして、新しくデプロイしてください。
 *   手順は README_GAS_SETUP.md の「会社別スプレッドシートの自動作成」を参照。
 *
 * ▼ セキュリティ
 *   「アクセスできるユーザー：全員」で公開するため、URLを知っている人は誰でも呼び出せます。
 *   ACCESS_KEY に合言葉を設定すると、アプリ側で同じ合言葉を入力した人だけが使えます（推奨）。
 */

// 雛型スプレッドシートのID（URLの /d/ と /edit の間の文字列）
const TEMPLATE_ID = '1H8em4V-B--ooagHGIrnfO_r9MmPAi2MvLKntBwzCE_w';

// 管理者用の親フォルダ名。ROOT_FOLDER_ID を設定すると、そのフォルダを親として使います
// （共有ドライブ内などに置きたい場合：フォルダURLの /folders/ の後ろの文字列）。空なら、マイドライブ直下の同名フォルダを探し、なければ作成します。
const ROOT_FOLDER_NAME = '事業計画書';
const ROOT_FOLDER_ID = '1p8oGRSIcM0D9Dix_jlfxWIQQOpR6Y9bi'; // 共有ドライブの「オーナー研修_事業計画検討書（新）」

// 合言葉（空なら誰でも呼び出し可能）。設定した場合、アプリの「連携設定」に同じ値を入力します。
const ACCESS_KEY = '';

const VALUES_SHEET = '連動データ';

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (ACCESS_KEY && req.key !== ACCESS_KEY) return json_({ ok: false, error: '合言葉が違います' });
    if (req.action === 'ping') return json_({ ok: true });
    if (req.action === 'create' || req.action === 'update') {
      // 自動更新が重なっても壊れないよう、1件ずつ順番に処理する
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(60000)) return json_({ ok: false, error: '別の更新が実行中です。少し待ってからもう一度お試しください' });
      try {
        return json_(req.action === 'create' ? createCompanySheet_(req) : updateValues_(req));
      } finally { lock.releaseLock(); }
    }
    return json_({ ok: false, error: '不明な操作です' });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ブラウザで直接開いた時の動作確認用
function doGet() {
  return json_({ ok: true, app: 'bk-plan-sheet-factory' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function clean_(s, max) {
  return String(s || '').replace(/[\\\/:*?"<>|\r\n\t]/g, '').trim().slice(0, max || 40);
}

function rootFolder_() {
  if (ROOT_FOLDER_ID) return DriveApp.getFolderById(ROOT_FOLDER_ID);
  const it = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(ROOT_FOLDER_NAME);
}

function companyFolder_(root, name) {
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function createCompanySheet_(req) {
  const folderName = clean_(req.folderName || req.companyName, 40);
  const fileName = clean_(req.fileName, 60) || (folderName + '_事業計画');
  if (!folderName) return { ok: false, error: '会社名が空です' };
  const root = rootFolder_();
  const folder = companyFolder_(root, folderName);

  // 同じ名前のスプレッドシートが既にあれば、新しく作らずそれを返す（二重作成の防止）
  let existed = false, file = null;
  const same = folder.getFilesByName(fileName);
  if (same.hasNext()) { file = same.next(); existed = true; }
  if (!file) file = DriveApp.getFileById(TEMPLATE_ID).makeCopy(fileName, folder);

  const ss = SpreadsheetApp.openById(file.getId());
  writeValues_(ss, req.rows, existed); // 既存ファイルの場合は手入力欄（B25）を上書きしない
  if (!existed) setTitles_(ss);
  try { softenColors_(ss); } catch (err) { /* 配色の調整に失敗しても作成は続ける */ }
  let protectError = '';
  try { applyProtection_(ss, file); } catch (err) { protectError = String(err && err.message || err); }
  const filesError = saveCompanyFiles_(folder, req);
  return {
    ok: true, existed: existed, protectError: protectError, filesError: filesError,
    id: file.getId(), url: file.getUrl(), name: file.getName(),
    folderId: folder.getId(), folderUrl: folder.getUrl(), folderName: folder.getName()
  };
}

// 「連動データ」を書き換える（数字を直した時の更新用）。事業計画書フォルダ配下のファイルに限る。
// req.light が true（自動更新）のときは、配色・保護の付け直しを省いて短時間で終える。
// 会社フォルダの「シミュレーター結果（スプレッドシート）」とリンク（Google ドキュメント）も、あれば更新する。
function updateValues_(req) {
  const file = DriveApp.getFileById(req.sheetId);
  const root = rootFolder_();
  let inside = false, folder = null;
  const parents = file.getParents();
  while (parents.hasNext()) {
    const p = parents.next();
    const gps = p.getParents();
    while (gps.hasNext()) { if (gps.next().getId() === root.getId()) { inside = true; folder = p; } }
  }
  if (!inside) return { ok: false, error: '事業計画書フォルダの外にあるファイルは更新できません' };
  const ss = SpreadsheetApp.openById(req.sheetId);
  writeValues_(ss, req.rows, true);
  let protectError = '';
  if (!req.light) {
    try { softenColors_(ss); } catch (err) { /* 配色の調整に失敗しても更新は続ける */ }
    try { applyProtection_(ss, file); } catch (err) { protectError = String(err && err.message || err); }
  }
  const filesError = saveCompanyFiles_(folder, req);
  return { ok: true, id: file.getId(), url: file.getUrl(), protectError: protectError, filesError: filesError, folderUrl: folder.getUrl() };
}

// ---------------------------------------------------------------------------
// 会社フォルダへ「シミュレーター結果（Google スプレッドシート）」と「アプリへのリンク（Google ドキュメント）」を入れる／更新する
//   req.xlsxBase64 + req.xlsxName … Excel形式のデータ。Google スプレッドシートに変換して保存（同名があれば中身だけ差し替え）
//   req.appUrl + req.linkName      … この会社のデータを開くアプリのURL（保存済みの会社のみ）
// 失敗しても、スプレッドシート本体の処理は成功扱いにし、エラー文だけ返す。
// ---------------------------------------------------------------------------
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function findInFolder_(folder, name) {
  const it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function saveCompanyFiles_(folder, req) {
  const errs = [];
  if (req.xlsxBase64 && req.xlsxName) {
    try { saveSimSheet_(folder, clean_(req.xlsxName, 80), req.xlsxBase64); }
    catch (e) { errs.push('シミュレーター結果：' + String(e && e.message || e)); }
  }
  if (req.appUrl && req.linkName) {
    try { saveLinkDoc_(folder, clean_(req.linkName, 80), String(req.appUrl), String(req.companyName || '')); }
    catch (e) { errs.push('リンク：' + String(e && e.message || e)); }
  }
  return errs.join(' / ');
}

// シミュレーターの結果を、Google スプレッドシートとして会社フォルダに入れる（Excelの中身を変換して保存）。
// 同名のスプレッドシートがあれば、中身だけ差し替える（ファイルIDは変わらない）。
// 以前の版で作った同名の .xlsx（Excel）があれば、ごみ箱へ移す。
function saveSimSheet_(folder, name, b64) {
  const bytes = Utilities.base64Decode(b64);
  let file = null;
  const it = folder.getFilesByName(name);
  while (it.hasNext()) { const f = it.next(); if (f.getMimeType() === MimeType.GOOGLE_SHEETS) { file = f; break; } }
  if (!file) {
    const ss = SpreadsheetApp.create(name);
    file = DriveApp.getFileById(ss.getId());
    file.moveTo(folder);
  }
  // Excelの中身を送ると、Drive が Google スプレッドシートの形式に変換して差し替える
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files/' + file.getId() + '?uploadType=media&supportsAllDrives=true', {
    method: 'patch', contentType: XLSX_MIME, payload: bytes, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  if (res.getResponseCode() >= 300) throw new Error('スプレッドシートへの保存に失敗しました（' + res.getResponseCode() + '）' + res.getContentText().slice(0, 120));
  const old = folder.getFilesByName(name + '.xlsx');
  while (old.hasNext()) old.next().setTrashed(true);
  // 変換のたびにシートが作り直されてグラフが消えるので、毎回グラフを付け直す
  buildCharts_(SpreadsheetApp.openById(file.getId()));
}

// 「グラフ」シートの表から、3つのグラフを作る（何度実行しても同じ結果になる）
//   ① 黒字化のタイミング：累計営業損益（24ヶ月）…黒字は緑・赤字は赤の棒グラフ
//   ② 月次の売上高・販売管理費・営業損益     …売上高と販売管理費は棒、営業損益は線
//   ③ 年間の売上内訳                          …1年目・2年目の積み上げ棒グラフ
function buildCharts_(ss) {
  const sh = ss.getSheetByName('グラフ');
  if (!sh) return;
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  const W = 780, X = 9;   // グラフの幅、左位置（I列）

  const c1 = sh.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange('A4:A28')).addRange(sh.getRange('F4:G28'))
    .setNumHeaders(1).setOption('isStacked', true)
    .setOption('title', '黒字化のタイミング（累計営業損益・24ヶ月）')
    .setOption('colors', ['#2F9E6E', '#D9534F']).setOption('legend', { position: 'bottom' })
    .setOption('hAxis', { slantedText: true, slantedTextAngle: 60 })
    .setOption('vAxis', { format: '#,##0' }).setOption('bar', { groupWidth: '85%' })
    .setOption('width', W).setOption('height', 320).setPosition(4, X, 0, 0).build();
  sh.insertChart(c1);

  const c2 = sh.newChart().setChartType(Charts.ChartType.COMBO)
    .addRange(sh.getRange('A4:D28')).setNumHeaders(1)
    .setOption('title', '月次の売上高・販売管理費・営業損益')
    .setOption('seriesType', 'bars')
    .setOption('series', { 0: { type: 'bars', color: '#05968C' }, 1: { type: 'bars', color: '#F0A04B' }, 2: { type: 'line', color: '#1F3A5F', lineWidth: 3, pointSize: 4 } })
    .setOption('legend', { position: 'bottom' }).setOption('hAxis', { slantedText: true, slantedTextAngle: 60 })
    .setOption('vAxis', { format: '#,##0' })
    .setOption('width', W).setOption('height', 320).setPosition(22, X, 0, 0).build();
  sh.insertChart(c2);

  const last = Math.max(sh.getLastRow(), 32);
  const c3 = sh.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange('A31:C' + last)).setNumHeaders(1)
    .setTransposeRowsAndColumns(true).setOption('isStacked', true)
    .setOption('title', '年間の売上内訳（1年目・2年目）')
    .setOption('colors', ['#05968C', '#F0A04B', '#1F3A5F', '#8E6BBF'])
    .setOption('legend', { position: 'right' }).setOption('vAxis', { format: '#,##0' })
    .setOption('width', W).setOption('height', 320).setPosition(40, X, 0, 0).build();
  sh.insertChart(c3);
}

const LINK_DOC_VERSION = 2;   // リンクのドキュメントの文面の版（2：「☁」の絵文字を外した）
function saveLinkDoc_(folder, name, appUrl, companyName) {
  let file = findInFolder_(folder, name);
  // URLと文面の版が同じなら何もしない。文面を直したら LINK_DOC_VERSION を上げると、既存のドキュメントも書き換わる
  const stamp = appUrl + '|' + LINK_DOC_VERSION;
  if (file && file.getDescription() === stamp) return;
  let doc;
  if (file) doc = DocumentApp.openById(file.getId());
  else {
    doc = DocumentApp.create(name);
    file = DriveApp.getFileById(doc.getId());
    file.moveTo(folder);
  }
  const body = doc.getBody();
  body.clear();
  body.appendParagraph((companyName || '') + ' 事業計画シミュレーター').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('下のリンクを開くと、この会社の事業計画シミュレーターを続きから編集できます。');
  body.appendParagraph('▶ 事業計画シミュレーターを開く').setLinkUrl(appUrl);
  body.appendParagraph('※リンクで開くのは「保存」したデータです。入力した内容を反映するには、アプリの「保存」ボタンを押してください。');
  doc.saveAndClose();
  file.setDescription(stamp);
}

// keepInputs=true（更新時）：手入力欄（INPUT_ROWS）は上書きしない
const INPUT_ROWS = [25]; // 連動データ B25：インセンティブ原資（年額）は人が入力する
function writeValues_(ss, rows, keepInputs) {
  if (!rows || !rows.length) throw new Error('連動データが空です');
  const sh = ss.getSheetByName(VALUES_SHEET);
  if (!sh) throw new Error('「' + VALUES_SHEET + '」シートが見つかりません');
  const data = rows.map(function (r) { return [r[0] === undefined ? '' : r[0], r[1] === undefined ? '' : r[1]]; });
  if (keepInputs) {
    const cur = sh.getRange(1, 2, data.length, 1).getValues();
    INPUT_ROWS.forEach(function (n) { if (n <= data.length) data[n - 1][1] = cur[n - 1][0]; });
  }
  sh.getRange(1, 1, data.length, 2).setValues(data);
}

// 各シートの見出しに社名を入れる（連動データ!B3 を参照するので、後から会社名が変わっても追従する）
function setTitles_(ss) {
  const set = function (sheet, a1, text) {
    const sh = ss.getSheetByName(sheet);
    if (sh) sh.getRange(a1).setFormula('=' + VALUES_SHEET + '!$B$3&"　' + text + '"');
  };
  set('給与整合性', 'B1', '給与水準 確認表');
  set('能力判定', 'A1', '能力判定表');
  set('インセンティブ検討', 'B1', 'インセンティブ検討');
}

// ---------------------------------------------------------------------------
// 配色：濃い塗り（青・赤・緑・紫・オレンジ・グレー）を、同系色の淡い色に直して読みやすくする。
// ・淡い色（明るさ 0.87 以上）はそのまま。何度実行しても同じ結果になる。
// ・白文字だった所は、同系色の濃い文字に替える。
// ・条件付き書式の真っ赤（#FF0000）は、淡い赤＋濃い赤文字にする。
// ---------------------------------------------------------------------------
function hexToRgb_(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex_(c) {
  return '#' + c.map(function (v) { const t = Math.max(0, Math.min(255, Math.round(v))).toString(16); return t.length < 2 ? '0' + t : t; }).join('');
}
function lum_(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
function mixRgb_(a, b, k) { return [0, 1, 2].map(function (i) { return a[i] * (1 - k) + b[i] * k; }); }

// 戻り値：[新しい背景色, 新しい文字色]（変更なしなら、渡された値のまま）
function softenOne_(bg, fc) {
  const c = hexToRgb_(bg);
  if (!c || lum_(c) >= 0.87) return [bg, fc];
  const sat = (Math.max.apply(null, c) - Math.min.apply(null, c)) / 255;   // 彩度の目安（グレーは小さい）
  const nbg = rgbToHex_(mixRgb_(c, [255, 255, 255], sat > 0.15 ? 0.8 : 0.55));
  const f = hexToRgb_(fc);
  const nfc = (!f || lum_(f) > 0.7) ? rgbToHex_(mixRgb_(c, [0, 0, 0], 0.62)) : fc;   // 白っぽい文字 → 同系色の濃い文字
  return [nbg, nfc];
}

function softenColors_(ss) {
  ss.getSheets().forEach(function (sh) {
    const rows = sh.getLastRow(), cols = sh.getLastColumn();
    if (rows < 1 || cols < 1) return;
    const rng = sh.getRange(1, 1, rows, cols);
    const bgs = rng.getBackgrounds(), fcs = rng.getFontColors();
    let changed = false;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const out = softenOne_(bgs[r][c], fcs[r][c]);
      if (out[0] !== bgs[r][c] || out[1] !== fcs[r][c]) { bgs[r][c] = out[0]; fcs[r][c] = out[1]; changed = true; }
    }
    if (changed) { rng.setBackgrounds(bgs); rng.setFontColors(fcs); }
    // 条件付き書式の真っ赤を、淡い赤に
    const rules = sh.getConditionalFormatRules();
    let ruleChanged = false;
    const next = rules.map(function (rule) {
      let bg = null;
      try { bg = rule.getBooleanCondition() && rule.getBooleanCondition().getBackground(); } catch (e) { bg = null; }
      const rgb = hexToRgb_(bg);
      if (rgb && lum_(rgb) < 0.87) {
        const o = softenOne_(bg, rule.getBooleanCondition().getFontColor());
        ruleChanged = true;
        const dark = rgb[0] > 200 && rgb[1] < 80 && rgb[2] < 80;          // 真っ赤
        return rule.copy().setBackground(dark ? '#FFC7CE' : o[0]).setFontColor(dark ? '#9C0006' : (o[1] || '#222222')).build();
      }
      return rule;
    });
    if (ruleChanged) sh.setConditionalFormatRules(next);
  });
}

// ---------------------------------------------------------------------------
// 保護：数式・設定値・連動データは触れないようにし、入力欄だけ編集できるようにする
// ---------------------------------------------------------------------------

// 数式ではないが「設定値」（率・基準値）なので、触れないようにするセル
const LOCKED_CONSTANTS = {
  '給与整合性': ['Z5:Z7', 'V21:V26', 'M22', 'L25', 'F15:I15'],
  'インセンティブ検討': ['L5:L6'],
  '能力判定': ['DH39', 'DK39:DK43', 'DI43', 'DH52', 'DK52:DK56', 'DI56']
};

function applyProtection_(ss, file) {
  // 既存のシート保護を外してから、付け直す（何度実行しても同じ結果になる）
  ss.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  ss.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { p.remove(); });
  ss.getSheets().forEach(function (sh) {
    const name = sh.getName();
    let open;
    if (name === VALUES_SHEET) {
      open = INPUT_ROWS.map(function (n) { return 'B' + n; });  // 連動データは、手入力欄のみ編集可
    } else {
      open = editableRanges_(sh, LOCKED_CONSTANTS[name] || []);
    }
    const prot = sh.protect().setDescription('数式・設定値の保護（入力欄のみ編集できます）');
    if (open.length) prot.setUnprotectedRanges(sh.getRangeList(open).getRanges());
    // 作成者（ファイルの持ち主）以外の編集者は、保護された範囲を編集できない
    // （Session.getEffectiveUser は追加の権限が必要なため、ファイルの持ち主を使う）
    let me = null;
    try { me = ss.getOwner(); } catch (e) { me = null; }
    if (me) prot.addEditor(me);
    // 共有ドライブのファイルには持ち主がいない（me が空）。その場合は1人ずつ外し、実行者自身は外せないので無視する
    prot.getEditors().forEach(function (u) {
      if (me && u.getEmail() === me.getEmail()) return;
      try { prot.removeEditor(u); } catch (e) { /* 実行者自身などは外せない */ }
    });
    try { if (prot.canDomainEdit()) prot.setDomainEdit(false); } catch (e) { /* 共有ドライブでは変更できないことがある */ }
  });
  // 編集者が共有設定（他の人の追加・権限変更）を変えられないようにする（共有ドライブでは設定できないことがある）
  try { if (file) file.setShareableByEditors(false); } catch (e) { /* noop */ }
}

// 「数式のセル」と「設定値のセル」を除いた、編集してよいセルの範囲（A1表記）の一覧を返す
function editableRanges_(sh, lockedA1) {
  const rows = sh.getLastRow(), cols = sh.getLastColumn();
  if (rows < 1 || cols < 1) return [];
  const f = sh.getRange(1, 1, rows, cols).getFormulas();
  const locked = [];
  for (let r = 0; r < rows; r++) { locked.push(new Array(cols).fill(false)); for (let c = 0; c < cols; c++) if (f[r][c]) locked[r][c] = true; }
  lockedA1.forEach(function (a1) { markRange_(locked, sh.getRange(a1)); });
  // 結合セルは、中に1つでも保護対象があれば結合範囲ぜんぶを保護対象にする
  sh.getRange(1, 1, rows, cols).getMergedRanges().forEach(function (m) {
    const r1 = m.getRow() - 1, c1 = m.getColumn() - 1, r2 = r1 + m.getNumRows(), c2 = c1 + m.getNumColumns();
    let any = false;
    for (let r = r1; r < r2 && !any; r++) for (let c = c1; c < c2; c++) if (locked[r][c]) { any = true; break; }
    if (any) for (let r = r1; r < r2; r++) for (let c = c1; c < c2; c++) locked[r][c] = true;
  });
  // 行ごとに「保護されていない連続区間」を求め、同じ区間が縦に続くものは1つの長方形にまとめる
  const rects = [], openRect = {};
  for (let r = 0; r <= rows; r++) {
    const runs = {};
    if (r < rows) {
      let c = 0;
      while (c < cols) {
        if (locked[r][c]) { c++; continue; }
        let e = c; while (e + 1 < cols && !locked[r][e + 1]) e++;
        runs[c + ':' + e] = true; c = e + 1;
      }
    }
    Object.keys(openRect).forEach(function (k) {
      if (runs[k]) { delete runs[k]; } else { rects.push(openRect[k]); delete openRect[k]; }
    });
    Object.keys(runs).forEach(function (k) { const p = k.split(':'); openRect[k] = { r1: r, c1: +p[0], c2: +p[1], r2: r }; });
    Object.keys(openRect).forEach(function (k) { openRect[k].r2 = r; });
  }
  return rects.map(function (x) { return sh.getRange(x.r1 + 1, x.c1 + 1, x.r2 - x.r1 + 1, x.c2 - x.c1 + 1).getA1Notation(); });
}

function markRange_(locked, range) {
  for (let r = 0; r < range.getNumRows(); r++) for (let c = 0; c < range.getNumColumns(); c++) {
    const rr = range.getRow() - 1 + r, cc = range.getColumn() - 1 + c;
    if (locked[rr] && cc < locked[rr].length) locked[rr][cc] = true;
  }
}

// 初回の承認専用：エディタでこの関数を選んで「実行」し、承認画面で全ての権限（ドライブ・スプレッドシート）にチェックを入れて許可する。
// フォルダを作る（書き込み）処理を含めることで、「ドライブの読み書き」の権限が承認される。
// 実行ログに「承認OK」と出れば完了。その後、新バージョンでデプロイし直す。
function authorize() {
  const tmp = DriveApp.getRootFolder().createFolder('_承認テスト（削除してOK）');
  tmp.setTrashed(true);
  SpreadsheetApp.openById(TEMPLATE_ID);
  const d = DocumentApp.create('_承認テスト（削除してOK）');       // Google ドキュメントの権限
  DriveApp.getFileById(d.getId()).setTrashed(true);
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=kind', {      // 外部通信（Drive API）の権限
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  console.log('承認OK：ドライブ（読み書き）とスプレッドシートを操作できます');
}
