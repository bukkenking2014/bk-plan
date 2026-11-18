/*
 * calc.js
 * 元Excel「260708_事業計画検討書_雛型」の数式をJavaScriptに翻訳した計算エンジン。
 * 各関数のコメントに元シート・セル番地を明記し、勝手な簡略化をしていないことを追跡できるようにしている。
 *
 * 計算順序（シート間参照の依存関係順）:
 *   1. staff        … 目標設定シート（人員・給与）
 *   2. areas         … ターゲットエリアシート（手数料単価・構成比）
 *   3. license       … 免許シート
 *   4. otherCostsAnnual（事業検討ステージ1: その他費用年額）
 *   5. breakEven     … 目標設定ステージ2（損益分岐点・目標契約数）
 *   6. businessPlan（事業検討ステージ2: 広告費・建築シナジー・初期費用等）
 *   7. pl1 / pl2     … PL（1年目）/ PL（2年目以降）月次
 *   8. summary       … 簡易PL・決定事項
 */

const MONTHS_1 = ['1ヵ月','2ヵ月','3ヵ月','4ヵ月','5ヵ月','6ヵ月','7ヵ月','8ヵ月','9ヵ月','10ヵ月','11ヵ月','12ヵ月'];
const MONTHS_2 = ['13ヵ月','14ヵ月','15ヵ月','16ヵ月','17ヵ月','18ヵ月','19ヵ月','20ヵ月','21ヵ月','22ヵ月','23ヵ月','24ヵ月'];

function roundDown(n, digits) {
  const f = Math.pow(10, digits);
  return Math.floor(n * f) / f;
}
function roundUp(n, digits) {
  const f = Math.pow(10, digits);
  return Math.ceil(n * f) / f;
}
// 件数・金額・料率など、負の値になり得ない入力値を防御的に0以上へ丸める
// （入力欄側でも0未満は弾いているが、既存の保存データ等に負の値が残っていた場合の保険）
function nonNeg(v) {
  const n = Number(v);
  if (isNaN(n) || n < 0) return 0;
  return n;
}

/* ---------------------------------------------------------------------- */
/* 1. 目標設定シート：人員体制・給与                                       */
/* ---------------------------------------------------------------------- */
function computeStaff(state) {
  const managers = (state.staff.managers || []).map(m => nonNeg(m.salary));
  const agents = (state.staff.agents || []).map(a => nonNeg(a.salary));
  const supports = (state.staff.supports || []).map(s => nonNeg(s.salary));

  // 目標設定!I7 = SUM(E7:H12) 人件費/月
  const laborCostMonth = [...managers, ...agents, ...supports].reduce((s, v) => s + v, 0);
  // 目標設定!M7 = I7*12
  const laborCostYear = laborCostMonth * 12;

  // 事業検討!P7「営業合計」= 店長+エージェントで給与>0の人数
  const salesHeadcount = managers.filter(v => v > 0).length + agents.filter(v => v > 0).length;
  // 事業検討!P12「メンバー合計」= 営業合計+サポート人数
  const supportHeadcount = supports.filter(v => v > 0).length;
  const totalHeadcount = salesHeadcount + supportHeadcount;

  return { managers, agents, supports, laborCostMonth, laborCostYear, salesHeadcount, supportHeadcount, totalHeadcount };
}

/* ---------------------------------------------------------------------- */
/* 2. ターゲットエリアシート：手数料単価・構成比                            */
/* ---------------------------------------------------------------------- */
// 仲介手数料早見表（ターゲットエリア!Y17等）: Q=物件価格(万円) → 手数料(万円)
function commissionFeeMan(priceMan) {
  if (!priceMan || priceMan <= 0) return 0;
  if (priceMan < 800) return 30;
  return priceMan * 0.03 + 6;
}

const PROPERTY_TYPES = ['land', 'usedHouse', 'newHouse', 'mansion'];

function computeAreaDetail(area) {
  const counts = {}, prices = {}, fees = {};
  let totalCount = 0;
  PROPERTY_TYPES.forEach(t => {
    counts[t] = nonNeg(area[t].count);
    prices[t] = nonNeg(area[t].priceMan);
    fees[t] = commissionFeeMan(prices[t]);
    totalCount += counts[t];
  });
  const compRatio = {}, weightedFee = {};
  PROPERTY_TYPES.forEach(t => {
    compRatio[t] = totalCount === 0 ? 0 : counts[t] / totalCount;
    weightedFee[t] = fees[t] * compRatio[t];
  });
  // ターゲットエリア!AT17 = ROUNDDOWN(SUM(AM17:AS20),1)
  const feePerDealMan = roundDown(PROPERTY_TYPES.reduce((s, t) => s + weightedFee[t], 0), 1);
  const revenueMan = totalCount * feePerDealMan; // ターゲットエリア!AT21
  // 参考表示: 世帯数からの想定物件数（1万世帯×100件）
  const estimatedPropertiesFromHouseholds = ((Number(area.households) || 0) / 10000) * 100;
  return { counts, prices, fees, compRatio, weightedFee, totalCount, feePerDealMan, revenueMan, estimatedPropertiesFromHouseholds };
}

function computeAreas(state) {
  const details = (state.areas || []).map(computeAreaDetail);
  const totalCount = details.reduce((s, d) => s + d.totalCount, 0);
  const totalRevenueMan = details.reduce((s, d) => s + d.revenueMan, 0);
  // ターゲットエリア!Y101（全エリア加重平均・万円/件）
  const avgFeeManOverall = totalCount === 0 ? 0 : totalRevenueMan / totalCount;

  // 3区分の構成比（目標設定!Z4,AE4,AJ4相当）: 中古系 = 中古戸建+マンション、新築建売 = 新築戸建のみ
  let landTotal = 0, usedCatTotal = 0, newCatTotal = 0, householdsTotal = 0;
  (state.areas || []).forEach(a => {
    landTotal += Number(a.land.count) || 0;
    usedCatTotal += (Number(a.usedHouse.count) || 0) + (Number(a.mansion.count) || 0);
    newCatTotal += Number(a.newHouse.count) || 0;
    householdsTotal += Number(a.households) || 0;
  });
  const grandTotal = landTotal + usedCatTotal + newCatTotal;
  const landRatio = grandTotal ? landTotal / grandTotal : 0;
  const usedRatio = grandTotal ? usedCatTotal / grandTotal : 0;
  const newRatio = grandTotal ? newCatTotal / grandTotal : 0;

  const feeRawYen = avgFeeManOverall * 10000; // ターゲットエリア!AV6*10000（未丸め、目標設定の損益分岐点計算用）
  // 事業検討!E4 = ROUNDDOWN(ターゲットエリア!AV6*10000, -3)（実績PL計算用）
  const feeRoundedYen = roundDown(feeRawYen, -3);

  // 種別（土地／中古戸建／新築戸建／マンション）ごとの全エリア合計件数・金額
  const typeTotals = {};
  PROPERTY_TYPES.forEach(t => {
    const count = details.reduce((s, d) => s + d.counts[t], 0);
    typeTotals[t] = {
      count,
      amountMan: details.reduce((s, d) => s + d.counts[t] * d.fees[t], 0),
      // 全エリアを通した平均価格（件数で重み付け。万円）。件数0なら null
      avgPriceMan: count === 0 ? null : details.reduce((s, d) => s + d.counts[t] * d.prices[t], 0) / count
    };
  });

  // レインズ物件数 = 全エリア合計物件数 × 1.1
  const rainsCount = totalCount * 1.1;
  // 世帯物件数 = 全エリア世帯数 ÷ 10000 × 100（ターゲットエリア!S6 = K12/10000*100）
  const householdProps = householdsTotal / 10000 * 100;

  return {
    details, totalCount, rainsCount, householdProps, totalRevenueMan, avgFeeManOverall,
    landRatio, usedRatio, newRatio, householdsTotal, typeTotals,
    feeRawYen, feeRoundedYen
  };
}

/* ---------------------------------------------------------------------- */
/* 3. 免許シート                                                          */
/* ---------------------------------------------------------------------- */
function computeLicense(state) {
  // 都道府県・協会により金額が異なるため、金額は appState.license.items（編集可能）から取得する
  const items = state.license.items;
  const prefectureSubtotal = items.filter(i => i.group === 'prefecture').reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const associationSubtotal = items.filter(i => i.group === 'association').reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const total = prefectureSubtotal + associationSubtotal;
  // 事業検討!L50 = IF(免許!D3="無し", 免許!D24, 0)
  const costInBusinessPlan = state.license.hasLicense ? 0 : total;
  return { items, prefectureSubtotal, associationSubtotal, total, costInBusinessPlan };
}

/* ---------------------------------------------------------------------- */
/* 4. 事業検討シート ステージ1：その他費用（年額）                          */
/* ---------------------------------------------------------------------- */
function computeOtherCostsAnnual(state, staff) {
  const oc = state.otherCosts;
  // 旅費交通費: 事業検討!L13(月)=P7*30000, L12(年)=L13*12
  const travelMonth = staff.salesHeadcount * 30000;
  // 通信費: L16(月)=P7*15000+25000, L15(年)=L16*12
  const commMonth = staff.salesHeadcount * 15000 + 25000;
  // 消耗品費: L18(年,入力) → L19(月)=ROUNDUP(L18/12,-3)
  const consumablesMonth = roundUp(oc.consumables / 12, -3);
  // 事務用品費: L21(年,入力) → L22(月)=ROUNDUP(L21/12,-2)
  const officeSuppliesMonth = roundUp(oc.officeSupplies / 12, -2);
  // 備品費: L26(年)=P12*100000 ※月1回・開店時一括計上として扱う
  const equipmentLumpSum = staff.totalHeadcount * 100000;
  // 水道光熱費: L28(年,入力) → L29(月)=ROUNDUP(L28/12,-2)
  const utilitiesMonth = roundUp(oc.utilities / 12, -2);
  // リース料: L31(年,入力) → L32(月)=ROUNDUP(L31/12,-3)
  const leaseMonth = roundUp(oc.lease / 12, -3);
  // 租税公課: L35(月)=F11(確定契約件数/月)*10000, L34(年)=L35*12
  const taxMonth = nonNeg(state.confirmedContractsPerMonth) * 10000;
  // 研修費（成長投資費）: L41(月)=L42+L43+L44, L40(年)=L41*12
  const growthInvestMonth = oc.training + oc.ppcConsulting + oc.svConsulting;
  // 店舗経費（ランニング）: L47(月)=L45 店舗賃料 + L46 物件王会費（月額）
  const storeRunningMonth = oc.storeRent + nonNeg(oc.membership);

  // O62 = (L47*12)+L40+L37+L34+L31+L28+L26+L24+L21+L18+L15+L12
  const total =
    storeRunningMonth * 12 +
    growthInvestMonth * 12 +
    oc.misc +
    taxMonth * 12 +
    oc.lease +
    oc.utilities +
    equipmentLumpSum +
    oc.dues +
    oc.officeSupplies +
    oc.consumables +
    commMonth * 12 +
    travelMonth * 12;
  // O63 = 想定PPC費用/年（損益分岐点算出用の仮置き）
  const assumedPpcAnnual = oc.assumedPpcAnnual;
  const grandTotal = total + assumedPpcAnnual; // O64

  return {
    travelMonth, commMonth, consumablesMonth, officeSuppliesMonth, equipmentLumpSum,
    utilitiesMonth, leaseMonth, taxMonth, growthInvestMonth, storeRunningMonth,
    total, assumedPpcAnnual, grandTotal
  };
}

/* ---------------------------------------------------------------------- */
/* 5. 目標設定シート ステージ2：損益分岐点・目標契約数                      */
/* ---------------------------------------------------------------------- */
function computeBreakEven(state, staff, areas, otherCostsAnnual) {
  // 目標設定!Y7 = M7(人件費/年) + S7(その他費用/年=事業検討!O64)
  const breakEvenAnnual = staff.laborCostYear + otherCostsAnnual.grandTotal;
  const feeRawYen = areas.feeRawYen;

  // R16 = ROUNDUP(B16/J16,0)　必要契約数/年
  const requiredContractsYear = feeRawYen === 0 ? 0 : Math.ceil(breakEvenAnnual / feeRawYen);
  // Y16 = ROUNDUP(R16/12,0)
  const requiredContractsMonth = Math.ceil(requiredContractsYear / 12);

  // B21(目標年間営業利益) → R21,Y21
  const targetProfitContractsYear = feeRawYen === 0 ? 0 : Math.ceil(nonNeg(state.targetProfitAnnual) / feeRawYen);
  const targetProfitContractsMonth = Math.ceil(targetProfitContractsYear / 12);

  // G25 = IF(F11>0, F11, Y16+Y21)　目標とする契約件数/月（F11＝手入力の確定件数）　　P25 = G25*12
  const autoContractsMonth = requiredContractsMonth + targetProfitContractsMonth;
  const confirmedOverride = nonNeg(state.confirmedOverride);
  const targetContractsMonth = confirmedOverride > 0 ? confirmedOverride : autoContractsMonth;
  const targetContractsYear = targetContractsMonth * 12;

  // AB24:AB26　目標とする契約件数の種別内訳（ROUNDDOWN）
  const targetLandCount = Math.floor(targetContractsYear * areas.landRatio);
  const targetUsedCount = Math.floor(targetContractsYear * areas.usedRatio);
  const targetNewCount = Math.floor(targetContractsYear * areas.newRatio);

  // 表示用参考値（AF16,AI16,AO16）
  const referenceAnnualContracts = requiredContractsMonth * 12;
  const referenceAnnualRevenue = referenceAnnualContracts * feeRawYen;
  const referenceOperatingSurplus = referenceAnnualRevenue - breakEvenAnnual;

  return {
    breakEvenAnnual, requiredContractsYear, requiredContractsMonth,
    targetProfitContractsYear, targetProfitContractsMonth,
    autoContractsMonth, confirmedOverride, targetContractsMonth, targetContractsYear,
    targetLandCount, targetUsedCount, targetNewCount,
    referenceAnnualContracts, referenceAnnualRevenue, referenceOperatingSurplus
  };
}

/* ---------------------------------------------------------------------- */
/* 6. 事業検討シート ステージ2：広告費・建築シナジー・初期費用              */
/* ---------------------------------------------------------------------- */
function computeBusinessPlan(state, staff, areas, breakEven, license) {
  // 【広告宣伝費】
  const targetLeads = nonNeg(state.ad.targetLeads); // C25（編集可能。既定値は営業人数×15件の目安）
  const cvr = nonNeg(state.ad.cvr);
  const cpa = cvr === 0 ? 0 : nonNeg(state.cpc) / cvr; // G31
  const ppcBudgetMonth = targetLeads * cpa; // D25
  const ppcBudgetBoosted = ppcBudgetMonth * 1.5; // F25（オープン半年）
  const adOtherTotal = (state.ad.other1 || 0) + (state.ad.other2 || 0) + (state.ad.portal || 0) + (state.ad.assessmentSite || 0);
  const adBudgetMonthBase = ppcBudgetMonth + adOtherTotal; // D30
  const adBudgetMonthBaseTax = roundDown(adBudgetMonthBase * 1.1, 0); // D31（税込・通常月）
  const adBudgetMonthBoostedTax = ppcBudgetBoosted * 1.1; // F25*110%（税込・オープン半年）

  // 【建築シナジー】
  const synergy = state.synergy;
  function synergyLine(cfg, pool, capSolo, capTeam, hasCap) {
    if (!cfg.enabled) return { annualFreq: 0, perDealProfit: 0, annualProfit: 0, monthlyEquivalent: 0 };
    const conversionFreq = Math.floor(pool * cfg.conversionRate); // Z37/Z38/Z39
    const capacityFreq = hasCap ? (staff.salesHeadcount === 1 ? capSolo : capTeam) : conversionFreq;
    const annualFreq = Math.min(conversionFreq, capacityFreq); // R36/R37/R38
    const perDealProfit = cfg.unitPrice * (cfg.allocRate !== undefined ? cfg.allocRate : 0); // V36/V37/V38
    const annualProfit = annualFreq * perDealProfit; // F36/F37/F38
    return { annualFreq, perDealProfit, annualProfit };
  }

  const reform = synergyLine(synergy.reform, breakEven.targetUsedCount, null, null, false);
  reform.monthlyEquivalent = roundDown(reform.annualProfit / 12, -4); // H36（参考表示用の按分値。実際の計上額はunitPriceそのもの）
  reform.unitPrice = synergy.reform.unitPrice; // S36
  reform.cogsPerDeal = synergy.reform.unitPrice * (1 - synergy.reform.profitRate); // S36*(100%-T36)

  const selfBuild = synergyLine(synergy.selfBuild, breakEven.targetLandCount, synergy.selfBuild.capSolo, synergy.selfBuild.capTeam, true);
  selfBuild.quarterlyEquivalent = selfBuild.annualProfit / 4; // H37（参考表示用の按分値。実際の計上額はunitPriceそのもの）
  selfBuild.unitPrice = synergy.selfBuild.unitPrice; // S37
  selfBuild.cogsPerDeal = synergy.selfBuild.unitPrice * (1 - synergy.selfBuild.profitRate); // S37*(100%-T37)

  const referral = synergyLine(synergy.referral, breakEven.targetLandCount, synergy.referral.capSolo, synergy.referral.capTeam, true);
  referral.bimonthlyEquivalent = referral.annualProfit / 6; // H38
  referral.cogsPerDeal = 0; // 他社紹介はコストなし（T38 = ―）

  // 【その他費用】年額→月額換算まとめ（既にステージ1で計算済のため再掲のみ）

  // 【店舗組成費（イニシャル）】
  const initialCostSubtotal = license.costInBusinessPlan + state.initialCost.franchiseFee; // L53（L50:L52）
  const storeSetupSubtotal = state.otherCosts.renovationCostBasis + state.initialCost.signageCost; // L56（内装工事費用＋看板設置費用）
  const initialCostTotal = initialCostSubtotal + storeSetupSubtotal; // L57
  const initialCostTotalTax = initialCostTotal * 1.1; // L58（税込）

  // 減価償却
  const depreciationDivisor = state.otherCosts.depreciationType === '改装' ? 15 : 20;
  const depreciationMonth = state.otherCosts.renovationCostBasis / depreciationDivisor / 12; // C49

  // コンサル費のウェイバー判定（O44）
  const svConsultingApplies = state.initialCost.franchiseFee < 4200000;

  return {
    targetLeads, cpa, ppcBudgetMonth, ppcBudgetBoosted, adOtherTotal,
    adBudgetMonthBase, adBudgetMonthBaseTax, adBudgetMonthBoostedTax,
    reform, selfBuild, referral,
    initialCostSubtotal, storeSetupSubtotal, initialCostTotal, initialCostTotalTax,
    depreciationMonth, svConsultingApplies,
    // 簡易PLの「件数」：1年目は元シートの固定値（リフォーム2・自社請負1・他社紹介1）、
    // 2年目はリフォーム6、自社請負・他社紹介は営業人数別の年間上限件数（事業検討!Q37/Q38）
    summaryCounts: {
      year1: { reform: 2, selfBuild: 1, referral: 1 },
      year2: {
        reform: 6,
        selfBuild: staff.salesHeadcount === 1 ? synergy.selfBuild.capSolo : synergy.selfBuild.capTeam,
        referral: staff.salesHeadcount === 1 ? synergy.referral.capSolo : synergy.referral.capTeam
      }
    }
  };
}

/* ---------------------------------------------------------------------- */
/* インセンティブ（PL行32）：仲介手数料が「給与合計×足切り係数」を超えた分×率   */
/* ---------------------------------------------------------------------- */
function computeIncentive(state, staff, brokerageRevenue) {
  const inc = state.incentive || {};
  const cutoff = staff.laborCostMonth * nonNeg(inc.cutoffFactor); // 事業検討!F54
  const rate = nonNeg(inc.rate); // 事業検討!D58
  return brokerageRevenue.map(v => (v > cutoff ? (v - cutoff) * rate : 0));
}

/* ---------------------------------------------------------------------- */
/* 7. PL（1年目） 月次                                                    */
/* ---------------------------------------------------------------------- */
function computePL1(state, staff, areas, otherCostsAnnual, businessPlan) {
  const fee = areas.feeRoundedYen; // 事業検討!E4
  const F11 = nonNeg(state.confirmedContractsPerMonth);

  // 仲介契約件数（行3）
  const c2 = Math.floor(F11 / 2), c4 = Math.ceil(F11 / 2);
  const contracts = [0, 0, c2, c2, c4, c4, F11, F11, F11, F11, F11, F11];
  const brokerageRevenue = contracts.map(c => c * fee);

  // リフォーム・自社請負・他社紹介（1年目は稼働半年想定のため限定的に計上）
  // 元Excel（PL（1年目）行5:7）どおり、建築シナジーは「按分した利益」を売上として計上する
  // （リフォーム＝事業検討!H36を9〜12ヵ月目、自社請負＝D37を12ヵ月目、他社紹介＝D38を9・11ヵ月目）。
  // 契約金額と原価は計上しない（簡易PL・決定事項の数字はこの基準）。
  const reformRevenue = Array(12).fill(0);
  for (let i = 8; i <= 11; i++) reformRevenue[i] = businessPlan.reform.monthlyEquivalent; // M5:P5
  const selfBuildRevenue = Array(12).fill(0);
  selfBuildRevenue[11] = businessPlan.selfBuild.perDealProfit; // P6
  const referralRevenue = Array(12).fill(0);
  referralRevenue[8] = businessPlan.referral.perDealProfit; // M7
  referralRevenue[10] = businessPlan.referral.perDealProfit; // O7

  const totalRevenue = range(12).map(i => brokerageRevenue[i] + reformRevenue[i] + selfBuildRevenue[i] + referralRevenue[i]);

  // 売上原価は計上しない（按分利益ベースのため、売上総利益＝売上高）
  const reformCogs = Array(12).fill(0);
  const selfBuildCogs = Array(12).fill(0);
  const totalCogs = Array(12).fill(0);
  const grossProfit = totalRevenue.slice();

  // 販管費
  const oc = state.otherCosts;
  const salary = Array(12).fill(staff.laborCostMonth);
  const legalWelfare = Array(12).fill(staff.laborCostMonth * 0.14);
  const recruiting = zerosExceptFirst(oc.recruiting);
  const adSpend = [0, 1, 2, 3, 4, 5].map(() => businessPlan.adBudgetMonthBoostedTax)
    .concat(Array(6).fill(businessPlan.adBudgetMonthBaseTax));
  const entertainment = Array(12).fill(oc.entertainment);
  const travel = Array(12).fill(otherCostsAnnual.travelMonth);
  const communication = Array(12).fill(otherCostsAnnual.commMonth);
  const consumables = Array(12).fill(otherCostsAnnual.consumablesMonth);
  const officeSupplies = Array(12).fill(otherCostsAnnual.officeSuppliesMonth);
  const equipment = zerosExceptFirst(otherCostsAnnual.equipmentLumpSum);
  const utilities = Array(12).fill(otherCostsAnnual.utilitiesMonth);
  const dues = zerosExceptFirst(oc.dues);
  const lease = Array(12).fill(otherCostsAnnual.leaseMonth);
  const insurance = Array(12).fill(oc.insurance);
  const depreciation = Array(12).fill(businessPlan.depreciationMonth);
  const tax = [0, 0, 0, 0].concat(Array(8).fill(otherCostsAnnual.taxMonth)); // H27開始(月5)
  const misc = Array(12).fill(roundUp(oc.misc / 12, -2));
  const training = Array(12).fill(oc.training);
  const consulting = range(12).map(i => oc.ppcConsulting + (i < 6 && businessPlan.svConsultingApplies ? oc.svConsulting : 0));
  const storeRunning = Array(12).fill(otherCostsAnnual.storeRunningMonth);
  const incentive = computeIncentive(state, staff, brokerageRevenue); // 行32
  const initialSetup = zerosExceptFirst(businessPlan.initialCostTotalTax);

  const sgaTotal = range(12).map(i =>
    salary[i] + legalWelfare[i] + recruiting[i] + adSpend[i] + entertainment[i] + travel[i] +
    communication[i] + consumables[i] + officeSupplies[i] + equipment[i] + utilities[i] +
    dues[i] + lease[i] + insurance[i] + depreciation[i] + tax[i] + misc[i] + training[i] +
    consulting[i] + storeRunning[i] + incentive[i]
  );
  const sgaTotalWithInitial = range(12).map(i => sgaTotal[i] + initialSetup[i]);

  // 営業損益＝売上高（仲介＋建築シナジー按分利益）－販売管理費（店舗組成費は含めない：簡易PLと同じ基準）
  const operatingIncome = range(12).map(i => grossProfit[i] - sgaTotal[i]);
  const extras = computePLExtras(state, operatingIncome, 0);

  return {
    months: MONTHS_1, contracts, brokerageRevenue, reformRevenue, selfBuildRevenue, referralRevenue, totalRevenue,
    reformCogs, selfBuildCogs, totalCogs, grossProfit,
    lines: { salary, legalWelfare, recruiting, adSpend, entertainment, travel, communication, consumables, officeSupplies, equipment, utilities, dues, lease, insurance, depreciation, tax, misc, training, consulting, storeRunning, incentive, initialSetup },
    sgaTotal, sgaTotalWithInitial, operatingIncome, ...extras,
    sheet: null,
    sumFirstHalf: sumRange(totalRevenue, 0, 6), sumSecondHalf: sumRange(totalRevenue, 6, 12), sumYear: sumAll(totalRevenue),
    grossProfitSumYear: sumAll(grossProfit),
    sgaSumYear: sumAll(sgaTotal), opIncomeSumYear: sumAll(operatingIncome)
  };
}

/* ---------------------------------------------------------------------- */
/* 元Excel「PL」シートそのままの表（行番号＝元シートの行）                        */
/* 売上高・売上原価・売上総損益は契約金額ベース、営業損益は按分利益ベース（元シートの仕様）。 */
/* 1ヵ月目の店舗組成費（イニシャル）を販売管理費に含む。CF（キャッシュ）系の行も同じ式。      */
/* 簡易P&L・グラフ用の営業損益（pl.operatingIncome：店舗組成費を含まない）とは別に持つ。    */
/* ---------------------------------------------------------------------- */
function buildSheetPL(state, pl, businessPlan, initialSetup, openingCF) {
  const R = {}; // 行番号 → 12ヵ月の配列
  const z = () => Array(12).fill(0);
  const L = pl.lines;
  const sy = state.synergy;
  const idx = range(12);
  R[3] = pl.contracts; R[4] = pl.brokerageRevenue; R[5] = pl.reformRevenue; R[6] = pl.selfBuildRevenue; R[7] = pl.referralRevenue;
  // 売上高（行2）＝仲介＋リフォーム／自社請負の契約金額（按分利益が発生する月）＋他社紹介
  const reformSale = pl.reformRevenue.map(v => (v > 0 ? sy.reform.unitPrice : 0));
  const selfSale = pl.selfBuildRevenue.map(v => (v > 0 ? sy.selfBuild.unitPrice : 0));
  R[2] = idx.map(i => R[4][i] + reformSale[i] + selfSale[i] + R[7][i]);
  // 売上原価（行8）＝契約金額×(1－利益率)
  R[8] = idx.map(i => (reformSale[i] > 0 ? sy.reform.unitPrice * (1 - sy.reform.profitRate) : 0) + (selfSale[i] > 0 ? sy.selfBuild.unitPrice * (1 - sy.selfBuild.profitRate) : 0));
  R[9] = idx.map(i => R[2][i] - R[8][i]);
  R[11] = idx.map(i => L.salary[i] - L.legalWelfare[i]);
  const lineRows = [[12, 'salary'], [13, 'legalWelfare'], [14, 'recruiting'], [15, 'adSpend'], [16, 'entertainment'], [17, 'travel'], [18, 'communication'], [19, 'consumables'], [20, 'officeSupplies'], [21, 'equipment'], [22, 'utilities'], [23, 'dues'], [24, 'lease'], [25, 'insurance'], [26, 'depreciation'], [27, 'tax'], [28, 'misc'], [29, 'training'], [30, 'consulting'], [31, 'storeRunning'], [32, 'incentive']];
  lineRows.forEach(([r, k]) => { R[r] = L[k]; });
  R[33] = initialSetup; R[34] = z(); R[35] = z();
  const sumRows = (i, a, b) => { let t = 0; for (let r = a; r <= b; r++) if (R[r]) t += R[r][i]; return t; };
  R[37] = idx.map(i => sumRows(i, 12, 33));
  R[38] = idx.map(i => sumRows(i, 13, 33) + R[11][i] - R[26][i]);
  R[40] = idx.map(i => R[4][i] + R[5][i] + R[6][i] + R[7][i] - R[37][i]);
  R[41] = idx.map(i => R[9][i] - R[38][i]);
  R[43] = pl.nonOperatingIncomeLines.interestIncome; R[44] = pl.nonOperatingIncomeLines.miscIncome;
  R[45] = idx.map(i => R[43][i] + R[44][i]);
  R[46] = pl.nonOperatingExpenseLines.interestExpense; R[47] = pl.nonOperatingExpenseLines.miscLoss;
  R[48] = idx.map(i => R[46][i] + R[47][i]);
  R[50] = idx.map(i => R[40][i] + R[45][i] - R[48][i]);
  R[51] = idx.map(i => R[41][i] + R[45][i] - R[48][i]);
  R[53] = pl.extraordinaryItems;
  R[54] = idx.map(i => R[50][i] + R[53][i]);
  R[55] = idx.map(i => R[51][i] + R[53][i]);
  R[56] = pl.corporateTax;
  R[57] = idx.map(i => R[54][i] - R[56][i]);
  R[58] = idx.map(i => R[55][i] - R[56][i]);
  R[60] = z(); R[61] = z();
  R[59] = z(); R[62] = z(); R[68] = z();
  for (let i = 0; i < 12; i++) {
    R[59][i] = i === 0 ? (Number(openingCF) || 0) : R[68][i - 1];
    R[62][i] = R[58][i] + R[59][i] - R[60][i] - R[61][i];
    R[68][i] = R[62][i];
  }
  // 合計列：'sum'＝上期・下期・当期の合計／'close'＝期末の残高／'none'＝なし
  const mode = {};
  [59, 61].forEach(r => { mode[r] = 'none'; });
  [62, 68].forEach(r => { mode[r] = 'close'; });
  // 売上総損益 ＝ 売上高 − 売上原価。当期合計も上期＋下期の合計（＝当期の売上高 − 売上原価）にする
  return { rows: R, mode, closingCF: R[62][11], totalOverride: {} };
}

/* ---------------------------------------------------------------------- */
/* 7.5 PL共通：営業外損益～当期純損益・総資産（行43:68相当）                  */
/* ---------------------------------------------------------------------- */
// 元Excelでは受取利息/雑収入/支払利息/雑損失/特別利益・損失/法人税等は全て
// 空欄（既定値0）の手動入力セル。openingAssets は前年からの総資産繰越（PL2年目用、
// PL1年目は0スタート）。
function computePLExtras(state, operatingIncome, openingAssets) {
  const pe = state.plExtras || {};
  const interestIncome = Array(12).fill(nonNeg(pe.interestIncome) / 12); // 行43
  const miscIncome = Array(12).fill(nonNeg(pe.miscIncome) / 12); // 行44
  const nonOperatingIncome = range(12).map(i => interestIncome[i] + miscIncome[i]); // 行45 営業外収益
  const interestExpense = Array(12).fill(nonNeg(pe.interestExpense) / 12); // 行46
  const miscLoss = Array(12).fill(nonNeg(pe.miscLoss) / 12); // 行47
  const nonOperatingExpense = range(12).map(i => interestExpense[i] + miscLoss[i]); // 行48 営業外費用
  const ordinaryIncome = range(12).map(i => operatingIncome[i] + nonOperatingIncome[i] - nonOperatingExpense[i]); // 行50 経常損益
  const extraordinaryItems = Array(12).fill((Number(pe.extraordinaryItems) || 0) / 12); // 行53（マイナス可）
  const incomeBeforeTax = range(12).map(i => ordinaryIncome[i] + extraordinaryItems[i]); // 行54 税引前当期純損益
  const corporateTax = Array(12).fill(nonNeg(pe.corporateTax) / 12); // 行56 法人税等
  const netIncome = range(12).map(i => incomeBeforeTax[i] - corporateTax[i]); // 行57 当期純損益
  // 行68 総資産：当期純損益の累積（前年からの繰越＋当年の月次累計）
  const cumulativeAssets = range(12).map(i => openingAssets + sumRange(netIncome, 0, i + 1));

  return {
    nonOperatingIncomeLines: { interestIncome, miscIncome }, nonOperatingIncome,
    nonOperatingExpenseLines: { interestExpense, miscLoss }, nonOperatingExpense,
    ordinaryIncome, extraordinaryItems, incomeBeforeTax, corporateTax, netIncome, cumulativeAssets,
    ordinaryIncomeSumYear: sumAll(ordinaryIncome), netIncomeSumYear: sumAll(netIncome),
    closingAssets: cumulativeAssets[11]
  };
}

/* ---------------------------------------------------------------------- */
/* 8. PL（2年目以降） 月次                                                */
/* ---------------------------------------------------------------------- */
function computePL2(state, staff, areas, otherCostsAnnual, businessPlan, openingAssets) {
  const fee = areas.feeRoundedYen;
  const F11 = nonNeg(state.confirmedContractsPerMonth);
  const contracts = Array(12).fill(F11);
  const brokerageRevenue = contracts.map(c => c * fee);

  // PL1同様、建築シナジーは按分した利益を売上として計上する
  // （リフォーム＝H36を毎月、自社請負＝H37を3ヵ月ごと、他社紹介＝H38を隔月（営業2名以上は増える））
  const reformRevenue = Array(12).fill(businessPlan.reform.monthlyEquivalent);
  const selfBuildRevenue = Array(12).fill(0);
  [2, 5, 8, 11].forEach(i => (selfBuildRevenue[i] = businessPlan.selfBuild.quarterlyEquivalent));
  const referralRevenue = Array(12).fill(0);
  [0, 6].forEach(i => (referralRevenue[i] = businessPlan.referral.bimonthlyEquivalent));
  if (staff.salesHeadcount > 1) {
    [2, 4, 8, 10].forEach(i => (referralRevenue[i] = businessPlan.referral.bimonthlyEquivalent));
  }

  const totalRevenue = range(12).map(i => brokerageRevenue[i] + reformRevenue[i] + selfBuildRevenue[i] + referralRevenue[i]);
  const reformCogs = Array(12).fill(0);
  const selfBuildCogs = Array(12).fill(0);
  const totalCogs = Array(12).fill(0);
  const grossProfit = totalRevenue.slice();

  const oc = state.otherCosts;
  const salary = Array(12).fill(staff.laborCostMonth);
  const legalWelfare = Array(12).fill(staff.laborCostMonth * 0.14);
  const recruiting = Array(12).fill(0);
  const adSpend = Array(12).fill(businessPlan.adBudgetMonthBaseTax);
  const entertainment = Array(12).fill(oc.entertainment);
  const travel = Array(12).fill(otherCostsAnnual.travelMonth);
  const communication = Array(12).fill(otherCostsAnnual.commMonth);
  const consumables = Array(12).fill(otherCostsAnnual.consumablesMonth);
  const officeSupplies = Array(12).fill(otherCostsAnnual.officeSuppliesMonth);
  const equipment = zerosExceptFirst(0); // 2年目以降は新規備品購入なしを既定（必要なら個別入力可）
  const utilities = Array(12).fill(otherCostsAnnual.utilitiesMonth);
  const dues = zerosExceptFirst(oc.dues);
  const lease = Array(12).fill(otherCostsAnnual.leaseMonth);
  const insurance = Array(12).fill(oc.insurance);
  const depreciation = Array(12).fill(businessPlan.depreciationMonth);
  const tax = Array(12).fill(otherCostsAnnual.taxMonth);
  const misc = Array(12).fill(roundUp(oc.misc / 12, -2));
  const training = Array(12).fill(oc.training);
  // コンサル費：PL（2年目以降）も1年目と同じ（前半6ヵ月はSV＋PPC、後半はPPCのみ）
  const consulting = range(12).map(i => oc.ppcConsulting + (i < 6 && businessPlan.svConsultingApplies ? oc.svConsulting : 0));
  const storeRunning = Array(12).fill(otherCostsAnnual.storeRunningMonth);
  const incentive = computeIncentive(state, staff, brokerageRevenue); // 行32
  const initialSetup = Array(12).fill(0);

  const sgaTotal = range(12).map(i =>
    salary[i] + legalWelfare[i] + recruiting[i] + adSpend[i] + entertainment[i] + travel[i] +
    communication[i] + consumables[i] + officeSupplies[i] + equipment[i] + utilities[i] +
    dues[i] + lease[i] + insurance[i] + depreciation[i] + tax[i] + misc[i] + training[i] +
    consulting[i] + storeRunning[i] + incentive[i]
  );
  const operatingIncome = range(12).map(i => grossProfit[i] - sgaTotal[i]);
  const extras = computePLExtras(state, operatingIncome, Number(openingAssets) || 0); // 前年の赤字繰越もあり得るため0クランプしない

  return {
    months: MONTHS_2, contracts, brokerageRevenue, reformRevenue, selfBuildRevenue, referralRevenue, totalRevenue,
    reformCogs, selfBuildCogs, totalCogs, grossProfit,
    lines: { salary, legalWelfare, recruiting, adSpend, entertainment, travel, communication, consumables, officeSupplies, equipment, utilities, dues, lease, insurance, depreciation, tax, misc, training, consulting, storeRunning, incentive, initialSetup },
    sgaTotal, operatingIncome, ...extras,
    sumFirstHalf: sumRange(totalRevenue, 0, 6), sumSecondHalf: sumRange(totalRevenue, 6, 12), sumYear: sumAll(totalRevenue),
    grossProfitSumYear: sumAll(grossProfit),
    sgaSumYear: sumAll(sgaTotal), opIncomeSumYear: sumAll(operatingIncome)
  };
}

/* ---------------------------------------------------------------------- */
/* ユーティリティ                                                         */
/* ---------------------------------------------------------------------- */
function range(n) { return Array.from({ length: n }, (_, i) => i); }
function zerosExceptFirst(v) { const a = Array(12).fill(0); a[0] = v; return a; }
function sumRange(arr, from, to) { return arr.slice(from, to).reduce((s, v) => s + v, 0); }
function sumAll(arr) { return arr.reduce((s, v) => s + v, 0); }

/* ---------------------------------------------------------------------- */
/* 9. 全体まとめ（簡易PL・決定事項用サマリー）                              */
/* ---------------------------------------------------------------------- */
function computeSummary(pl1, pl2) {
  return {
    year1: {
      brokerage: { count: sumAll(pl1.contracts), amount: sumAll(pl1.brokerageRevenue) },
      reform: { amount: sumAll(pl1.reformRevenue) },
      selfBuild: { amount: sumAll(pl1.selfBuildRevenue) },
      referral: { amount: sumAll(pl1.referralRevenue) },
      totalRevenue: pl1.sumYear,
      grossProfit: pl1.grossProfitSumYear,
      sgaTotal: pl1.sgaSumYear,
      operatingIncome: pl1.opIncomeSumYear,
      ordinaryIncome: pl1.ordinaryIncomeSumYear, netIncome: pl1.netIncomeSumYear, closingAssets: pl1.closingAssets
    },
    year2: {
      brokerage: { count: sumAll(pl2.contracts), amount: sumAll(pl2.brokerageRevenue) },
      reform: { amount: sumAll(pl2.reformRevenue) },
      selfBuild: { amount: sumAll(pl2.selfBuildRevenue) },
      referral: { amount: sumAll(pl2.referralRevenue) },
      totalRevenue: pl2.sumYear,
      grossProfit: pl2.grossProfitSumYear,
      sgaTotal: pl2.sgaSumYear,
      operatingIncome: pl2.opIncomeSumYear,
      ordinaryIncome: pl2.ordinaryIncomeSumYear, netIncome: pl2.netIncomeSumYear, closingAssets: pl2.closingAssets
    }
  };
}

/* ---------------------------------------------------------------------- */
/* 10. 全体計算パイプライン                                                */
/* ---------------------------------------------------------------------- */
function runFullCalculation(state) {
  const staff = computeStaff(state);
  const areas = computeAreas(state);
  const license = computeLicense(state);
  // 確定契約件数/月（事業検討!F11）：手入力（confirmedOverride）があればそれを採用、
  // 無ければ目標契約件数/月（損益分岐点＋利益目標から自動算出）。租税公課（＝件数×1万円）が損益分岐点に
  // 影響するため、自動算出のときは件数が変わらなくなるまで数回繰り返して収束させる。
  if (nonNeg(state.confirmedOverride) > 0) state.confirmedContractsPerMonth = nonNeg(state.confirmedOverride);
  let otherCostsAnnual = computeOtherCostsAnnual(state, staff);
  let breakEven = computeBreakEven(state, staff, areas, otherCostsAnnual);
  for (let i = 0; i < 6 && state.confirmedContractsPerMonth !== breakEven.targetContractsMonth; i++) {
    state.confirmedContractsPerMonth = breakEven.targetContractsMonth;
    otherCostsAnnual = computeOtherCostsAnnual(state, staff);
    breakEven = computeBreakEven(state, staff, areas, otherCostsAnnual);
  }
  state.confirmedContractsPerMonth = breakEven.targetContractsMonth;
  const businessPlan = computeBusinessPlan(state, staff, areas, breakEven, license);
  const pl1 = computePL1(state, staff, areas, otherCostsAnnual, businessPlan);
  const pl2 = computePL2(state, staff, areas, otherCostsAnnual, businessPlan, pl1.closingAssets);
  // 元Excel「PL」シートと同じ行構成の表（店舗組成費を1ヵ月目に含む・CF行あり）
  pl1.sheet = buildSheetPL(state, pl1, businessPlan, zerosExceptFirst(businessPlan.initialCostTotalTax), 0);
  pl2.sheet = buildSheetPL(state, pl2, businessPlan, Array(12).fill(0), pl1.sheet.closingCF);
  const summary = computeSummary(pl1, pl2);
  return { staff, areas, license, otherCostsAnnual, breakEven, businessPlan, pl1, pl2, summary };
}
