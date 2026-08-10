/*
 * incentive.js
 * 「インセンティブ検討」シートの再現（成果評価／勤続評価／マネジメント評価の3軸インセンティブ試算）。
 *
 * 元シートのV列（経過月数の元になる日数差分）は数式が入っておらず、実質未実装のセルだった。
 * ラベルと入力欄（入社日・基準日）から意図は明白（DATEDIF）なため、その意図を補って実装している。
 */

function monthsBetween(fromDateStr, toDateStr) {
  if (!fromDateStr || !toDateStr) return 0;
  const from = new Date(fromDateStr);
  const to = new Date(toDateStr);
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

function computeIncentivePlan(state, calcResult) {
  const ip = state.incentivePlan;
  const staffList = flattenStaffList(state).filter(s => s.salary > 0);

  // L4 = MIN(2000, 原資/経過月数合計)　※経過月数合計が0の間は2000円上限のみ適用
  const rows = staffList.map(s => {
    const rec = ip.byStaff[s.id] || {};
    const monthsElapsedRaw = monthsBetween(rec.hireDate, ip.baseDate);
    const monthsElapsed = Math.min(120, monthsElapsedRaw);
    return {
      id: s.id, label: s.label, monthlySalary: s.salary,
      halfYearResult: Number(rec.halfYearResult) || 0,
      hireDate: rec.hireDate || '',
      monthsElapsed,
      managementScore: Number(rec.managementScore) || 0
    };
  });

  const totalMonths = rows.reduce((s, r) => s + r.monthsElapsed, 0);
  const tenureUnitPrice = totalMonths === 0 ? 2000 : Math.min(2000, ip.poolAmount / totalMonths); // L4

  rows.forEach(r => {
    // CO列: 成果評価の原資（(半期実績 - 評価給与×足切り係数×6)×インセンティブ率）
    const resultIncentiveRaw = ip.useResultEval
      ? (r.halfYearResult - r.monthlySalary * ip.cutoffFactor * 6) * ip.incentiveRate
      : 0;
    r.resultIncentive = Math.max(0, resultIncentiveRaw); // AO列
    r.tenureIncentive = ip.useTenureEval ? r.monthsElapsed * tenureUnitPrice : 0; // AW列
    r.managementIncentive = ip.useManagementEval ? r.managementScore : 0; // BE列
    r.totalIncentive = r.resultIncentive + r.tenureIncentive + r.managementIncentive; // BM列
  });

  const totalResultIncentive = rows.reduce((s, r) => s + r.resultIncentive, 0);
  const totalTenureIncentive = rows.reduce((s, r) => s + r.tenureIncentive, 0);
  const totalManagementIncentive = rows.reduce((s, r) => s + r.managementIncentive, 0);
  const totalIncentive = rows.reduce((s, r) => s + r.totalIncentive, 0);
  // AW17 原資残 = 原資 - 勤続評価合計 - マネジメント評価合計
  const remainingPool = ip.poolAmount - totalTenureIncentive - totalManagementIncentive;

  // T15/T16：半期成果合計 × インセンティブ率（成果評価を使わない場合に原資へ上乗せする参考値）
  const totalHalfYearResult = rows.reduce((s, r) => s + r.halfYearResult, 0); // T15
  const resultEvalPoolReference = totalHalfYearResult * ip.incentiveRate; // T16
  // AW16 マネジメント評価原資 = IF(成果評価を使う, 原資残, T16+原資残) - マネジメント評価合計
  const managementEvalPool = (ip.useResultEval ? remainingPool : resultEvalPoolReference + remainingPool) - totalManagementIncentive;

  return {
    rows, tenureUnitPrice, totalResultIncentive, totalTenureIncentive,
    totalManagementIncentive, totalIncentive, remainingPool,
    totalHalfYearResult, resultEvalPoolReference, managementEvalPool
  };
}
