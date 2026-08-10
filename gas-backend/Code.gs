/**
 * BKマネージャー 事業計画シミュレーター - クラウド保存バックエンド
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

const SHEET_NAME = 'companies';
const HEADERS = ['id', 'companyName', 'createdAt', 'updatedAt', 'openDate', 'year1OperatingIncome', 'year2OperatingIncome', 'dataJson'];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function generateId_() {
  // 推測困難な短めのランダムID（例: a3f9c1e7b2）
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function findRowById_(sheet, id) {
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === id) return i + 1; // 1-indexed row number
  }
  return -1;
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
    const record = {};
    HEADERS.forEach((h, i) => (record[h] = values[i]));
    let data;
    try {
      data = JSON.parse(record.dataJson);
    } catch (err) {
      return jsonResponse_({ ok: false, error: '保存データの読み込みに失敗しました' });
    }
    return jsonResponse_({ ok: true, id: record.id, companyName: record.companyName, updatedAt: record.updatedAt, data: data });
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
    const now = new Date().toISOString();
    const sheet = getSheet_();

    let id = (body.id || '').toString().trim();
    let row = id ? findRowById_(sheet, id) : -1;

    if (row === -1) {
      // 新規保存（idが未指定、または指定idが見つからない場合は新規発行）
      id = generateId_();
      sheet.appendRow([
        id, companyName, now, now,
        meta.openDate || '', meta.year1OperatingIncome || '', meta.year2OperatingIncome || '',
        JSON.stringify(data)
      ]);
    } else {
      // 既存レコードの更新（同じURLで上書き保存）
      sheet.getRange(row, 2, 1, HEADERS.length - 1).setValues([[
        companyName, sheet.getRange(row, 3).getValue(), now,
        meta.openDate || '', meta.year1OperatingIncome || '', meta.year2OperatingIncome || '',
        JSON.stringify(data)
      ]]);
    }
    return jsonResponse_({ ok: true, id: id, updatedAt: now });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) });
  }
}
