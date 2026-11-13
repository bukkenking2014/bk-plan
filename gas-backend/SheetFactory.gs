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
const ROOT_FOLDER_ID = '';

// 合言葉（空なら誰でも呼び出し可能）。設定した場合、アプリの「連携設定」に同じ値を入力します。
const ACCESS_KEY = '';

const VALUES_SHEET = '連動データ';

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (ACCESS_KEY && req.key !== ACCESS_KEY) return json_({ ok: false, error: '合言葉が違います' });
    if (req.action === 'ping') return json_({ ok: true });
    if (req.action === 'create') return json_(createCompanySheet_(req));
    if (req.action === 'update') return json_(updateValues_(req));
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
  let protectError = '';
  try { applyProtection_(ss, file); } catch (err) { protectError = String(err && err.message || err); }
  return {
    ok: true, existed: existed, protectError: protectError,
    id: file.getId(), url: file.getUrl(), name: file.getName(),
    folderId: folder.getId(), folderUrl: folder.getUrl(), folderName: folder.getName()
  };
}

// 「連動データ」だけを書き換える（数字を直した時の更新用）。事業計画書フォルダ配下のファイルに限る
function updateValues_(req) {
  const file = DriveApp.getFileById(req.sheetId);
  const root = rootFolder_();
  let inside = false;
  const parents = file.getParents();
  while (parents.hasNext()) {
    const p = parents.next();
    const gps = p.getParents();
    while (gps.hasNext()) { if (gps.next().getId() === root.getId()) inside = true; }
  }
  if (!inside) return { ok: false, error: '事業計画書フォルダの外にあるファイルは更新できません' };
  const ss = SpreadsheetApp.openById(req.sheetId);
  writeValues_(ss, req.rows, true);
  let protectError = '';
  try { applyProtection_(ss, file); } catch (err) { protectError = String(err && err.message || err); }
  return { ok: true, id: file.getId(), url: file.getUrl(), protectError: protectError };
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
    // 自分（作成者）以外の編集者は、保護された範囲を編集できない
    const me = Session.getEffectiveUser();
    prot.addEditor(me);
    prot.removeEditors(prot.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); }));
    if (prot.canDomainEdit()) prot.setDomainEdit(false);
  });
  // 編集者が共有設定（他の人の追加・権限変更）を変えられないようにする
  if (file) file.setShareableByEditors(false);
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
  return rects.map(function (x) { return sh.getRange(x.r1 + 1, x.c1 + 1, x.r2 - x.r1, x.c2 - x.c1 + 1).getA1Notation(); });
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
  console.log('承認OK：ドライブ（読み書き）とスプレッドシートを操作できます');
}
