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

  return {
    details, totalCount, totalRevenueMan, avgFeeManOverall,
    landRatio, usedRatio, newRatio, householdsTotal,
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
  // 店舗経費（ランニング）: L47(月)=賃料（店舗会費は廃止）
  const storeRunningMonth = oc.storeRent;

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

  // G25 = Y16+Y21　目標とする契約件数/月　　P25 = G25*12
  const targetContractsMonth = requiredContractsMonth + targetProfitContractsMonth;
  const targetContractsYear = targetContractsMonth * 12;

  // AB24:AB26　目標とする契約件数の種別内訳
  const targetLandCount = Math.ceil(targetContractsYear * areas.landRatio);
  const targetUsedCount = targetContractsYear * areas.usedRatio;
  const targetNewCount = targetContractsYear * areas.newRatio;

  // 表示用参考値（AF16,AI16,AO16）
  const referenceAnnualContracts = requiredContractsMonth * 12;
  const referenceAnnualRevenue = referenceAnnualContracts * feeRawYen;
  const referenceOperatingSurplus = referenceAnnualRevenue - breakEvenAnnual;

  return {
    breakEvenAnnual, requiredContractsYear, requiredContractsMonth,
    targetProfitContractsYear, targetProfitContractsMonth,
    targetContractsMonth, targetContractsYear,
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
  reform.monthlyEquivalent = roundDown(reform.annualProfit / 12, -4); // H36
  reform.cogsPerDeal = synergy.reform.unitPrice * (1 - synergy.reform.profitRate);

  const selfBuild = synergyLine(synergy.selfBuild, breakEven.targetLandCount, synergy.selfBuild.capSolo, synergy.selfBuild.capTeam, true);
  selfBuild.quarterlyEquivalent = selfBuild.annualProfit / 4; // H37
  selfBuild.cogsPerDeal = synergy.selfBuild.unitPrice * (1 - synergy.selfBuild.profitRate);

  const referral = synergyLine(synergy.referral, breakEven.targetLandCount, synergy.referral.capSolo, synergy.referral.capTeam, true);
  referral.bimonthlyEquivalent = referral.annualProfit / 6; // H38
  referral.cogsPerDeal = 0; // 他社紹介はコストなし（T38 = ―）

  // 【その他費用】年額→月額換算まとめ（既にステージ1で計算済のため再掲のみ）

  // 【インセンティブ】
  const incentiveThresholdMonth = staff.laborCostMonth * state.incentiveRule.cutoffFactor; // 事業検討!F54
  const incentiveRate = state.incentiveRule.incentiveRate; // 事業検討!D58

  // 【店舗組成費（イニシャル）】
  // 会費（協会入会金等）は免許有無に関わらず常に計上する
  const initialCostSubtotal = license.costInBusinessPlan + state.initialCost.franchiseFee + state.initialCost.membershipFee; // L53
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
    incentiveThresholdMonth, incentiveRate,
    initialCostSubtotal, storeSetupSubtotal, initialCostTotal, initialCostTotalTax,
    depreciationMonth, svConsultingApplies
  };
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
  const reformRevenue = Array(12).fill(0);
  for (let i = 8; i <= 11; i++) reformRevenue[i] = businessPlan.reform.monthlyEquivalent; // M5:P5
  const selfBuildRevenue = Array(12).fill(0);
  selfBuildRevenue[11] = businessPlan.selfBuild.perDealProfit; // P6 = 事業検討!D37（単発1件想定）
  const referralRevenue = Array(12).fill(0);
  referralRevenue[8] = businessPlan.referral.perDealProfit; // M7
  referralRevenue[10] = businessPlan.referral.perDealProfit; // O7

  const totalRevenue = range(12).map(i => brokerageRevenue[i] + reformRevenue[i] + selfBuildRevenue[i] + referralRevenue[i]);

  // 原価（リフォーム・自社請負のみ、発生月に単発フルコストを計上）
  const reformCogs = reformRevenue.map(v => (v > 0 ? businessPlan.reform.cogsPerDeal : 0));
  const selfBuildCogs = selfBuildRevenue.map(v => (v > 0 ? businessPlan.selfBuild.cogsPerDeal : 0));
  const totalCogs = range(12).map(i => reformCogs[i] + selfBuildCogs[i]);
  const grossProfit = range(12).map(i => totalRevenue[i] - totalCogs[i]);

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
  const incentive = brokerageRevenue.map(v => (v > businessPlan.incentiveThresholdMonth ? (v - businessPlan.incentiveThresholdMonth) * businessPlan.incentiveRate : 0));
  const initialSetup = zerosExceptFirst(businessPlan.initialCostTotalTax);

  const sgaTotal = range(12).map(i =>
    salary[i] + legalWelfare[i] + recruiting[i] + adSpend[i] + entertainment[i] + travel[i] +
    communication[i] + consumables[i] + officeSupplies[i] + equipment[i] + utilities[i] +
    dues[i] + lease[i] + insurance[i] + depreciation[i] + tax[i] + misc[i] + training[i] +
    consulting[i] + storeRunning[i] + incentive[i]
  );
  const sgaTotalWithInitial = range(12).map(i => sgaTotal[i] + initialSetup[i]);

  const operatingIncome = range(12).map(i => totalRevenue[i] - sgaTotal[i]);

  return {
    months: MONTHS_1, contracts, brokerageRevenue, reformRevenue, selfBuildRevenue, referralRevenue, totalRevenue,
    reformCogs, selfBuildCogs, totalCogs, grossProfit,
    lines: { salary, legalWelfare, recruiting, adSpend, entertainment, travel, communication, consumables, officeSupplies, equipment, utilities, dues, lease, insurance, depreciation, tax, misc, training, consulting, storeRunning, incentive, initialSetup },
    sgaTotal, sgaTotalWithInitial, operatingIncome,
    sumFirstHalf: sumRange(totalRevenue, 0, 6), sumSecondHalf: sumRange(totalRevenue, 6, 12), sumYear: sumAll(totalRevenue),
    sgaSumYear: sumAll(sgaTotal), opIncomeSumYear: sumAll(operatingIncome)
  };
}

/* ---------------------------------------------------------------------- */
/* 8. PL（2年目以降） 月次                                                */
/* ---------------------------------------------------------------------- */
function computePL2(state, staff, areas, otherCostsAnnual, businessPlan) {
  const fee = areas.feeRoundedYen;
  const F11 = nonNeg(state.confirmedContractsPerMonth);
  const contracts = Array(12).fill(F11);
  const brokerageRevenue = contracts.map(c => c * fee);

  const reformRevenue = Array(12).fill(businessPlan.reform.monthlyEquivalent);
  const selfBuildRevenue = Array(12).fill(0);
  [2, 5, 8, 11].forEach(i => (selfBuildRevenue[i] = businessPlan.selfBuild.quarterlyEquivalent));
  const referralRevenue = Array(12).fill(0);
  [0, 6].forEach(i => (referralRevenue[i] = businessPlan.referral.bimonthlyEquivalent));
  if (staff.salesHeadcount > 1) {
    [2, 4, 8, 10].forEach(i => (referralRevenue[i] = businessPlan.referral.bimonthlyEquivalent));
  }

  const totalRevenue = range(12).map(i => brokerageRevenue[i] + reformRevenue[i] + selfBuildRevenue[i] + referralRevenue[i]);
  const reformCogs = reformRevenue.map(v => (v > 0 ? businessPlan.reform.cogsPerDeal : 0));
  const selfBuildCogs = selfBuildRevenue.map(v => (v > 0 ? businessPlan.selfBuild.cogsPerDeal : 0));
  const totalCogs = range(12).map(i => reformCogs[i] + selfBuildCogs[i]);
  const grossProfit = range(12).map(i => totalRevenue[i] - totalCogs[i]);

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
  const consulting = Array(12).fill(oc.ppcConsulting); // 2年目はSVコンサル無し
  const storeRunning = Array(12).fill(otherCostsAnnual.storeRunningMonth);
  const incentive = brokerageRevenue.map(v => (v > businessPlan.incentiveThresholdMonth ? (v - businessPlan.incentiveThresholdMonth) * businessPlan.incentiveRate : 0));
  const initialSetup = Array(12).fill(0);

  const sgaTotal = range(12).map(i =>
    salary[i] + legalWelfare[i] + recruiting[i] + adSpend[i] + entertainment[i] + travel[i] +
    communication[i] + consumables[i] + officeSupplies[i] + equipment[i] + utilities[i] +
    dues[i] + lease[i] + insurance[i] + depreciation[i] + tax[i] + misc[i] + training[i] +
    consulting[i] + storeRunning[i] + incentive[i]
  );
  const operatingIncome = range(12).map(i => totalRevenue[i] - sgaTotal[i]);

  return {
    months: MONTHS_2, contracts, brokerageRevenue, reformRevenue, selfBuildRevenue, referralRevenue, totalRevenue,
    reformCogs, selfBuildCogs, totalCogs, grossProfit,
    lines: { salary, legalWelfare, recruiting, adSpend, entertainment, travel, communication, consumables, officeSupplies, equipment, utilities, dues, lease, insurance, depreciation, tax, misc, training, consulting, storeRunning, incentive, initialSetup },
    sgaTotal, operatingIncome,
    sumFirstHalf: sumRange(totalRevenue, 0, 6), sumSecondHalf: sumRange(totalRevenue, 6, 12), sumYear: sumAll(totalRevenue),
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
      sgaTotal: pl1.sgaSumYear,
      operatingIncome: pl1.sumYear - pl1.sgaSumYear
    },
    year2: {
      brokerage: { count: sumAll(pl2.contracts), amount: sumAll(pl2.brokerageRevenue) },
      reform: { amount: sumAll(pl2.reformRevenue) },
      selfBuild: { amount: sumAll(pl2.selfBuildRevenue) },
      referral: { amount: sumAll(pl2.referralRevenue) },
      totalRevenue: pl2.sumYear,
      sgaTotal: pl2.sgaSumYear,
      operatingIncome: pl2.opIncomeSumYear
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
  const otherCostsAnnual = computeOtherCostsAnnual(state, staff);
  const breakEven = computeBreakEven(state, staff, areas, otherCostsAnnual);
  const businessPlan = computeBusinessPlan(state, staff, areas, breakEven, license);
  const pl1 = computePL1(state, staff, areas, otherCostsAnnual, businessPlan);
  const pl2 = computePL2(state, staff, areas, otherCostsAnnual, businessPlan);
  const summary = computeSummary(pl1, pl2);
  return { staff, areas, license, otherCostsAnnual, breakEven, businessPlan, pl1, pl2, summary };
}
