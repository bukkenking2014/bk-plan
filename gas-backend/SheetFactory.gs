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
  writeValues_(ss, req.rows);
  if (!existed) setTitles_(ss);
  return {
    ok: true, existed: existed,
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
  writeValues_(SpreadsheetApp.openById(req.sheetId), req.rows);
  return { ok: true, id: file.getId(), url: file.getUrl() };
}

function writeValues_(ss, rows) {
  if (!rows || !rows.length) throw new Error('連動データが空です');
  const sh = ss.getSheetByName(VALUES_SHEET);
  if (!sh) throw new Error('「' + VALUES_SHEET + '」シートが見つかりません');
  const data = rows.map(function (r) { return [r[0] === undefined ? '' : r[0], r[1] === undefined ? '' : r[1]]; });
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
