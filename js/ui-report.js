/*
 * ui-report.js
 * 「事業計画書」出力ビュー。画面表示・印刷（window.print）両対応。
 */

function renderReport() {
  const main = document.getElementById('appMain');
  const result = runFullCalculation(appState);
  main.innerHTML = `
    <div class="toolbar no-print">
      <button class="btn-outline" id="backToWizard">← 入力に戻る</button>
      <button class="btn-gold" id="printBtn">🖨 印刷 / PDFとして保存</button>
    </div>
    ${renderCover()}
    ${renderBreakEvenChartSection(result)}
    ${renderBreakEvenSection(result)}
    ${renderSimplePLSection(result)}
    ${renderMonthlyPLSection(result)}
    ${renderSynergySection(result)}
    <div class="disclaimer-box">
      本シミュレーターは物件王「事業計画検討書」雛型の計算式をもとにした概算試算です。実際の契約・出店にあたっては、
      物件王担当者と内容をすり合わせのうえ確定させてください。全体スケジュールは営業日ベースの近似計算であり、実際の日程とは前後する場合があります。
    </div>
  `;
  document.getElementById('backToWizard').onclick = () => setActiveView('wizard');
  document.getElementById('printBtn').onclick = () => printReport();
  main.querySelectorAll('details.collapsible').forEach(d => {});
}

// 印刷／PDF保存：このアプリはサンドボックス化されたiframe（Artifact埋め込み）内で
// 開かれる場合があり、その場合 window.print() を直接呼んでも印刷ダイアログが
// 開かない（何も起きないように見える）ことがある。別ウィンドウ（新しいタブ）に
// 事業計画書の内容だけを複製して開き、そちらで印刷することで、埋め込み元の
// iframeの制限を受けずに確実に印刷ダイアログを開けるようにする。
function printReport() {
  let printWin = null;
  try {
    printWin = window.open('', '_blank');
  } catch (e) {
    printWin = null;
  }
  if (!printWin) {
    // ポップアップがブロックされた、またはiframeのサンドボックス制限で新規ウィンドウを開けない場合の代替策
    try {
      window.print();
    } catch (e) { /* noop */ }
    alert('新しいウィンドウを開けませんでした。ブラウザのポップアップ許可設定をご確認のうえ、もう一度「印刷 / PDFとして保存」を押してください（ポップアップ許可の通知はアドレスバー付近に表示されます）。');
    return;
  }
  // 単一ファイル版（<style>にCSSが埋め込み）・複数ファイル版（<link rel="stylesheet">でcss/style.cssを参照）
  // のどちらのデプロイ形態でも印刷用ウィンドウに正しくスタイルが反映されるよう、両方を複製する。
  // <link>はhrefが相対パスのままでも、新しいウィンドウが同一オリジン（about:blank→document.write）
  // のため元ページと同じ基準で解決され、正しく読み込まれる。
  const styleTags = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]')).map(el => el.outerHTML).join('\n');
  const theme = document.documentElement.getAttribute('data-theme') || '';
  const content = document.getElementById('appMain').innerHTML;
  printWin.document.open();
  printWin.document.write(`<!doctype html><html${theme ? ` data-theme="${theme}"` : ''}><head><meta charset="utf-8"><base href="${document.baseURI}"><title>事業計画書</title>${styleTags}</head><body><main class="app-main">${content}</main></body></html>`);
  printWin.document.close();
  // <link>で外部CSS（css/style.css）を読み込むデプロイ形態では、読み込み完了前に
  // 印刷してしまうと無装飾で出力されるため、loadイベントを待ってから印刷する
  // （すでに読み込み完了している場合はloadが発火しないためタイムアウトで保険をかける）。
  const triggerPrint = () => { printWin.focus(); printWin.print(); };
  let printed = false;
  const safePrint = () => { if (printed) return; printed = true; triggerPrint(); };
  printWin.addEventListener('load', safePrint);
  setTimeout(safePrint, 700);
}

function renderCover() {
  const m = appState.meta;
  return `
    <div class="report-cover">
      <div class="kicker">BUKKENOH BUSINESS PLAN</div>
      <h1>${esc(m.companyName || '（会社名未入力）')} 様</h1>
      <div class="meta">事業計画検討書　作成日：${esc(m.createdAt)}${m.openDate ? `　／　オープン予定日：${esc(m.openDate)}` : ''}</div>
    </div>`;
}

// 事業計画書 冒頭：黒字化のタイミングが一目でわかる月次棒グラフ（売上高／販売管理費／営業損益）
function renderBreakEvenChartSection(result) {
  const months = [...result.pl1.months, ...result.pl2.months];
  const monthlyProfit = [...result.pl1.operatingIncome, ...result.pl2.operatingIncome];
  // 営業損益を月次で積み上げた累計額。累計が初めてプラスに転じる月が事業全体としての黒字化タイミング。
  let running = 0;
  const cumulativeProfit = monthlyProfit.map(v => (running += v));
  const chart = renderBreakEvenBarChart(months, cumulativeProfit, { title: '' });
  return `
    <section class="report-section">
      <h2><span class="num">01</span> 黒字化のタイミング（月次24ヶ月）</h2>
      <p class="small text-muted">営業損益を毎月積み上げた累計額の棒グラフです。累計が初めてプラスに転じる月が、事業全体としての黒字化タイミングです。</p>
      ${chart}
    </section>`;
}

function renderBreakEvenSection(result) {
  const be = result.breakEven;
  const st = result.staff;
  return `
    <section class="report-section">
      <h2><span class="num">02</span> 損益分岐点と必要契約件数</h2>
      <div class="stat-cards">
        <div class="stat-card"><div class="label">人件費/年</div><div class="value">${yen(st.laborCostYear)}</div></div>
        <div class="stat-card"><div class="label">その他固定費/年</div><div class="value">${yen(result.otherCostsAnnual.grandTotal)}</div></div>
        <div class="stat-card"><div class="label">損益分岐点/年</div><div class="value gold">${yen(be.breakEvenAnnual)}</div></div>
        <div class="stat-card"><div class="label">損益分岐 必要契約数</div><div class="value">${num(be.requiredContractsYear)}<span class="small">件/年</span></div><div class="sub">月あたり ${num(be.requiredContractsMonth)}件</div></div>
        <div class="stat-card"><div class="label">目標契約件数（採用値）</div><div class="value gold">${num(be.targetContractsYear)}<span class="small">件/年</span></div><div class="sub">月あたり ${num(be.targetContractsMonth)}件</div></div>
      </div>
      <p class="small text-muted">目標契約件数の種別内訳（年間）：土地 ${num(be.targetLandCount)}件／中古系 ${num(be.targetUsedCount,1)}件／新築建売 ${num(be.targetNewCount,1)}件</p>
    </section>`;
}

function renderSimplePLSection(result) {
  const s = result.summary;
  function block(title, y) {
    return `
      <table class="plain">
        <thead><tr><th colspan="3">${esc(title)}</th></tr><tr><th>科目</th><th>件数</th><th>金額</th></tr></thead>
        <tbody>
          <tr><td>仲介手数料</td><td>${num(y.brokerage.count)}件</td><td>${yen(y.brokerage.amount)}</td></tr>
          <tr><td>リフォーム</td><td>―</td><td>${yen(y.reform.amount)}</td></tr>
          <tr><td>自社請負</td><td>―</td><td>${yen(y.selfBuild.amount)}</td></tr>
          <tr><td>他社紹介</td><td>―</td><td>${yen(y.referral.amount)}</td></tr>
          <tr><td>売上高 合計</td><td></td><td>${yenAcct(y.totalRevenue)}</td></tr>
          <tr><td>売上総利益 合計</td><td></td><td>${yenAcct(y.grossProfit)}</td></tr>
          <tr><td>販売管理費 合計</td><td></td><td>${yen(y.sgaTotal)}</td></tr>
        </tbody>
        <tfoot><tr><td>営業損益</td><td></td><td>${yenAcct(y.operatingIncome)}</td></tr></tfoot>
      </table>`;
  }
  return `
    <section class="report-section">
      <h2><span class="num">03</span> 簡易P&L（1年目・2年目）</h2>
      ${block('1年目（稼働約半年）', s.year1)}
      ${block('2年目', s.year2)}
    </section>`;
}

function monthlyPLTable(pl) {
  const lineLabels = [
    ['salary', '従業員給料'], ['legalWelfare', '法定福利費'], ['recruiting', '採用教育費'],
    ['adSpend', '広告宣伝費'], ['entertainment', '接待交際費'], ['travel', '旅費交通費'],
    ['communication', '通信費'], ['consumables', '消耗品費'], ['officeSupplies', '事務用品費'],
    ['equipment', '備品費'], ['utilities', '水道光熱費'], ['dues', '諸会費'], ['lease', 'リース料'],
    ['insurance', '保険料'], ['depreciation', '減価償却費'], ['tax', '租税公課'], ['misc', '雑費'],
    ['storeRunning', '店舗経費（ランニング）'], ['incentive', 'インセンティブ']
  ];
  const monthHeader = pl.months.map(m => `<th>${m}</th>`).join('');
  // 万円単位・整数表示にして列数の多い月次PLを極力コンパクトにする（表全体はヘッダーに単位：万円と明記）
  function row(label, arr, cls) { return `<tr${cls ? ` class="${cls}"` : ''}><td>${esc(label)}</td>${arr.map(v => `<td>${manUnitAcct(v)}</td>`).join('')}<td>${manUnitAcct(sumAll(arr))}</td></tr>`; }
  function countRow(label, arr) { return `<tr><td>${esc(label)}</td>${arr.map(v => `<td>${num(v)}件</td>`).join('')}<td>${num(sumAll(arr))}件</td></tr>`; }
  const lineRows = lineLabels.map(([key, label]) => row(label, pl.lines[key])).join('');
  // 研修費（成長投資費）＝研修費＋コンサル費（SV,PPC）を合算した1行で表示（入力を1項目に統一したのに合わせる）
  const trainingCombined = pl.lines.training.map((v, i) => v + pl.lines.consulting[i]);
  // 営業外収益＝受取利息＋雑収入、営業外費用＝支払利息＋雑損失
  return `
    <div class="table-scroll">
    <table class="plain pl-table-compact">
      <thead><tr><th>科目（単位：万円）</th>${monthHeader}<th>合計</th></tr></thead>
      <tbody>
        ${countRow('仲介契約件数', pl.contracts)}
        ${row('仲介手数料', pl.brokerageRevenue, 'pl-row-brokerage')}
        ${row('リフォーム', pl.reformRevenue, 'pl-row-construction')}
        ${row('自社請負', pl.selfBuildRevenue, 'pl-row-construction')}
        ${row('他社紹介', pl.referralRevenue, 'pl-row-referral')}
        ${row('売上高 合計', pl.totalRevenue, 'row-subtotal')}
        ${row('売上原価', pl.totalCogs)}
        ${row('売上総利益', pl.grossProfit, 'row-subtotal')}
        ${lineRows}
        ${row('研修費（成長投資費）', trainingCombined)}
        ${row('販売管理費 計', pl.sgaTotal, 'row-highlight')}
        ${row('営業損益', pl.operatingIncome, 'row-highlight')}
        ${row('営業外収益', pl.nonOperatingIncome, 'row-subtotal')}
        ${row('営業外費用', pl.nonOperatingExpense, 'row-subtotal')}
        ${row('経常損益', pl.ordinaryIncome, 'row-final')}
        ${row('特別利益・損失', pl.extraordinaryItems)}
        ${row('税引前当期純損益', pl.incomeBeforeTax, 'row-subtotal')}
        ${row('法人税等', pl.corporateTax)}
        ${row('当期純損益', pl.netIncome, 'row-final')}
        ${row('総資産', pl.cumulativeAssets, 'row-subtotal')}
      </tbody>
    </table>
    </div>`;
}

function renderMonthlyPLSection(result) {
  return `
    <section class="report-section">
      <h2><span class="num">04</span> 月次P&L</h2>
      <p class="small text-muted">金額は万円単位です。横にスクロールしても科目名は左端に固定表示されます。仲介手数料・建築費（リフォーム／自社請負）・紹介料（他社紹介）は科目名を色分けしています。</p>
      <h3>PL（1年目）月次詳細</h3>
      ${monthlyPLTable(result.pl1)}
      <h3>PL（2年目以降）月次詳細</h3>
      ${monthlyPLTable(result.pl2)}
    </section>`;
}

function renderSynergySection(result) {
  const bp = result.businessPlan;
  function row(key, label, cfg) {
    const s = bp[key];
    return `<tr><td>${esc(label)}${cfg.enabled ? '' : '（未対応）'}</td><td>${yen(cfg.unitPrice)}</td><td>${cfg.profitRate !== undefined ? pct(cfg.profitRate) : '―'}</td><td>${pct(cfg.allocRate)}</td><td>${num(s.annualFreq)}件/年</td><td>${yen(s.annualProfit)}</td></tr>`;
  }
  return `
    <section class="report-section">
      <h2><span class="num">05</span> 建築事業の利益イメージ</h2>
      <div class="table-scroll">
      <table class="plain">
        <thead><tr><th>事業</th><th>単価</th><th>利益率</th><th>不動産分配利益率</th><th>年間受注頻度</th><th>年間利益</th></tr></thead>
        <tbody>
          ${row('reform', 'リフォーム事業', appState.synergy.reform)}
          ${row('selfBuild', '新築住宅事業（自社請負）', appState.synergy.selfBuild)}
          ${row('referral', '他社建築紹介', appState.synergy.referral)}
        </tbody>
        <tfoot><tr><td colspan="5">年間利益 合計</td><td>${yen(bp.reform.annualProfit + bp.selfBuild.annualProfit + bp.referral.annualProfit)}</td></tr></tfoot>
      </table>
      </div>
    </section>`;
}

// 「② 全体フロー・スケジュール」タブの独立ビュー
function renderScheduleView() {
  const main = document.getElementById('appMain');
  const diagram = renderGanttDiagram(GANTT_LANES, GANTT_ITEMS, 120, { title: '' });
  main.innerHTML = `
    <div class="card">
      <h2>全体フロー・スケジュール（研修①〜⑨）</h2>
      <p class="desc">加盟契約を起点として、①〜⑨の研修（丸番号）とその他マイルストーンをレーン別に配置した全体フローです。元テンプレートのガントチャートに暦日付の計算式は無いため、実際の日付は物件王担当者との打合せで確定してください。</p>
      ${diagram}
      <p class="small text-muted">※①〜⑨の丸番号（またはそのチップ）をタップ／クリックすると、該当する研修・MTGの詳細がここに表示されます。</p>
      <div id="ganttDetailPanel" class="gantt-detail-panel"></div>
    </div>`;
}

// 全体フローの①〜⑨チップがタップされた時に、該当する研修詳細（TRAINING_DETAILS）を
// #ganttDetailPanel にインラインで表示する。charts.js の renderGanttDiagram が
// 生成するSVG内のonclickから呼び出されるグローバル関数。
function showGanttDetail(no) {
  const panel = document.getElementById('ganttDetailPanel');
  if (!panel) return;
  const t = trainingDetailByNo(no);
  if (!t) return;
  panel.innerHTML = `
    <div class="gantt-detail-card">
      <div class="head">
        <span class="no">${esc(t.no)}</span>
        <strong>${esc(t.name)}</strong>
        <button type="button" class="close-btn" aria-label="閉じる" onclick="document.getElementById('ganttDetailPanel').innerHTML=''">✕</button>
      </div>
      <div class="meta-line">対象: ${esc(t.audience)} ／ 日程: ${esc(t.schedule)}</div>
      <p>${esc(t.content)}</p>
    </div>`;
  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

