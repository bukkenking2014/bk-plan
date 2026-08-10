/*
 * ui-tools.js
 * 補助ツール3種のUI：給与整合性チェック／インセンティブ試算／スタッフ能力評価
 */

/* ===================== 給与整合性チェック ===================== */
const STAFF_TIER_LABELS = { managers: '店長', agents: 'エージェント', supports: 'サポート' };
const STAFF_TIER_DEFAULT_SALARY = { managers: 300000, agents: 250000, supports: 200000 };

function renderSalaryTool() {
  const main = document.getElementById('appMain');
  const result = runFullCalculation(appState);
  const list = flattenStaffList(appState).filter(s => s.salary > 0);
  main.innerHTML = `
    <div class="card">
      <h2>給与整合性チェック</h2>
      <p class="desc">給与水準が労働分配率のベンチマーク・想定売上に対して適正かをチェックします。従業員の追加・削除もこの画面から行えます（人員体制・給与と共通のデータです）。</p>
      <h3>従業員の追加</h3>
      <div class="field-row no-print">
        ${Object.keys(STAFF_TIER_LABELS).map(key => `<button class="btn-outline btn-sm" data-add-staff-tier="${key}" type="button">＋ ${esc(STAFF_TIER_LABELS[key])}を追加</button>`).join('')}
      </div>
      ${list.length === 0 ? '<p class="text-muted">追加ボタンから従業員を登録してください。</p>' : `
      <h3>従業員ごとの設定</h3>
      <div id="salaryStaffRows"></div>
      <h3>人件費以外費用の計上項目</h3>
      <div id="salaryCostToggles"></div>
      <div id="salaryResult"></div>
      `}
    </div>`;
  main.querySelectorAll('[data-add-staff-tier]').forEach(btn => {
    btn.onclick = () => {
      const tier = btn.getAttribute('data-add-staff-tier');
      appState.staff[tier].push({ salary: STAFF_TIER_DEFAULT_SALARY[tier] || 0 });
      saveState();
      renderSalaryTool();
    };
  });
  if (list.length === 0) return;
  renderSalaryStaffRows(list);
  renderSalaryCostToggles();
  renderSalaryResult();
}
function renderSalaryStaffRows(list) {
  const el = document.getElementById('salaryStaffRows');
  el.innerHTML = list.map(s => {
    const exp = appState.salaryCheck.experienceByStaff[s.id] || (s.tier === 'support' ? 'サポート' : '3年以上');
    const allow = appState.salaryCheck.allowancesByStaff[s.id] || { qualification: 0, position: 0 };
    return `
      <div class="repeat-item">
        <button class="remove-btn no-print" data-remove-staff-id="${s.id}" title="削除">✕</button>
        <div class="repeat-item-title">${esc(s.label)}</div>
        <div class="field-row">
          <div class="field">
            <label>給与</label>
            <div class="suffix-input">
              <input type="number" min="0" data-salary-amount="${s.id}" value="${s.salary}">
              <span>円/月</span>
            </div>
          </div>
          <div class="field">
            <label>営業経験区分</label>
            <select data-salary-exp="${s.id}">
              ${['3年以上','経験無し','サポート','その他'].map(o => `<option value="${o}" ${exp === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>資格手当</label>
            <input type="number" min="0" data-salary-allow="${s.id}:qualification" value="${allow.qualification || 0}">
          </div>
          <div class="field">
            <label>役職手当</label>
            <input type="number" min="0" data-salary-allow="${s.id}:position" value="${allow.position || 0}">
          </div>
        </div>
      </div>`;
  }).join('');
  el.querySelectorAll('[data-remove-staff-id]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-remove-staff-id');
      const [tier, idx] = id.split('-');
      const tierKey = tier === 'manager' ? 'managers' : tier === 'agent' ? 'agents' : 'supports';
      appState.staff[tierKey].splice(parseInt(idx, 10), 1);
      saveState();
      renderSalaryTool();
    };
  });
  el.querySelectorAll('[data-salary-amount]').forEach(inp => {
    inp.addEventListener('input', () => {
      const id = inp.getAttribute('data-salary-amount');
      const [tier, idx] = id.split('-');
      const tierKey = tier === 'manager' ? 'managers' : tier === 'agent' ? 'agents' : 'supports';
      let v = inp.value === '' ? 0 : parseFloat(inp.value);
      if (isNaN(v) || v < 0) v = 0;
      appState.staff[tierKey][parseInt(idx, 10)].salary = v;
      saveState();
      renderSalaryResult();
    });
  });
  el.querySelectorAll('[data-salary-exp]').forEach(sel => {
    sel.onchange = () => { appState.salaryCheck.experienceByStaff[sel.getAttribute('data-salary-exp')] = sel.value; saveState(); renderSalaryResult(); };
  });
  el.querySelectorAll('[data-salary-allow]').forEach(inp => {
    inp.oninput = () => {
      const [id, field] = inp.getAttribute('data-salary-allow').split(':');
      if (!appState.salaryCheck.allowancesByStaff[id]) appState.salaryCheck.allowancesByStaff[id] = { qualification: 0, position: 0 };
      appState.salaryCheck.allowancesByStaff[id][field] = parseFloat(inp.value) || 0;
      saveState(); renderSalaryResult();
    };
  });
}
const SALARY_COST_ITEMS = [
  ['legalWelfare','法定福利費'],['travel','旅費交通費'],['communication','通信費'],['consumables','消耗品費'],
  ['officeSupplies','事務用品費'],['dues','諸会費'],['equipment','備品費'],['utilities','水道光熱費'],
  ['lease','リース料'],['tax','租税公課'],['misc','雑費'],['training','研修費（成長投資費）'],['storeRunning','店舗経費（ランニング）']
];
function renderSalaryCostToggles() {
  const el = document.getElementById('salaryCostToggles');
  el.innerHTML = SALARY_COST_ITEMS.map(([k, label]) => `
    <label style="display:inline-flex;align-items:center;gap:6px;margin:0 14px 8px 0;font-size:.88em;">
      <input type="checkbox" data-salary-cost="${k}" ${appState.salaryCheck.includeCostItems[k] !== false ? 'checked' : ''}> ${esc(label)}
    </label>`).join('');
  el.querySelectorAll('[data-salary-cost]').forEach(cb => {
    cb.onchange = () => { appState.salaryCheck.includeCostItems[cb.getAttribute('data-salary-cost')] = cb.checked; saveState(); renderSalaryResult(); };
  });
}
function renderSalaryResult() {
  const el = document.getElementById('salaryResult');
  const result = runFullCalculation(appState);
  const sr = computeSalaryCheck(appState, result);
  const rows = sr.rows.map(r => `
    <tr>
      <td>${esc(r.label)}</td><td>${esc(r.experience)}</td>
      <td>${yen(r.baseSalaryAnnual)}</td><td>${yen(r.qualificationAnnual)}</td><td>${yen(r.positionAnnual)}</td><td>${yen(r.incentiveAnnual)}</td>
      <td>${yen(r.annualComp)}</td>
      <td>${r.benchmark ? pct(r.benchmark,0) : '―'}</td>
      <td>${r.targetRevenueLevel ? yen(r.targetRevenueLevel) : '―'}</td>
    </tr>`).join('');
  const suggestRows = sr.suggestedByStaff.map(s => `
    <tr><td>${esc(s.label)}</td><td>${yen(s.actualMonthly)}</td><td>${yen(s.suggestedMonthly)}</td></tr>`).join('');
  el.innerHTML = `
    <h3>労働分配率チェック</h3>
    <div class="table-scroll">
    <table class="plain">
      <thead><tr><th>従業員</th><th>営業経験</th><th>基本給（年額）</th><th>資格手当（年額）</th><th>役職手当（年額）</th><th>予定インセンティブ</th><th>年収</th><th>労働分配率</th><th>年間目標目安</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="8">年間目標目安 合計</td><td>${yen(sr.totalTargetRevenueLevel)}</td></tr></tfoot>
    </table>
    </div>
    <p class="small text-muted">年収＝基本給＋資格手当＋役職手当＋予定インセンティブ（PL2年目以降のインセンティブ総額を在籍人数で均等割りした年額）の合計。労働分配率は営業経験区分ごとのベンチマーク（3年以上32%／経験無し50%／サポート100%）。年間目標目安＝（年収＋人件費以外費用/人）÷労働分配率。</p>
    <div class="stat-cards">
      <div class="stat-card"><div class="label">人件費以外費用率</div><div class="value">${pct(sr.overheadRate,1)}</div></div>
      <div class="stat-card"><div class="label">2年目 想定売上</div><div class="value">${yen(sr.actualGrossProfitYear2)}</div></div>
      <div class="stat-card"><div class="label">判定</div><div class="value"><span class="badge ${sr.verdict === '給与水準OK' ? 'ok' : 'warn'}">${esc(sr.verdict)}</span></div></div>
    </div>
    <h3>予想売上より鑑みる適正水準イメージ</h3>
    <p class="small text-muted">ストレス率 ${pct(appState.salaryCheck.revenueStressRate,0)}を見込んだ想定売上に対して、人件費予算＝想定売上の${pct(appState.salaryCheck.laborShareOfRevenue,0)}として算出。元シートの店長・エージェント×3・サポート×2（計6枠）の配点比率（22.6%／19.4%／16.1%／16.1%／12.9%／12.9%）を在籍順に割当て、枠に満たない人数の分（空き枠）の予算は在籍スタッフへ均等に再配分しています。</p>
    <table class="plain">
      <thead><tr><th>従業員</th><th>現在の給与/月</th><th>適正水準目安/月</th></tr></thead>
      <tbody>${suggestRows}</tbody>
    </table>
  `;
}

/* ===================== インセンティブ試算 ===================== */
function renderIncentiveTool() {
  const main = document.getElementById('appMain');
  const list = flattenStaffList(appState).filter(s => s.salary > 0);
  const ip = appState.incentivePlan;
  main.innerHTML = `
    <div class="card">
      <h2>インセンティブ試算</h2>
      <p class="desc">成果評価・勤続評価・マネジメント評価の3軸でインセンティブ原資の配分を試算します。</p>
      <div class="field-row">
        ${fieldNumber('原資（仲介以外）', 'incentivePlan.poolAmount', ip.poolAmount, { suffix: '円' })}
        ${fieldDate('基準日', 'incentivePlan.baseDate', ip.baseDate)}
      </div>
      <div class="field-row">
        ${fieldNumber('足切り係数', 'incentivePlan.cutoffFactor', ip.cutoffFactor, { suffix: '倍', step: '0.1' })}
        ${fieldNumber('インセンティブ率', 'incentivePlan.incentiveRate', ip.incentiveRate * 100, { suffix: '%' })}
      </div>
      <div class="toggle-row"><input type="checkbox" data-path="incentivePlan.useResultEval" ${ip.useResultEval?'checked':''}> 成果評価を使用</div>
      <div class="toggle-row"><input type="checkbox" data-path="incentivePlan.useTenureEval" ${ip.useTenureEval?'checked':''}> 勤続評価を使用</div>
      <div class="toggle-row"><input type="checkbox" data-path="incentivePlan.useManagementEval" ${ip.useManagementEval?'checked':''}> マネジメント評価を使用</div>
      ${list.length === 0 ? '<p class="text-muted">「人員体制・給与」で給与を入力すると表示されます。</p>' : `
      <h3>従業員ごとの入力</h3>
      <div id="incentiveStaffRows"></div>
      <div id="incentiveResult"></div>`}
    </div>`;
  attachBindings(main, () => renderIncentiveResult());
  if (list.length > 0) { renderIncentiveStaffRows(list); renderIncentiveResult(); }
}
function renderIncentiveStaffRows(list) {
  const el = document.getElementById('incentiveStaffRows');
  el.innerHTML = list.map(s => {
    const rec = appState.incentivePlan.byStaff[s.id] || {};
    return `
      <div class="repeat-item">
        <div class="repeat-item-title">${esc(s.label)}（給与 ${yen(s.salary)}/月）</div>
        <div class="field-row">
          <div class="field"><label>半期成果（仲介手数料等の半期実績）</label><input type="number" data-inc-field="${s.id}:halfYearResult" value="${rec.halfYearResult || 0}"></div>
          <div class="field"><label>入社日</label><input type="date" data-inc-field="${s.id}:hireDate" value="${rec.hireDate || ''}"></div>
          <div class="field"><label>マネジメント評価（円）</label><input type="number" data-inc-field="${s.id}:managementScore" value="${rec.managementScore || 0}"></div>
        </div>
      </div>`;
  }).join('');
  el.querySelectorAll('[data-inc-field]').forEach(inp => {
    inp.addEventListener('input', () => {
      const [id, field] = inp.getAttribute('data-inc-field').split(':');
      if (!appState.incentivePlan.byStaff[id]) appState.incentivePlan.byStaff[id] = {};
      appState.incentivePlan.byStaff[id][field] = inp.type === 'number' ? parseFloat(inp.value) || 0 : inp.value;
      saveState(); renderIncentiveResult();
    });
  });
}
function renderIncentiveResult() {
  const el = document.getElementById('incentiveResult');
  if (!el) return;
  const result = runFullCalculation(appState);
  const ir = computeIncentivePlan(appState, result);
  const rows = ir.rows.map(r => `
    <tr>
      <td>${esc(r.label)}</td><td>${num(r.monthsElapsed)}ヶ月</td>
      <td>${yen(r.resultIncentive)}</td><td>${yen(r.tenureIncentive)}</td><td>${yen(r.managementIncentive)}</td>
      <td style="font-weight:700">${yen(r.totalIncentive)}</td>
    </tr>`).join('');
  el.innerHTML = `
    <h3>試算結果</h3>
    <div class="table-scroll">
    <table class="plain">
      <thead><tr><th>従業員</th><th>経過月数</th><th>成果評価</th><th>勤続評価</th><th>マネジメント評価</th><th>インセンティブ合計</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="2">合計</td><td>${yen(ir.totalResultIncentive)}</td><td>${yen(ir.totalTenureIncentive)}</td><td>${yen(ir.totalManagementIncentive)}</td><td>${yen(ir.totalIncentive)}</td></tr></tfoot>
    </table>
    </div>
    <div class="stat-cards">
      <div class="stat-card"><div class="label">勤続評価単価/月</div><div class="value">${yen(ir.tenureUnitPrice)}</div></div>
      <div class="stat-card"><div class="label">マネジメント評価原資</div><div class="value ${ir.managementEvalPool < 0 ? 'gold' : ''}">${yen(ir.managementEvalPool)}</div></div>
      <div class="stat-card"><div class="label">原資残</div><div class="value ${ir.remainingPool < 0 ? 'gold' : ''}">${yen(ir.remainingPool)}</div></div>
    </div>
    <p class="small text-muted">マネジメント評価原資＝${appState.incentivePlan.useResultEval ? '原資残' : '半期成果合計×インセンティブ率＋原資残'} － マネジメント評価合計。原資（仲介以外）はマネジメント評価・勤続評価の支払原資であり、成果評価は半期成果（仲介手数料等）から別枠で算出されます。</p>`;
}

/* ===================== スタッフ能力評価 ===================== */
let skillSelectedStaffId = null;
function renderSkillTool() {
  const main = document.getElementById('appMain');
  const list = flattenStaffList(appState).filter(s => s.salary > 0);
  if (list.length === 0) {
    main.innerHTML = `<div class="card"><h2>スタッフ能力評価</h2><p class="text-muted">「人員体制・給与」で給与を入力すると表示されます。</p></div>`;
    return;
  }
  if (!skillSelectedStaffId || !list.find(s => s.id === skillSelectedStaffId)) skillSelectedStaffId = list[0].id;
  const rubricHtml = `
    <h3>評価基準</h3>
    <div class="table-scroll">
      <table class="mini-table rubric-table">
        <thead><tr>${SKILL_RUBRIC.map(r => `<th>${esc(r.step)}</th>`).join('')}</tr></thead>
        <tbody>
          <tr>${SKILL_RUBRIC.map(r => `<td class="rubric-range">目安点　${esc(r.range)}</td>`).join('')}</tr>
          <tr>${SKILL_RUBRIC.map(r => `<td>${esc(r.desc)}</td>`).join('')}</tr>
        </tbody>
      </table>
    </div>`;
  main.innerHTML = `
    <div class="card">
      <h2>スタッフ能力評価（能力判定）</h2>
      <p class="desc">本人・指導者・店舗長の3者評価（各項目0〜10点）で技能評価・個人評価をS〜Dの5段階判定します。各項目は下記の評価基準を目安に採点してください。</p>
      ${rubricHtml}
      <div class="field">
        <label>評価対象スタッフ</label>
        <select id="skillStaffSelect">${list.map(s => `<option value="${s.id}" ${s.id === skillSelectedStaffId ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
      </div>
      <div id="skillBody"></div>
    </div>`;
  document.getElementById('skillStaffSelect').onchange = e => { skillSelectedStaffId = e.target.value; renderSkillBody(); };
  renderSkillBody();
}
function renderSkillBody() {
  const body = document.getElementById('skillBody');
  if (!appState.skillAssessment.records[skillSelectedStaffId]) appState.skillAssessment.records[skillSelectedStaffId] = emptyRecord();
  const record = appState.skillAssessment.records[skillSelectedStaffId];

  const catHtml = SKILL_CATEGORIES.map(cat => `
    <h3>【${esc(cat.label)}】</h3>
    <table class="mini-table">
      <thead><tr><th>項目</th><th>本人</th><th>指導</th><th>店長</th></tr></thead>
      <tbody>
        ${cat.items.map((item, idx) => `
          <tr>
            <td>${esc(item)}</td>
            ${['self','mentor','manager'].map(scorer => `<td><input type="number" min="0" max="10" style="width:56px" data-skill="${cat.key}:${idx}:${scorer}" value="${record[cat.key][idx][scorer] ?? ''}"></td>`).join('')}
          </tr>`).join('')}
      </tbody>
    </table>`).join('');

  body.innerHTML = catHtml + `<div id="skillResult"></div>`;
  body.querySelectorAll('[data-skill]').forEach(inp => {
    inp.oninput = () => {
      const [catKey, idx, scorer] = inp.getAttribute('data-skill').split(':');
      const v = inp.value === '' ? null : Math.max(0, Math.min(10, parseFloat(inp.value)));
      record[catKey][parseInt(idx, 10)][scorer] = v;
      saveState(); renderSkillResult();
    };
  });
  renderSkillResult();
}
function renderSkillResult() {
  const el = document.getElementById('skillResult');
  if (!el) return;
  const results = computeSkillAssessment(appState);
  const r = results.find(x => x.id === skillSelectedStaffId);
  if (!r) return;
  el.innerHTML = `
    <hr class="section-divider">
    <div class="stat-cards">
      <div class="stat-card"><div class="label">技能評価（知識+接客+社内／指導者+店長）</div><div class="value gold">${esc(r.skillGrade)}</div><div class="sub">${num(r.skillScore)} / ${num(r.skillMax)}点</div></div>
      <div class="stat-card"><div class="label">個人評価（対応／指導者+店長）</div><div class="value gold">${esc(r.personalGrade)}</div><div class="sub">${num(r.personalScore)} / ${num(r.personalMax)}点</div></div>
      <div class="stat-card"><div class="label">総合点（本人）</div><div class="value">${num(r.grandTotal.self)}</div></div>
      <div class="stat-card"><div class="label">総合点（指導者）</div><div class="value">${num(r.grandTotal.mentor)}</div></div>
      <div class="stat-card"><div class="label">総合点（店長）</div><div class="value">${num(r.grandTotal.manager)}</div></div>
    </div>`;
}
