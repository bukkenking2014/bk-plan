/*
 * salary.js
 * 「給与整合性」シートの再現。給与水準が労働分配率・想定売上に対して適正かをチェックする補助ツール。
 * 元シートは店長1名＋エージェント3名＋サポート2名の固定6枠構成だったが、本アプリでは人数を可変にしているため、
 * ①個人ごとの労働分配率チェック（経験区分ベース）はそのまま完全再現、
 * ②「予想売上より鑑みる適正水準イメージ」の配分は役職ティア単位（店長／エージェント／サポート）で
 *   元シートの配点比率合計を維持しつつ人数按分する一般化を行っている。
 */

// 給与整合性!Y5:Z8　労働分配率ベンチマーク
const EXPERIENCE_BENCHMARKS = {
  '3年以上': 0.32,
  '経験無し': 0.5,
  'サポート': 1.0,
  'その他': null // ベンチマーク無し
};

// 元シートV21:V26は「店長1・エージェント3・サポート2」の固定6枠に対する個別配点比率。
// 本アプリは人数を可変にしているため、枠を人数分だけ順に割り当て、
// 人数が枠数に満たない（空き枠がある）場合はその配点分の予算を在籍者へ均等再配分する
// （元シートのX27＝空き枠の配点合計／W27＝在籍人数　＝　Y27の再配分ロジックを再現）。
const SLOT_RATIOS = [
  { tier: 'manager', ratio: 0.226 },
  { tier: 'agent', ratio: 0.194 },
  { tier: 'agent', ratio: 0.161 },
  { tier: 'agent', ratio: 0.161 },
  { tier: 'support', ratio: 0.129 },
  { tier: 'support', ratio: 0.129 }
];

function flattenStaffList(state) {
  const list = [];
  (state.staff.managers || []).forEach((m, i) => list.push({ id: `manager-${i}`, tier: 'manager', label: `店長${state.staff.managers.length > 1 ? i + 1 : ''}`, salary: Number(m.salary) || 0 }));
  (state.staff.agents || []).forEach((a, i) => list.push({ id: `agent-${i}`, tier: 'agent', label: `エージェント${i + 1}`, salary: Number(a.salary) || 0 }));
  (state.staff.supports || []).forEach((s, i) => list.push({ id: `support-${i}`, tier: 'support', label: `サポート${i + 1}`, salary: Number(s.salary) || 0 }));
  return list;
}

function computeSalaryCheck(state, calcResult) {
  const sc = state.salaryCheck;
  const staffList = flattenStaffList(state);
  const activeStaff = staffList.filter(s => s.salary > 0);

  // 人件費外費用率（W2） = MAX(26%, per-head年額オーバーヘッド合計 / 総従業員給与)
  const oc = calcResult.otherCostsAnnual;
  const totalHeadcount = Math.max(1, calcResult.staff.totalHeadcount);
  const overheadItems = [
    { key: 'legalWelfare', label: '法定福利費', annual: calcResult.staff.laborCostMonth * 0.14 * 12 },
    { key: 'travel', label: '旅費交通費', annual: oc.travelMonth * 12 },
    { key: 'communication', label: '通信費', annual: oc.commMonth * 12 },
    { key: 'consumables', label: '消耗品費', annual: state.otherCosts.consumables },
    { key: 'officeSupplies', label: '事務用品費', annual: state.otherCosts.officeSupplies },
    { key: 'dues', label: '諸会費', annual: state.otherCosts.dues },
    { key: 'equipment', label: '備品費', annual: oc.equipmentLumpSum },
    { key: 'utilities', label: '水道光熱費', annual: state.otherCosts.utilities },
    { key: 'lease', label: 'リース料', annual: state.otherCosts.lease },
    { key: 'tax', label: '租税公課', annual: oc.taxMonth * 12 },
    { key: 'misc', label: '雑費', annual: state.otherCosts.misc },
    { key: 'training', label: '研修費（成長投資費）', annual: oc.growthInvestMonth * 12 },
    { key: 'storeRunning', label: '店舗経費（ランニング）', annual: oc.storeRunningMonth * 12 }
  ].map(item => ({ ...item, perHead: item.annual / totalHeadcount, included: sc.includeCostItems[item.key] !== false }));

  const overheadPerHeadTotal = overheadItems.filter(i => i.included).reduce((s, i) => s + i.perHead, 0);

  const rows = activeStaff.map(s => {
    const allowances = sc.allowancesByStaff[s.id] || { qualification: 0, position: 0 };
    // J列「予定インセンティブ」＝ PL(2年目以降)のインセンティブ合計（R32相当）を在籍人数で均等割りした年額
    const incentiveAnnual = calcResult.pl2 ? sumIncentive(calcResult.pl2) / totalHeadcount : 0; // J5=$J$12
    const baseSalaryAnnual = (Number(s.salary) || 0) * 12; // E列
    const qualificationAnnual = (allowances.qualification || 0) * 12; // G列
    const positionAnnual = (allowances.position || 0) * 12; // I列
    const annualCompBase = baseSalaryAnnual + qualificationAnnual + positionAnnual;
    const annualComp = annualCompBase + incentiveAnnual; // K列（年収）＝E+G+I+J
    const experience = sc.experienceByStaff[s.id] || (s.tier === 'support' ? 'サポート' : '3年以上');
    const benchmark = EXPERIENCE_BENCHMARKS[experience];
    return {
      ...s, allowances, baseSalaryAnnual, qualificationAnnual, positionAnnual, incentiveAnnual, annualComp, experience, benchmark,
      totalCostWithOverhead: annualComp + overheadPerHeadTotal * (annualComp === 0 ? 0 : 1),
      targetRevenueLevel: benchmark ? (annualComp + overheadPerHeadTotal) / benchmark : null
    };
  });

  const w1TotalSalary = rows.reduce((s, r) => s + r.annualComp, 0);
  const overheadRate = w1TotalSalary === 0 ? 0.26 : Math.max(0.26, overheadPerHeadTotal / w1TotalSalary);
  // overheadRateを反映してtargetRevenueLevelを再計算(L4適用)
  rows.forEach(r => {
    r.otherCostAllocated = r.annualComp * overheadRate;
    r.compWithOverhead = r.annualComp + r.otherCostAllocated;
    r.targetRevenueLevel = r.benchmark ? r.compWithOverhead / r.benchmark : null;
  });

  const totalTargetRevenueLevel = rows.reduce((s, r) => s + (r.targetRevenueLevel || 0), 0);
  const actualGrossProfitYear2 = calcResult.summary.year2.totalRevenue; // PL2!R9相当（粗利）
  const verdict = actualGrossProfitYear2 < totalTargetRevenueLevel ? '給与の見直し検討' : '給与水準OK';

  // 適正水準イメージ（ティア単位で按分）
  const stressedRevenue = actualGrossProfitYear2 * (1 - sc.revenueStressRate);
  const laborBudgetAnnual = stressedRevenue * sc.laborShareOfRevenue;
  const laborBudgetMonthly = laborBudgetAnnual / 12;

  // 6枠（V21:V26）へ在籍スタッフを在籍順に割当て、空き枠の配点比率は在籍者へ均等再配分する
  const byTierOrdered = {
    manager: activeStaff.filter(s => s.tier === 'manager'),
    agent: activeStaff.filter(s => s.tier === 'agent'),
    support: activeStaff.filter(s => s.tier === 'support')
  };
  const tierPos = { manager: 0, agent: 0, support: 0 };
  const ownRatioByStaffId = {};
  let unusedRatioSum = 0; // X27相当（空き枠の配点比率合計）
  SLOT_RATIOS.forEach(slot => {
    const person = byTierOrdered[slot.tier][tierPos[slot.tier]];
    if (person) {
      ownRatioByStaffId[person.id] = (ownRatioByStaffId[person.id] || 0) + slot.ratio;
      tierPos[slot.tier] += 1;
    } else {
      unusedRatioSum += slot.ratio;
    }
  });
  // Y27相当：空き枠分の予算を在籍人数で均等割り（枠数を超えるスタッフ（4人目以降のエージェント等）も
  // 自身の配点は0だが、在籍者として再配分の対象人数には含める）
  const redistributePerPerson = activeStaff.length > 0 ? (laborBudgetMonthly * unusedRatioSum) / activeStaff.length : 0;
  const suggestedByStaff = activeStaff.map(s => {
    const ownBudget = laborBudgetMonthly * (ownRatioByStaffId[s.id] || 0);
    const perPerson = ownBudget + redistributePerPerson;
    return { id: s.id, label: s.label, suggestedMonthly: Math.floor(perPerson / 10000) * 10000, actualMonthly: s.salary };
  });

  return {
    rows, overheadItems, overheadPerHeadTotal, overheadRate, w1TotalSalary,
    totalTargetRevenueLevel, actualGrossProfitYear2, verdict,
    stressedRevenue, laborBudgetAnnual, laborBudgetMonthly, suggestedByStaff
  };
}

function sumIncentive(pl2) {
  return pl2.lines.incentive.reduce((s, v) => s + v, 0);
}
