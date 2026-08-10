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
    ${renderScheduleSection()}
    ${renderAreaSection(result)}
    ${renderBreakEvenSection(result)}
    ${renderSimplePLSection(result)}
    ${renderMonthlyPLSection(result)}
    ${renderSynergySection(result)}
    ${renderDecisionSummarySection(result)}
    ${renderAppendixSection()}
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

function renderAreaSection(result) {
  const a = result.areas;
  const rows = a.details.map((d, i) => {
    const ar = appState.areas[i];
    return `<tr>
      <td>${esc(ar.name || 'エリア' + (i + 1))}</td>
      <td>${num(ar.households)}世帯</td>
      <td>${num(d.totalCount)}件</td>
      <td>${man(d.feePerDealMan)}</td>
      <td>${yen(d.revenueMan * 10000)}</td>
    </tr>`;
  }).join('');
  return `
    <section class="report-section">
      <h2><span class="num">02</span> ターゲットエリア分析</h2>
      <div class="table-scroll">
        <table class="plain">
          <thead><tr><th>エリア</th><th>世帯数</th><th>物件数</th><th>手数料/件（加重平均）</th><th>手数料合計</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="2">合計</td><td>${num(a.totalCount)}件</td><td>${man(a.avgFeeManOverall)}</td><td>${yen(a.totalRevenueMan * 10000)}</td></tr></tfoot>
        </table>
      </div>
      <div class="stat-cards">
        <div class="stat-card"><div class="label">物件種別構成比（土地／中古系／新築建売）</div><div class="value" style="font-size:1.1em">${pct(a.landRatio,0)} / ${pct(a.usedRatio,0)} / ${pct(a.newRatio,0)}</div></div>
        <div class="stat-card"><div class="label">実勢手数料単価（PL計算用）</div><div class="value gold">${yen(a.feeRoundedYen)}</div></div>
      </div>
      <h3>エリア別・物件種別ごとの手数料と構成比</h3>
      <p class="small text-muted">基本構成比（種別ごとの物件数比率）は入力に応じて自動再計算されます。構成比手数料＝手数料×基本構成比。</p>
      ${a.details.map((d, i) => areaTypeBreakdownTable(appState.areas[i].name || 'エリア' + (i + 1), d, false)).join('')}
    </section>`;
}

function renderBreakEvenSection(result) {
  const be = result.breakEven;
  const st = result.staff;
  return `
    <section class="report-section">
      <h2><span class="num">03</span> 損益分岐点と必要契約件数</h2>
      <div class="stat-cards">
        <div class="stat-card"><div class="label">人件費/年</div><div class="value">${yen(st.laborCostYear)}</div></div>
        <div class="stat-card"><div class="label">その他固定費/年</div><div class="value">${yen(result.otherCostsAnnual.grandTotal)}</div></div>
        <div class="stat-card"><div class="label">損益分岐点/年</div><div class="value gold">${yen(be.breakEvenAnnual)}</div></div>
        <div class="stat-card"><div class="label">損益分岐 必要契約数</div><div class="value">${num(be.requiredContractsYear)}<span class="small">件/年</span></div><div class="sub">月あたり ${num(be.requiredContractsMonth)}件</div></div>
        <div class="stat-card"><div class="label">目標利益上乗せ後 必要契約数</div><div class="value">${num(be.targetContractsYear)}<span class="small">件/年</span></div><div class="sub">月あたり ${num(be.targetContractsMonth)}件</div></div>
        <div class="stat-card"><div class="label">必要契約件数（採用値）</div><div class="value gold">${num(appState.confirmedContractsPerMonth)}<span class="small">件/月</span></div></div>
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
          <tr><td>売上総利益 合計</td><td></td><td>${yenAcct(y.totalRevenue)}</td></tr>
          <tr><td>販売管理費 合計</td><td></td><td>${yen(y.sgaTotal)}</td></tr>
        </tbody>
        <tfoot><tr><td>営業損益</td><td></td><td>${yenAcct(y.operatingIncome)}</td></tr></tfoot>
      </table>`;
  }
  const pieYear1 = renderPieChart(
    ['仲介手数料', 'リフォーム', '自社請負', '他社紹介'],
    [s.year1.brokerage.amount, s.year1.reform.amount, s.year1.selfBuild.amount, s.year1.referral.amount],
    { title: '売上割合（1年目）' }
  );
  const pieYear2 = renderPieChart(
    ['仲介手数料', 'リフォーム', '自社請負', '他社紹介'],
    [s.year2.brokerage.amount, s.year2.reform.amount, s.year2.selfBuild.amount, s.year2.referral.amount],
    { title: '売上割合（2年目）' }
  );
  return `
    <section class="report-section">
      <h2><span class="num">04</span> 簡易P&L（1年目・2年目）</h2>
      <div class="pie-row">${pieYear1}${pieYear2}</div>
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
    ['training', '研修費等'], ['consulting', 'コンサル費（SV,PPC）'], ['storeRunning', '店舗経費（ランニング）'],
    ['incentive', 'インセンティブ']
  ];
  const monthHeader = pl.months.map(m => `<th>${m}</th>`).join('');
  function row(label, arr) { return `<tr><td>${esc(label)}</td>${arr.map(v => `<td>${yenAcct(v)}</td>`).join('')}<td>${yenAcct(sumAll(arr))}</td></tr>`; }
  function countRow(label, arr) { return `<tr><td>${esc(label)}</td>${arr.map(v => `<td>${num(v)}件</td>`).join('')}<td>${num(sumAll(arr))}件</td></tr>`; }
  const lineRows = lineLabels.map(([key, label]) => row(label, pl.lines[key])).join('');
  return `
    <div class="table-scroll">
    <table class="plain">
      <thead><tr><th>科目</th>${monthHeader}<th>合計</th></tr></thead>
      <tbody>
        ${countRow('仲介契約件数', pl.contracts)}
        ${row('仲介手数料', pl.brokerageRevenue)}
        ${row('リフォーム', pl.reformRevenue)}
        ${row('自社請負', pl.selfBuildRevenue)}
        ${row('他社紹介', pl.referralRevenue)}
        <tr class="row-subtotal"><td>売上高 合計</td>${pl.totalRevenue.map(v=>`<td>${yenAcct(v)}</td>`).join('')}<td>${yenAcct(sumAll(pl.totalRevenue))}</td></tr>
        ${row('売上原価', pl.totalCogs)}
        <tr class="row-subtotal"><td>売上総利益</td>${pl.grossProfit.map(v=>`<td>${yenAcct(v)}</td>`).join('')}<td>${yenAcct(sumAll(pl.grossProfit))}</td></tr>
        ${lineRows}
        <tr class="row-highlight"><td>販売管理費 計</td>${pl.sgaTotal.map(v=>`<td>${yenAcct(v)}</td>`).join('')}<td>${yenAcct(sumAll(pl.sgaTotal))}</td></tr>
      </tbody>
      <tfoot>
        <tr><td>営業損益</td>${pl.operatingIncome.map(v=>`<td>${yenAcct(v)}</td>`).join('')}<td>${yenAcct(sumAll(pl.operatingIncome))}</td></tr>
      </tfoot>
    </table>
    </div>`;
}

function renderMonthlyPLSection(result) {
  return `
    <section class="report-section">
      <h2><span class="num">05</span> 月次P&L</h2>
      <p class="small text-muted">横にスクロールしても科目名は左端に固定表示されます。</p>
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
      <h2><span class="num">06</span> 建築事業の利益イメージ</h2>
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

function renderScheduleSection() {
  const diagram = renderGanttDiagram(GANTT_LANES, GANTT_ITEMS, 120, { title: '' });
  return `
    <section class="report-section">
      <h2><span class="num">01</span> 全体フロー・スケジュール（研修①〜⑨）</h2>
      <p class="small text-muted">加盟契約を起点として、①〜⑨の研修（丸番号）とその他マイルストーンをレーン別に配置した全体フローです。元テンプレートのガントチャートに暦日付の計算式は無いため、実際の日付は物件王担当者との打合せで確定してください。</p>
      ${diagram}
      <p class="small text-muted">※①〜⑨の丸番号（またはそのチップ）をタップ／クリックすると、該当する研修・MTGの詳細がここに表示されます。</p>
      <div id="ganttDetailPanel" class="gantt-detail-panel"></div>
    </section>`;
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

function renderDecisionSummarySection(result) {
  const a = result.areas;
  const bp = result.businessPlan;
  const s = result.summary;
  const areaNames = appState.areas.map(a => a.name).filter(Boolean).join('、');
  return `
    <section class="report-section">
      <h2><span class="num">07</span> 決定事項サマリー【決定事項確認書】</h2>
      <div class="stat-cards">
        <div class="stat-card"><div class="label">ターゲットエリア</div><div class="value" style="font-size:1.1em">${esc(areaNames || '未設定')}</div></div>
        <div class="stat-card"><div class="label">対象世帯数 合計</div><div class="value">${num(a.householdsTotal)}<span class="small">世帯</span></div></div>
        <div class="stat-card"><div class="label">会員登録目標/月</div><div class="value">${num(bp.targetLeads)}<span class="small">件</span></div></div>
        <div class="stat-card"><div class="label">広告予算/月</div><div class="value">${yen(bp.adBudgetMonthBaseTax)}</div></div>
        <div class="stat-card"><div class="label">広告予算（オープンより半年）</div><div class="value">${yen(bp.adBudgetMonthBoostedTax)}</div></div>
      </div>
      <table class="plain">
        <thead><tr><th>売上（粗利益）イメージ</th><th>初年度</th><th>次年度</th></tr></thead>
        <tbody>
          <tr><td>仲介手数料</td><td>${yen(s.year1.brokerage.amount)}</td><td>${yen(s.year2.brokerage.amount)}</td></tr>
          <tr><td>リフォーム</td><td>${yen(s.year1.reform.amount)}</td><td>${yen(s.year2.reform.amount)}</td></tr>
          <tr><td>自社請負</td><td>${yen(s.year1.selfBuild.amount)}</td><td>${yen(s.year2.selfBuild.amount)}</td></tr>
          <tr><td>他社紹介</td><td>${yen(s.year1.referral.amount)}</td><td>${yen(s.year2.referral.amount)}</td></tr>
        </tbody>
      </table>
      <p class="small text-muted">＊上記の広告予算を遅くとも営業開始日より投下する事によって反響目標達成に努める。現段階でエリアが未決定の場合、本ミーティングより10日以内に設定を行うものとします。</p>
      <div class="signature-block no-print-avoid">
        <div class="sig"><div class="signature-line"></div><div class="small">加盟店様　ご署名</div></div>
        <div class="sig"><div class="signature-line"></div><div class="small">物件王　担当者</div></div>
      </div>
    </section>`;
}

function renderAppendixSection() {
  const sl = appState.storeLayout;
  const totalArea = sl.shelf + sl.meetingRoom + sl.kidsSpace + sl.restroom + sl.office + sl.kitchenette;
  const layoutHtml = STORE_LAYOUT_SECTIONS.map(sec => `
    <div class="appendix-item">
      <div class="head"><span class="no">${esc(sec.no)}</span><strong>${esc(sec.name)}</strong><span class="small text-muted">必要最小面積：${num(sl[sec.key],1)}㎡</span></div>
      ${sec.body.map(p => `<p>${esc(p)}</p>`).join('')}
    </div>`).join('');

  return `
    <section class="report-section">
      <h2><span class="num">付</span> 店舗内装（付録）</h2>
      <details class="collapsible">
        <summary>店舗内装：必要スペース（合計 ${num(totalArea,1)}㎡ ／ 約${Math.ceil(totalArea * TSUBO_FACTOR)}坪）</summary>
        <p>物件王では、最低でも店舗の面積は15坪以上ある事が望ましいと考えています。内訳は下記の通りです。</p>
        ${layoutHtml}
      </details>
    </section>`;
}
