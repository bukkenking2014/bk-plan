/*
 * sim-sheet-map.js
 * 「事業計画シミュレーター」のスプレッドシート（会社フォルダの「会社名_事業計画シミュレーター」）に
 * 書き込む内容を作る。
 *   ・土台は、元の事業計画書のひな形（12シート）。レイアウト・見た目はひな形のまま使う。
 *   ・数字は、ひな形の数式ではなく、シミュレーターの計算結果を「値」で入れる
 *     （サマリー・グラフと数字が一致する。シートで直しても再計算はされない）。
 *   ・先頭の「サマリー」「グラフ」は、シミュレーター独自のシート（xlsx-export.js で作る）。
 * 書き込み先は gas-backend/SheetFactory.gs の applySimCells_ が受け取る形式
 *   [{ sheet, a1, values: [[...]] }]
 * で返す。
 */

const SIM_TEMPLATE_NAME_CLIENT = '事業計画シミュレーター_ひな形';

function simCell(sheet, a1, value) { return { sheet, a1, values: [[value]] }; }
function simRow(sheet, a1, arr) { return { sheet, a1, values: [arr] }; }
function simCol(sheet, a1, arr) { return { sheet, a1, values: arr.map(v => [v]) }; }
const simNum = v => (v === null || v === undefined || isNaN(v) ? 0 : Number(v));
const simSum = (a, from, to) => a.slice(from, to).reduce((s, v) => s + simNum(v), 0);

/* ---------------- 入力欄（ひな形の入力セル） ---------------- */
function simInputCells(state) {
  const out = [];
  const m = state.meta || {};
  out.push(simCell('社名', 'C15', m.companyName || ''));

  // 免許：D3（有り/無し）、D9（県申請）、D14:D21（協会申請）
  const lic = state.license;
  out.push(simCell('免許', 'D3', lic.hasLicense ? '有り' : '無し'));
  const amt = key => { const it = lic.items.find(x => x.key === key); return it ? simNum(it.amount) : 0; };
  out.push(simCell('免許', 'D9', amt('registrationTax')));
  out.push(simCol('免許', 'D14', ['associationFee', 'signboard', 'associationAnnualFee', 'guaranteeAssocFee', 'guaranteeDeposit', 'guaranteeAnnualFee', 'realEstateCourse', 'politicalLeague'].map(amt)));

  // ターゲットエリア：CPC、エリア名・世帯数（C6:C11, K6:K11）、種別ごとの物件数・金額（エリアごとに6行おき）
  out.push(simCell('ターゲットエリア', 'AV3', simNum(state.cpc)));
  const TYPE_KEYS = ['land', 'usedHouse', 'newHouse', 'mansion'];
  const START_ROWS = [17, 23, 29, 35, 41, 47];
  for (let k = 0; k < 6; k++) {
    const a = (state.areas || [])[k];
    out.push(simCell('ターゲットエリア', 'C' + (6 + k), a ? (a.name || '') : ''));
    out.push(simCell('ターゲットエリア', 'K' + (6 + k), a ? simNum(a.households) : ''));
    out.push(simCol('ターゲットエリア', 'K' + START_ROWS[k], TYPE_KEYS.map(t => (a ? simNum(a[t].count) : ''))));
    out.push(simCol('ターゲットエリア', 'Q' + START_ROWS[k], TYPE_KEYS.map(t => (a ? simNum(a[t].priceMan) : ''))));
  }

  // 目標設定：給与 E7:E12（店長1／エージェント3／サポート2）、年間営業利益目標 B21、対応事業 ■／□
  const s = state.staff;
  const sal = (list, i) => (list[i] ? simNum(list[i].salary) : '');
  out.push(simCol('目標設定', 'E7', [sal(s.managers, 0), sal(s.agents, 0), sal(s.agents, 1), sal(s.agents, 2), sal(s.supports, 0), sal(s.supports, 1)]));
  out.push(simCell('目標設定', 'B21', simNum(state.targetProfitAnnual)));
  const sy = state.synergy;
  out.push(simCell('目標設定', 'D38', sy.reform.enabled ? '■' : '□'));
  out.push(simCell('目標設定', 'K38', sy.selfBuild.enabled ? '■' : '□'));
  out.push(simCell('目標設定', 'U38', sy.referral.enabled ? '■' : '□'));

  // 事業検討
  const ad = state.ad, oc = state.otherCosts, ic = state.initialCost;
  out.push(simCell('事業検討', 'F11', simNum(state.confirmedContractsPerMonth)));
  out.push(simCell('事業検討', 'G30', simNum(ad.cvr)));
  out.push(simCol('事業検討', 'D26', [simNum(ad.other1), simNum(ad.other2), simNum(ad.portal), simNum(ad.assessmentSite)]));
  out.push(simCell('事業検討', 'C25', simNum(ad.targetLeads)));
  out.push(simRow('事業検討', 'S36', [simNum(sy.reform.unitPrice), simNum(sy.reform.profitRate), simNum(sy.reform.allocRate)]));
  out.push(simRow('事業検討', 'S37', [simNum(sy.selfBuild.unitPrice), simNum(sy.selfBuild.profitRate), simNum(sy.selfBuild.allocRate)]));
  out.push(simCell('事業検討', 'S38', simNum(sy.referral.unitPrice)));
  out.push(simCell('事業検討', 'U38', simNum(sy.referral.allocRate)));
  out.push(simCol('事業検討', 'Y37', [simNum(sy.reform.conversionRate), simNum(sy.selfBuild.conversionRate), simNum(sy.referral.conversionRate)]));
  out.push(simCol('事業検討', 'AA37', [simNum(sy.reform.conversionRate), simNum(sy.selfBuild.conversionRate), simNum(sy.referral.conversionRate)]));
  out.push(simRow('事業検討', 'Y43', [simNum(sy.selfBuild.capSolo), simNum(sy.selfBuild.capTeam)]));
  out.push(simRow('事業検討', 'Y44', [simNum(sy.referral.capSolo), simNum(sy.referral.capTeam)]));
  out.push(simCell('事業検討', 'L18', simNum(oc.consumables)));
  out.push(simCell('事業検討', 'L21', simNum(oc.officeSupplies)));
  out.push(simCell('事業検討', 'L24', simNum(oc.dues)));
  out.push(simCell('事業検討', 'L28', simNum(oc.utilities)));
  out.push(simCell('事業検討', 'L31', simNum(oc.lease)));
  out.push(simCell('事業検討', 'L37', simNum(oc.misc)));
  out.push(simCol('事業検討', 'L42', [simNum(oc.training), simNum(oc.ppcConsulting), simNum(oc.svConsulting)]));
  out.push(simCol('事業検討', 'C43', [simNum(oc.recruiting), simNum(oc.entertainment), simNum(oc.insurance), simNum(oc.storeRent)]));
  out.push(simCell('事業検討', 'L46', 0));
  out.push(simCell('事業検討', 'C48', oc.depreciationType || '改装'));
  out.push(simCell('事業検討', 'L51', simNum(ic.franchiseFee)));
  out.push(simCell('事業検討', 'L54', simNum(oc.renovationCostBasis)));
  out.push(simCell('事業検討', 'L55', simNum(ic.signageCost)));
  out.push(simCell('事業検討', 'O63', simNum(oc.assumedPpcAnnual)));
  return out;
}

/* ---------------- PL（1年目／2年目以降）：月次の数字をシミュレーターの結果で入れる ---------------- */
// [行, 取り出し方]。月の列は D〜I（前半6ヵ月）・K〜P（後半6ヵ月）、J＝上期合計、Q＝下期合計、R＝当期合計。
function simPlRows(pl) {
  const z = Array(12).fill(0);
  const L = pl.lines;
  return [
    [2, pl.totalRevenue], [3, pl.contracts], [4, pl.brokerageRevenue], [5, pl.reformRevenue], [6, pl.selfBuildRevenue], [7, pl.referralRevenue],
    [8, pl.totalCogs], [9, pl.grossProfit],
    [12, L.salary], [13, L.legalWelfare], [14, L.recruiting], [15, L.adSpend], [16, L.entertainment], [17, L.travel], [18, L.communication],
    [19, L.consumables], [20, L.officeSupplies], [21, L.equipment], [22, L.utilities], [23, L.dues], [24, L.lease], [25, L.insurance],
    [26, L.depreciation], [27, L.tax], [28, L.misc], [29, L.training], [30, L.consulting], [31, L.storeRunning],
    [32, z],            // インセンティブ：シミュレーターでは計上しない
    [33, z],            // 店舗組成費（イニシャル）：シミュレーターの損益には含めない（事業検討シートに記載）
    [37, pl.sgaTotal], [40, pl.operatingIncome],
    [43, pl.nonOperatingIncomeLines.interestIncome], [44, pl.nonOperatingIncomeLines.miscIncome], [45, pl.nonOperatingIncome],
    [46, pl.nonOperatingExpenseLines.interestExpense], [47, pl.nonOperatingExpenseLines.miscLoss], [48, pl.nonOperatingExpense],
    [50, pl.ordinaryIncome], [53, pl.extraordinaryItems], [54, pl.incomeBeforeTax], [56, pl.corporateTax], [57, pl.netIncome]
  ];
}
function simPlCells(sheet, pl) {
  const out = [];
  simPlRows(pl).forEach(([row, arr]) => {
    const v = arr.map(simNum);
    // D..R の15列：前半6ヵ月, 上期合計, 後半6ヵ月, 下期合計, 当期合計
    out.push(simRow(sheet, 'D' + row, [...v.slice(0, 6), simSum(v, 0, 6), ...v.slice(6, 12), simSum(v, 6, 12), simSum(v, 0, 12)]));
  });
  // 総資産（累計）：行68（合計列なし）
  const a = pl.cumulativeAssets.map(simNum);
  out.push(simRow(sheet, 'D68', [...a.slice(0, 6), '', ...a.slice(6, 12), '', '']));
  return out;
}

/* ---------------- 簡易PL ---------------- */
function simSummaryPlCells(result) {
  const bp = result.businessPlan;
  return [
    simCell('簡易PL', 'D7', simNum(bp.reform.annualFreq)),
    simCell('簡易PL', 'D8', simNum(bp.selfBuild.annualFreq)),
    simCell('簡易PL', 'D9', simNum(bp.referral.annualFreq)),
    simCell('簡易PL', 'I7', simNum(bp.reform.annualFreq))
  ];
}

// ひな形に書き込む内容すべて
function buildSimCells(state, result) {
  return [
    ...simInputCells(state),
    ...simPlCells('PL（1年目）', result.pl1),
    ...simPlCells('PL（2年目以降）', result.pl2),
    ...simSummaryPlCells(result)
  ];
}

// 先頭に入れる「サマリー」「グラフ」だけの Excel（Google スプレッドシートに変換して使う）
async function buildSummaryChartBytes() {
  const state = appState;
  const result = runFullCalculation(state);
  const logo = await loadLogoForExcel();
  const book = new XlsxBook();
  if (logo) book.logo = logo;
  xlsxSummarySheet(book, state, result);
  xlsxChartSheet(book, state, result);
  return book.build();
}
