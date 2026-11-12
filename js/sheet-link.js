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
    ['研修費（月）', Math.round(m0('training'))],
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
  // 決定事項の「売上（粗利益）イメージ」：リフォーム・自社請負は売上から原価を引いた粗利益で示す
  const gp = (y, key, cfg) => Math.round(y[key].amount * (cfg && cfg.enabled ? cfg.profitRate : 0));
  rows.push(
    ['1年目 仲介手数料（粗利益）', Math.round(y1.brokerage.amount)],
    ['1年目 リフォーム（粗利益）', gp(y1, 'reform', st.synergy.reform)],
    ['1年目 自社請負（粗利益）', gp(y1, 'selfBuild', st.synergy.selfBuild)],
    ['1年目 他社紹介（粗利益）', Math.round(y1.referral.amount)],
    ['2年目 仲介手数料（粗利益）', Math.round(y2.brokerage.amount)],
    ['2年目 リフォーム（粗利益）', gp(y2, 'reform', st.synergy.reform)],
    ['2年目 自社請負（粗利益）', gp(y2, 'selfBuild', st.synergy.selfBuild)],
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

function renderSheetLinksSection() {
  const url = ((appState.sheets && appState.sheets.url) || '').trim();
  const ok = sheetUrlValid(url);
  const cards = SHEET_TABS.map(t => `
    <li class="sheet-card">
      <div class="sheet-card-name">${esc(t.name)}</div>
      <div class="sheet-card-desc">${esc(t.desc)}</div>
    </li>`).join('');
  return `
    <section class="report-section sheet-links">
      <h2>詳細資料（スプレッドシート）</h2>
      <p class="small">下の4つは、数式つきのGoogleスプレッドシートで確認・編集できます。</p>
      <ul class="sheet-cards">${cards}</ul>
      <div class="sheet-actions no-print">
        ${ok
          ? `<a class="btn-gold" id="sheetOpenBtn" href="${esc(url)}" target="_blank" rel="noopener">📑 スプレッドシートを開く</a>`
          : `<span class="small">この会社のスプレッドシートはまだ登録されていません。</span>`}
        ${SHEET_TEMPLATE_URL
          ? `<a class="btn-outline" id="sheetCopyTemplateBtn" href="${esc(SHEET_TEMPLATE_URL.replace(/\/(edit|view)?(#.*|\?.*)?$/, ''))}/copy" target="_blank" rel="noopener">① 雛型をコピーして作成</a>` : ''}
        <button type="button" class="btn-outline" id="sheetCopyDataBtn">② 連動データをコピー</button>
        <div class="sheet-url-row">
          <label for="sheetUrlInput" class="small">③ 作成したスプレッドシートのURLを登録</label>
          <input type="url" id="sheetUrlInput" class="sheet-url-input" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(url)}">
          <button type="button" class="btn-outline" id="sheetUrlSaveBtn">登録</button>
        </div>
        <p class="small sheet-howto">使い方：①でコピーを作る → ②でデータをコピーし、コピー先の「連動データ」シートのA1に貼り付け → ③でURLを登録（会社データを保存すると、次回から事業計画書のボタンで開けます）。</p>
      </div>
      ${ok ? `<p class="print-only small">スプレッドシート：${esc(url)}</p>` : ''}
    </section>`;
}

function bindSheetLinks() {
  const copyBtn = document.getElementById('sheetCopyDataBtn');
  if (copyBtn) copyBtn.onclick = copySheetLinkData;
  const saveBtn = document.getElementById('sheetUrlSaveBtn');
  if (saveBtn) saveBtn.onclick = () => {
    const v = (document.getElementById('sheetUrlInput').value || '').trim();
    if (v && !sheetUrlValid(v)) {
      alert('GoogleスプレッドシートのURL（https://docs.google.com/spreadsheets/d/…）を入力してください。');
      return;
    }
    appState.sheets = Object.assign({}, appState.sheets, { url: v });
    saveState();
    renderReport();
  };
}
