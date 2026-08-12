/**
 * オーナー研修 事業計画シミュレーター - クラウド保存バックエンド
 *
 * このファイルは Google スプレッドシートに紐づく Google Apps Script（GAS）です。
 * 「保存」ボタンから送信された会社ごとの入力データ（appState一式のJSON）を
 * スプレッドシートの1行として保存・更新し、発行した専用URL（?id=...）から
 * いつでも同じデータを呼び出せるようにします。
 *
 * ▼ セットアップ手順は README_GAS_SETUP.md を参照してください。
 *
 * ▼ セキュリティについて（重要）
 * このWebアプリは「アクセス権限：全員」で公開する前提です（Googleアカウント不要で
 * フロントエンドから直接呼び出すため）。そのため、発行されたURL（id）を知っている人は
 * 誰でもそのデータを閲覧・上書きできます。IDは推測困難なランダム文字列で発行されますが、
 * 社外に不用意にURLを共有しないよう運用でご注意ください。
 * スプレッドシート自体の閲覧・編集権限は、通常どおりGoogleドライブの共有設定で
 * 管理してください（このスクリプトの実行権限とは別です）。
 */

// アプリの公開URL（会社ごとの共有URL＝ここに ?id=... を付けたもの）を作る際の土台。
// アプリの公開先を変更した場合は、ここを書き換えて再デプロイしてください。
const APP_BASE_URL = 'https://bukkenking2014.github.io/bk-plan/';

const SHEET_NAME = 'companies';
// 列の並び：id・会社名・共有URL（クリックで開ける）・作成日時・更新日時・オープン予定日・
// 1年目/2年目営業損益・保存データ本体（JSON、機械可読用につき最後尾かつ狭め表示）
const HEADERS = ['id', '会社名', '共有URL', '作成日時', '更新日時', 'オープン予定日', '1年目営業損益', '2年目営業損益', 'データ(JSON)'];
const COL = { id: 1, companyName: 2, shareUrl: 3, createdAt: 4, updatedAt: 5, openDate: 6, year1: 7, year2: 8, dataJson: 9 };

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  const isNew = !sheet;
  if (isNew) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    formatSheet_(sheet);
  }
  return sheet;
}

// 見やすさのための体裁設定（初回作成時に一度だけ適用）
function formatSheet_(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(COL.id, 110);
  sheet.setColumnWidth(COL.companyName, 180);
  sheet.setColumnWidth(COL.shareUrl, 90);
  sheet.setColumnWidth(COL.createdAt, 150);
  sheet.setColumnWidth(COL.updatedAt, 150);
  sheet.setColumnWidth(COL.openDate, 110);
  sheet.setColumnWidth(COL.year1, 130);
  sheet.setColumnWidth(COL.year2, 130);
  sheet.setColumnWidth(COL.dataJson, 90);
  // データ(JSON)列は人が読む列ではないため折りたたんで隠す（必要な時だけ展開して見られる）
  sheet.hideColumns(COL.dataJson);
}

// スプレッドシートを開くと「BKマネージャー」メニューが追加され、そこから体裁を
// いつでも手動で整え直せる（既存データは失われない。列がずれている場合は補正する）。
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('BKマネージャー')
    .addItem('スプレッドシートの体裁を整える', 'tidyUpSheet')
    .addToUi();
}

function tidyUpSheet() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { ui.alert('「companies」シートが見つかりません。まず一度アプリから保存を行ってください。'); return; }

  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const currentHeaders = lastRow > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];

  // 旧レイアウト（共有URL列が無い）の場合は3列目に挿入して新レイアウトへ移行する
  if (currentHeaders[2] !== HEADERS[2]) {
    sheet.insertColumnBefore(3);
  }

  // ヘッダー行を最新の見出しに揃える
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  if (lastRow > 1) {
    // 共有URL列が空の既存行にHYPERLINK式を補完（すでに入っている行は上書きしない）
    const ids = sheet.getRange(2, COL.id, lastRow - 1, 1).getValues();
    const shareRange = sheet.getRange(2, COL.shareUrl, lastRow - 1, 1);
    const currentShare = shareRange.getFormulas();
    const newFormulas = ids.map((r, i) => [currentShare[i][0] || (r[0] ? shareUrlFormula_(r[0]) : '')]);
    shareRange.setFormulas(newFormulas);

    sheet.getRange(2, COL.createdAt, lastRow - 1, 2).setNumberFormat('yyyy/mm/dd hh:mm');
    sheet.getRange(2, COL.year1, lastRow - 1, 2).setNumberFormat('#,##0"円"');
  }

  formatSheet_(sheet);
  ui.alert('スプレッドシートの体裁を整えました。');
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function generateId_() {
  // 推測困難な短めのランダムID（例: a3f9c1e7b2）
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function findRowById_(sheet, id) {
  const values = sheet.getRange(1, COL.id, sheet.getLastRow(), 1).getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === id) return i + 1; // 1-indexed row number
  }
  return -1;
}

function shareUrlFormula_(id) {
  return `=HYPERLINK("${APP_BASE_URL}?id=${id}","開く")`;
}

function doGet(e) {
  try {
    const id = e.parameter.id;
    if (!id) {
      return jsonResponse_({ ok: false, error: 'id パラメータが必要です' });
    }
    const sheet = getSheet_();
    const row = findRowById_(sheet, id);
    if (row === -1) {
      return jsonResponse_({ ok: false, error: '指定されたIDのデータが見つかりません' });
    }
    const values = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
    let data;
    try {
      data = JSON.parse(values[COL.dataJson - 1]);
    } catch (err) {
      return jsonResponse_({ ok: false, error: '保存データの読み込みに失敗しました' });
    }
    return jsonResponse_({
      ok: true, id: values[COL.id - 1], companyName: values[COL.companyName - 1],
      updatedAt: values[COL.updatedAt - 1], data: data
    });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const companyName = (body.companyName || '（会社名未入力）').toString();
    const data = body.data || {};
    const meta = body.meta || {};
    const now = new Date();
    const sheet = getSheet_();

    let id = (body.id || '').toString().trim();
    let row = id ? findRowById_(sheet, id) : -1;
    let createdAt = now;

    if (row !== -1) {
      createdAt = sheet.getRange(row, COL.createdAt).getValue();
    } else {
      id = generateId_();
    }

    const rowValues = [
      id, companyName, shareUrlFormula_(id), createdAt, now,
      meta.openDate || '', meta.year1OperatingIncome || '', meta.year2OperatingIncome || '',
      JSON.stringify(data)
    ];

    if (row === -1) {
      sheet.appendRow(rowValues);
      const newRow = sheet.getLastRow();
      sheet.getRange(newRow, COL.createdAt, 1, 2).setNumberFormat('yyyy/mm/dd hh:mm');
      sheet.getRange(newRow, COL.year1, 1, 2).setNumberFormat('#,##0"円"');
    } else {
      sheet.getRange(row, 1, 1, rowValues.length).setValues([rowValues]);
    }
    return jsonResponse_({ ok: true, id: id, updatedAt: now.toISOString() });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}
