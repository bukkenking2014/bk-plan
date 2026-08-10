/*
 * skill.js
 * 「能力判定」シートの再現。本人／指導者／店舗長の3者評価（各項目0〜10点）で
 *   - 技能評価＝知識＋接客＋社内カテゴリの「指導者＋店舗長」合計点をS〜Dの5段階でグレード判定
 *   - 個人評価＝対応カテゴリの「指導者＋店舗長」合計点をS〜Dの5段階でグレード判定
 * を算出する。配点比率 D15%/C20%/B30%/A20%/S15%（元シートDH38:DJ42・DH52:DJ56）をそのまま採用。
 */

function emptyRecord() {
  const rec = {};
  SKILL_CATEGORIES.forEach(cat => {
    rec[cat.key] = cat.items.map(() => ({ self: null, mentor: null, manager: null }));
  });
  return rec;
}

function categorySubtotal(record, categoryKey, scorer) {
  const items = record[categoryKey] || [];
  return items.reduce((s, it) => s + (Number(it[scorer]) || 0), 0);
}

function computeSkillAssessment(state) {
  const staffList = flattenStaffList(state).filter(s => s.salary > 0);
  const results = staffList.map(s => {
    const record = state.skillAssessment.records[s.id] || emptyRecord();

    const subtotals = {};
    SKILL_CATEGORIES.forEach(cat => {
      subtotals[cat.key] = {
        self: categorySubtotal(record, cat.key, 'self'),
        mentor: categorySubtotal(record, cat.key, 'mentor'),
        manager: categorySubtotal(record, cat.key, 'manager')
      };
    });

    const skillCategories = ['knowledge', 'reception', 'internal'];
    const skillScore = skillCategories.reduce((s, k) => s + subtotals[k].mentor + subtotals[k].manager, 0);
    const skillMaxItems = SKILL_CATEGORIES.filter(c => skillCategories.includes(c.key)).reduce((s, c) => s + c.items.length, 0);
    const skillMax = skillMaxItems * 10 * 2;
    const skillGrade = gradeFromScore(skillScore, buildGradeThresholds(skillMax));

    const personalScore = subtotals.response.mentor + subtotals.response.manager;
    const personalMaxItems = SKILL_CATEGORIES.find(c => c.key === 'response').items.length;
    const personalMax = personalMaxItems * 10 * 2;
    const personalGrade = gradeFromScore(personalScore, buildGradeThresholds(personalMax));

    const grandTotal = {
      self: SKILL_CATEGORIES.reduce((s, c) => s + subtotals[c.key].self, 0),
      mentor: SKILL_CATEGORIES.reduce((s, c) => s + subtotals[c.key].mentor, 0),
      manager: SKILL_CATEGORIES.reduce((s, c) => s + subtotals[c.key].manager, 0)
    };

    return { id: s.id, label: s.label, record, subtotals, skillScore, skillMax, skillGrade, personalScore, personalMax, personalGrade, grandTotal };
  });
  return results;
}
