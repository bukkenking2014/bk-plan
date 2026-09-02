/*
 * ui-wizard.js
 * 入力ウィザード（7ステップ）のレンダリング。
 * ステップ順は元Excelのシート順（社名→ターゲットエリア→免許→目標設定→事業検討→…）に
 * 合わせている。全体フローは加盟店ごとの入力が不要な固定コンテンツのため、独立した
 * 「②全体フロー・スケジュール」タブに表示する。店舗内装は入力項目自体を廃止した。
 */

let wizardStepIndex = 0;

const WIZARD_STEPS = [
  { id: 'basic', title: '基本情報', render: renderStepBasic },
  { id: 'areas', title: 'ターゲットエリア', render: renderStepAreas },
  { id: 'license', title: '免許状況', render: renderStepLicense },
  { id: 'goals', title: '目標設定（人員体制・給与）', render: renderStepGoals },
  { id: 'ad', title: '広告宣伝費・反響目標', render: renderStepAd },
  { id: 'synergy', title: '建築事業', render: renderStepSynergy },
  { id: 'costs', title: 'その他運営コスト', render: renderStepCosts }
];

function renderWizard() {
  const main = document.getElementById('appMain');
  main.innerHTML = `
    <div class="wizard-progress" id="wizardProgress"></div>
    <div id="wizardStepContainer"></div>
    <div class="wizard-nav no-print">
      <button class="btn-outline" id="wizBack">← 戻る</button>
      <button class="btn-ghost" id="wizReset">入力をリセット</button>
      <button class="btn-primary" id="wizNext">次へ →</button>
    </div>
  `;
  renderWizardProgress();
  renderWizardStep();

  document.getElementById('wizBack').onclick = () => { if (wizardStepIndex > 0) { wizardStepIndex--; renderWizardProgress(); renderWizardStep(); window.scrollTo(0,0);} };
  document.getElementById('wizNext').onclick = () => {
    if (wizardStepIndex < WIZARD_STEPS.length - 1) { wizardStepIndex++; renderWizardProgress(); renderWizardStep(); window.scrollTo(0,0); }
    else { setActiveView('report'); }
  };
  document.getElementById('wizReset').onclick = resetState;
}

function renderWizardProgress() {
  const el = document.getElementById('wizardProgress');
  el.innerHTML = WIZARD_STEPS.map((s, i) => `
    <div class="step-dot ${i === wizardStepIndex ? 'active' : i < wizardStepIndex ? 'done' : ''}" data-idx="${i}">
      ${i + 1}. ${esc(s.title)}
    </div>`).join('');
  el.querySelectorAll('.step-dot').forEach(dot => {
    dot.onclick = () => { wizardStepIndex = parseInt(dot.getAttribute('data-idx'), 10); renderWizardProgress(); renderWizardStep(); };
  });
}

function renderWizardStep() {
  const container = document.getElementById('wizardStepContainer');
  const step = WIZARD_STEPS[wizardStepIndex];
  const btnNext = document.getElementById('wizNext');
  const btnBack = document.getElementById('wizBack');
  if (btnBack) btnBack.style.visibility = wizardStepIndex === 0 ? 'hidden' : 'visible';
  if (btnNext) btnNext.textContent = wizardStepIndex === WIZARD_STEPS.length - 1 ? '事業計画書を見る →' : '次へ →';
  container.innerHTML = step.render();
  attachBindings(container, () => refreshStepPreview(step.id));
  attachStepHandlers(step.id, container);
  refreshStepPreview(step.id);
}

function attachStepHandlers(stepId, container) {
  if (stepId === 'areas') attachAreasHandlers(container);
  if (stepId === 'goals') attachStaffHandlers(container);
  if (stepId === 'synergy') attachSynergyHandlers(container);
}

function refreshStepPreview(stepId) {
  const el = document.getElementById('preview-' + stepId);
  if (!el) return;
  const result = runFullCalculation(appState);
  el.innerHTML = previewRenderers[stepId] ? previewRenderers[stepId](result) : '';
}

/* ===================== STEP 1: 基本情報 ===================== */
function renderStepBasic() {
  const m = appState.meta;
  return `
    <div class="card">
      <h2>基本情報</h2>
      <p class="desc">事業計画書の表紙・スケジュール逆算の起点となる情報です。</p>
      <div class="field-row">
        ${fieldText('会社名', 'meta.companyName', m.companyName, { placeholder: '○〇○〇株式会社' })}
        ${fieldDate('オープン予定日', 'meta.openDate', m.openDate)}
      </div>
    </div>`;
}

/* ===================== STEP 2: 免許状況 ===================== */
function renderStepLicense() {
  const hasLicense = appState.license.hasLicense;
  const items = appState.license.items;
  const groupLabel = { prefecture: '［ 県申請時 ］', association: '［ 協会申請時 ］' };
  let lastGroup = null;
  const rows = items.map((item, idx) => {
    const groupHeader = item.group !== lastGroup ? `<h3>${esc(groupLabel[item.group] || '')}</h3>` : '';
    lastGroup = item.group;
    return `${groupHeader}
      <div class="field-row" style="margin-bottom:8px">
        <div class="field" style="flex:2">
          <label>${esc(item.label)}</label>
        </div>
        <div class="field field-numeric">
          <div class="suffix-input">
            <input type="text" inputmode="decimal" data-numeric="true" data-path="license.items.${idx}.amount" value="${esc(formatNum(item.amount))}" data-min="0" style="text-align:right" autocomplete="off">
            <span>円</span>
          </div>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="card">
      <h2>免許状況</h2>
      <p class="desc">宅地建物取引業免許の有無により、店舗組成費（イニシャル）の計上が変わります。金額は都道府県・協会により異なるため、実際の金額に編集してください。</p>
      <div class="radio-group">
        <label><input type="radio" name="lic" value="true" data-path="license.hasLicense" ${hasLicense ? 'checked' : ''}> 免許 有り</label>
        <label><input type="radio" name="lic" value="false" data-path="license.hasLicense" ${!hasLicense ? 'checked' : ''}> 免許 無し（新規取得）</label>
      </div>
      <div id="preview-license"></div>
      <h3>免許取得・協会加入費用 内訳（編集可）</h3>
      ${rows}
    </div>`;
}
function previewLicense(result) {
  const lic = result.license;
  return `
    <div class="preview-panel">
      <h3>免許費用概要</h3>
      <div class="preview-grid">
        <div class="preview-stat"><div class="label">県申請時 小計</div><div class="value">${yen(lic.prefectureSubtotal)}</div></div>
        <div class="preview-stat"><div class="label">協会申請時 小計</div><div class="value">${yen(lic.associationSubtotal)}</div></div>
        <div class="preview-stat"><div class="label">合計</div><div class="value">${yen(lic.total)}</div></div>
      </div>
      <p class="small" style="color:#fff;opacity:.85;margin-bottom:0;margin-top:10px">${appState.license.hasLicense ? '免許「有り」のため、この費用は店舗組成費に計上されません。' : '免許「無し」のため、上記合計が店舗組成費（イニシャル）に自動計上されます。'}</p>
    </div>`;
}

/* ===================== STEP 3: ターゲットエリア ===================== */
function areaTypeFields(area, idx, key, label) {
  return fieldNumber(`${label} 物件数`, `areas.${idx}.${key}.count`, area[key].count, { suffix: '件' })
    + fieldNumber(`${label} 平均価格`, `areas.${idx}.${key}.priceMan`, area[key].priceMan, { suffix: '万円' });
}
function renderStepAreas() {
  const areas = appState.areas;
  const items = areas.map((a, idx) => `
    <div class="repeat-item">
      ${areas.length > 1 ? `<button class="remove-btn" data-remove-area="${idx}">✕</button>` : ''}
      <div class="repeat-item-title">エリア ${idx + 1}</div>
      <div class="field-row">
        ${fieldText('エリア名', `areas.${idx}.name`, a.name, { narrow: true })}
        ${fieldNumber('世帯数', `areas.${idx}.households`, a.households, { suffix: '世帯' })}
      </div>
      <div class="field-row">${areaTypeFields(a, idx, 'land', '土地')}</div>
      <div class="field-row">${areaTypeFields(a, idx, 'usedHouse', '中古戸建')}</div>
      <div class="field-row">${areaTypeFields(a, idx, 'newHouse', '新築戸建')}</div>
      <div class="field-row">${areaTypeFields(a, idx, 'mansion', 'マンション')}</div>
    </div>`).join('');

  return `
    <div class="card">
      <h2>ターゲットエリア</h2>
      <p class="desc">活動エリアは複数登録できます。エリアごとの物件数・平均価格から仲介手数料単価を自動算出します。</p>
      <div id="preview-areas"></div>
      <div class="field-row">
        ${fieldNumber('CPC（クリック単価）', 'cpc', appState.cpc, { suffix: '円' })}
      </div>
      <div class="repeat-list">${items}</div>
      <button class="btn-outline btn-sm" id="addAreaBtn" type="button">＋ エリアを追加</button>
    </div>`;
}
function attachAreasHandlers(container) {
  const addBtn = container.querySelector('#addAreaBtn');
  if (addBtn) addBtn.onclick = () => {
    appState.areas.push({ name: '', households: 0, land: { count: 0, priceMan: 0 }, usedHouse: { count: 0, priceMan: 0 }, newHouse: { count: 0, priceMan: 0 }, mansion: { count: 0, priceMan: 0 } });
    saveState(); renderWizardStep();
  };
  container.querySelectorAll('[data-remove-area]').forEach(btn => {
    btn.onclick = () => { appState.areas.splice(parseInt(btn.getAttribute('data-remove-area'), 10), 1); saveState(); renderWizardStep(); };
  });
}
function previewAreas(result) {
  const a = result.areas;
  const detailTables = a.details.map((d, i) => areaTypeBreakdownTable(appState.areas[i].name || 'エリア' + (i + 1), d, true)).join('');
  const typeRows = PROPERTY_TYPES.map(t => `
    <tr>
      <td>${esc(PROPERTY_TYPE_LABELS[t])}</td>
      <td>${num(a.typeTotals[t].count)}件</td>
      <td>${man(a.typeTotals[t].amountMan)}</td>
    </tr>`).join('');
  return `
    <div class="preview-panel">
      <h3>ターゲットエリア分析プレビュー</h3>
      <div class="preview-grid">
        <div class="preview-stat"><div class="label">全エリア合計物件数</div><div class="value">${num(a.totalCount)}<small>件</small></div></div>
        <div class="preview-stat"><div class="label">加重平均 手数料/件</div><div class="value">${man(a.avgFeeManOverall)}</div></div>
        <div class="preview-stat"><div class="label">土地／中古系／新築 構成比</div><div class="value" style="font-size:1em">${pct(a.landRatio,0)} / ${pct(a.usedRatio,0)} / ${pct(a.newRatio,0)}</div></div>
      </div>
      <h4 style="margin:16px 0 4px;color:var(--color-gold);font-size:.92em">種別ごとの合計件数・金額（全エリア合計）</h4>
      <table class="mini-table">
        <thead><tr><th>種別</th><th>合計件数</th><th>合計金額</th></tr></thead>
        <tbody>${typeRows}</tbody>
      </table>
      <p class="small" style="color:#fff;opacity:.8;margin:14px 0 4px">物件種別ごとの手数料・基本構成比（数式に連動して自動更新されます）</p>
      ${detailTables}
    </div>`;
}

/* ===================== STEP 4: 目標設定（人員体制・給与を含む） ===================== */
function staffGroupHtml(groupKey, groupLabel, list, note) {
  const items = list.map((p, idx) => `
    <div class="repeat-item" style="padding:10px 14px;">
      ${list.length > 1 ? `<button class="remove-btn" data-remove-staff="${groupKey}:${idx}">✕</button>` : ''}
      <div class="field-row" style="margin-bottom:0">
        ${fieldNumber(`${groupLabel}${list.length > 1 ? idx + 1 : ''} 給与`, `staff.${groupKey}.${idx}.salary`, p.salary, { suffix: '円/月' })}
      </div>
    </div>`).join('');
  return `
    <h4 style="margin:14px 0 6px;font-size:.92em;color:var(--color-ink-soft)">${esc(groupLabel)}</h4>
    ${note ? `<p class="small text-muted" style="margin:-2px 0 8px">${esc(note)}</p>` : ''}
    <div class="repeat-list">${items}</div>
    <button class="btn-outline btn-sm" data-add-staff="${groupKey}" type="button">＋ ${esc(groupLabel)}を追加</button>
  `;
}
function attachStaffHandlers(container) {
  container.querySelectorAll('[data-add-staff]').forEach(btn => {
    btn.onclick = () => {
      const key = btn.getAttribute('data-add-staff');
      const defaults = { managers: 300000, agents: 250000, supports: 200000 };
      appState.staff[key].push({ salary: defaults[key] || 0 });
      saveState(); renderWizardStep();
    };
  });
  container.querySelectorAll('[data-remove-staff]').forEach(btn => {
    btn.onclick = () => {
      const [key, idx] = btn.getAttribute('data-remove-staff').split(':');
      appState.staff[key].splice(parseInt(idx, 10), 1);
      saveState(); renderWizardStep();
    };
  });
}
function renderStepGoals() {
  const sy = appState.synergy;
  const s = appState.staff;
  return `
    <div class="card">
      <h2>目標設定</h2>
      <h3>【 人員体制・給与 】</h3>
      ${staffGroupHtml('managers', '不動産業務経験者', s.managers, '※3年以上の実務経験を想定しています')}
      ${staffGroupHtml('agents', 'エージェント', s.agents)}
      ${staffGroupHtml('supports', 'サポート', s.supports)}
      <hr class="section-divider">
      <h3>【 対応する事業の設定 】</h3>
      <p class="desc" style="margin-top:-6px">建築事業として対応する事業を選択してください（単価・利益率は次の「建築事業」ステップで編集できます）。</p>
      <div class="toggle-row"><input type="checkbox" data-path="synergy.reform.enabled" ${sy.reform.enabled ? 'checked' : ''}> リフォーム事業</div>
      <p class="small text-muted" style="margin:-4px 0 10px 26px">仲介のお客様の中古物件購入に合わせたリフォーム提案を自社で請け負う事業です。仲介と親和性が高く、比較的取り組みやすい建築シナジーです。</p>
      <div class="toggle-row"><input type="checkbox" data-path="synergy.selfBuild.enabled" ${sy.selfBuild.enabled ? 'checked' : ''}> 新築住宅事業（自社請負）</div>
      <p class="small text-muted" style="margin:-4px 0 10px 26px">土地を購入されるお客様に対して、自社（またはグループ会社）で新築住宅の建築を請け負う事業です。単価が大きい分、施工体制の準備が必要です。</p>
      <div class="toggle-row"><input type="checkbox" data-path="synergy.referral.enabled" ${sy.referral.enabled ? 'checked' : ''}> 他社建築紹介</div>
      <p class="small text-muted" style="margin:-4px 0 10px 26px">自社で建築を請け負わず、提携する建築会社へお客様を紹介し、紹介料を受け取る事業です。施工体制を持たずに建築シナジーを得られます。</p>
      <hr class="section-divider">
      <div class="field-row">
        ${fieldNumber('2年目以降の年間営業利益目標', 'targetProfitAnnual', appState.targetProfitAnnual, { suffix: '円/年', hint: '損益分岐点に上乗せする目標利益（任意、0でも可）' })}
      </div>
      <div id="preview-goals"></div>
    </div>`;
}
function previewGoals(result) {
  const be = result.breakEven;
  const st = result.staff;
  const oc = result.otherCostsAnnual;
  // 元Excel「目標設定」シートの人員リスト（不動産業務経験者→エージェント→サポートの順）
  const staffRows = [];
  (appState.staff.managers || []).forEach((p, i) => staffRows.push({ label: `不動産業務経験者${appState.staff.managers.length > 1 ? i + 1 : ''}`, salary: nonNeg(p.salary) }));
  (appState.staff.agents || []).forEach((p, i) => staffRows.push({ label: `エージェント${appState.staff.agents.length > 1 ? i + 1 : ''}`, salary: nonNeg(p.salary) }));
  (appState.staff.supports || []).forEach((p, i) => staffRows.push({ label: `サポート${appState.staff.supports.length > 1 ? i + 1 : ''}`, salary: nonNeg(p.salary) }));
  const rowCount = Math.max(staffRows.length, 1);
  const staffRowsHtml = staffRows.length === 0 ? '' : staffRows.map((r, i) => `
    <tr>
      <td>${esc(r.label)}</td>
      <td class="ex-cell-input">${yen(r.salary)}</td>
      ${i === 0 ? `
      <td class="ex-cell-merged" rowspan="${rowCount}">${yen(st.laborCostMonth)}</td>
      <td class="ex-cell-merged" rowspan="${rowCount}">${yen(st.laborCostYear)}</td>
      <td class="ex-cell-merged" rowspan="${rowCount}">${yen(oc.grandTotal)}</td>
      <td class="ex-cell-merged" rowspan="${rowCount}">${yen(be.breakEvenAnnual)}</td>` : ''}
    </tr>`).join('');

  return `
    <div class="preview-panel">
      <div class="excel-mimic">
        <h3 class="ex-title">営業利益イメージと必要契約本数</h3>

        <div class="ex-section-label">【 損益分岐点の把握 】</div>
        <div class="table-scroll">
        <table class="excel-table">
          <thead><tr><th>人員</th><th>給与</th><th>人件費/月</th><th>人件費/年</th><th>その他費用/年</th><th>損益分岐/年</th></tr></thead>
          <tbody>${staffRowsHtml}</tbody>
        </table>
        </div>

        <div class="ex-section-label">【 必要契約本数の理解 】</div>
        <div class="ex-flow-row">
          <div class="ex-box"><div class="ex-box-label">損益分岐/年</div><div class="ex-box-value">${yen(be.breakEvenAnnual)}</div></div>
          <div class="ex-op">÷</div>
          <div class="ex-box"><div class="ex-box-label">手数料/件</div><div class="ex-box-value">${yen(result.areas.feeRawYen)}</div></div>
          <div class="ex-op">＝</div>
          <div class="ex-box"><div class="ex-box-label">必要契約数/年</div><div class="ex-box-value">${num(be.requiredContractsYear)}<small>件</small></div></div>
          <div class="ex-op">＝</div>
          <div class="ex-box ex-box-highlight"><div class="ex-box-label">必要契約数/月</div><div class="ex-box-value">${num(be.requiredContractsMonth)}<small>件</small></div><div class="ex-box-note">片手1本換算</div></div>
        </div>
        <div class="table-scroll">
        <table class="excel-table small">
          <thead><tr><th>年間契約数</th><th>手数料合計</th><th>営業利益（損益余剰分）</th></tr></thead>
          <tbody><tr><td>${num(be.referenceAnnualContracts)}件</td><td>${yen(be.referenceAnnualRevenue)}</td><td>${yenAcct(be.referenceOperatingSurplus)}</td></tr></tbody>
        </table>
        </div>

        <div class="ex-section-label">【 年間 営業利益イメージ（2年目以降） 】</div>
        <div class="ex-flow-row">
          <div class="ex-box"><div class="ex-box-label">年間</div><div class="ex-box-value ex-cell-input">${yen(appState.targetProfitAnnual)}</div></div>
          <div class="ex-op">÷</div>
          <div class="ex-box"><div class="ex-box-label">手数料/件</div><div class="ex-box-value">${yen(result.areas.feeRawYen)}</div></div>
          <div class="ex-op">＝</div>
          <div class="ex-box"><div class="ex-box-label">必要契約数/年</div><div class="ex-box-value">${num(be.targetProfitContractsYear)}<small>件</small></div></div>
          <div class="ex-op">＝</div>
          <div class="ex-box ex-box-highlight"><div class="ex-box-label">必要契約数/月</div><div class="ex-box-value">${num(be.targetProfitContractsMonth)}<small>件</small></div></div>
        </div>

        <div class="ex-target-row">
          <div class="ex-target-box"><div class="ex-target-label">目標とする契約件数/月</div><div class="ex-target-value">${num(be.targetContractsMonth)}<small>件</small></div></div>
          <div class="ex-target-box"><div class="ex-target-label">目標とする契約件数/年</div><div class="ex-target-value">${num(be.targetContractsYear)}<small>件</small></div></div>
          <div class="table-scroll">
          <table class="excel-table small ex-breakdown-table">
            <tbody>
              <tr><td>土地</td><td>${num(be.targetLandCount)}</td></tr>
              <tr><td>中古系</td><td>${num(be.targetUsedCount,1)}</td></tr>
              <tr><td>新築建売</td><td>${num(be.targetNewCount,1)}</td></tr>
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>`;
}

/* ===================== STEP 5: 広告宣伝費・反響目標 ===================== */
function renderStepAd() {
  const ad = appState.ad;
  return `
    <div class="card">
      <h2>広告宣伝費・反響目標</h2>
      <p class="desc">目標件数・CPC・CVRからPPC予算とCPA（獲得単価）を自動算出します。ポータル等の追加広告費は任意で編集できます。</p>
      <div id="preview-ad"></div>
      <div class="field-row">
        ${fieldNumber('目標件数（反響数/月）', 'ad.targetLeads', ad.targetLeads, { suffix: '件/月', hint: '目安：営業人数×15件' })}
        ${fieldLinkedValue('CPC（クリック単価）', num(appState.cpc), { suffix: '円', hint: '「ターゲットエリア」で入力済みの値です' })}
        ${fieldNumber('CVR（反響獲得率）', 'ad.cvr', ad.cvr * 100, { suffix: '%', step: '0.1' })}
      </div>
      <p class="hint">※CVRの入力は%単位。CPA（獲得単価）＝CPC÷CVRで自動計算されます（下のプレビューで確認できます）。</p>
      <div class="field-row">
        ${fieldNumber('ポータルサイト費用', 'ad.portal', ad.portal, { suffix: '円/月' })}
        ${fieldNumber('査定サイト費用', 'ad.assessmentSite', ad.assessmentSite, { suffix: '円/月' })}
      </div>
      <div class="field-row">
        ${fieldNumber('その他広告費①', 'ad.other1', ad.other1, { suffix: '円/月' })}
        ${fieldNumber('その他広告費②', 'ad.other2', ad.other2, { suffix: '円/月' })}
      </div>
    </div>`;
}
function previewAd(result) {
  const bp = result.businessPlan;
  return `
    <div class="preview-panel">
      <h3>広告宣伝費プレビュー</h3>
      <div class="preview-grid">
        <div class="preview-stat"><div class="label">目標反響数/月</div><div class="value">${num(bp.targetLeads)}<small>件</small></div></div>
        <div class="preview-stat"><div class="label">CPA（獲得単価・自動計算）</div><div class="value">${yen(bp.cpa)}</div></div>
        <div class="preview-stat"><div class="label">PPC予算/月（通常）</div><div class="value">${yen(bp.ppcBudgetMonth)}</div></div>
        <div class="preview-stat"><div class="label">広告予算/月（税込・通常）</div><div class="value">${yen(bp.adBudgetMonthBaseTax)}</div></div>
        <div class="preview-stat"><div class="label">広告予算/月（税別・通常）</div><div class="value">${yen(bp.adBudgetMonthBase)}</div></div>
        <div class="preview-stat"><div class="label">広告予算/月（税込・オープン半年）</div><div class="value">${yen(bp.adBudgetMonthBoostedTax)}</div></div>
        <div class="preview-stat"><div class="label">広告予算/月（税別・オープン半年）</div><div class="value">${yen(bp.ppcBudgetBoosted)}</div></div>
      </div>
    </div>`;
}

/* ===================== STEP 6: 建築事業 ===================== */
function synergyBlock(key, label, cfg, extraFields) {
  return `
    <h3>${esc(label)}${cfg.enabled ? '' : '<span class="small text-muted">（「目標設定」ステップで未対応に設定されています）</span>'}</h3>
    <div class="field-row">
      ${fieldNumber('単価', `synergy.${key}.unitPrice`, cfg.unitPrice, { suffix: '円' })}
      ${cfg.profitRate !== undefined ? fieldNumber('利益率', `synergy.${key}.profitRate`, cfg.profitRate * 100, { suffix: '%' }) : ''}
      ${fieldNumber('不動産分配利益率', `synergy.${key}.allocRate`, cfg.allocRate * 100, { suffix: '%' })}
      ${fieldNumber('歩留り（受注転換率）', `synergy.${key}.conversionRate`, cfg.conversionRate * 100, { suffix: '%' })}
    </div>
    ${extraFields || ''}
  `;
}
function renderStepSynergy() {
  const sy = appState.synergy;
  return `
    <div class="card">
      <h2>建築事業</h2>
      <p class="desc">リフォーム／自社請負（新築住宅事業）／他社建築紹介、それぞれの受注頻度・単価・利益率を設定します（デフォルト値は編集可能）。対応する事業そのものの選択は「目標設定」ステップで行います。</p>
      ${synergyBlock('reform', 'リフォーム事業', sy.reform)}
      <hr class="section-divider">
      ${synergyBlock('selfBuild', '新築住宅事業（自社請負）', sy.selfBuild, `
        <div class="field-row">
          ${fieldNumber('年間上限件数（営業1名）', 'synergy.selfBuild.capSolo', sy.selfBuild.capSolo, { suffix: '件/年' })}
          ${fieldNumber('年間上限件数（営業2名以上）', 'synergy.selfBuild.capTeam', sy.selfBuild.capTeam, { suffix: '件/年' })}
        </div>`)}
      <hr class="section-divider">
      ${synergyBlock('referral', '他社建築紹介', sy.referral, `
        <div class="field-row">
          ${fieldNumber('年間上限件数（営業1名）', 'synergy.referral.capSolo', sy.referral.capSolo, { suffix: '件/年' })}
          ${fieldNumber('年間上限件数（営業2名以上）', 'synergy.referral.capTeam', sy.referral.capTeam, { suffix: '件/年' })}
        </div>`)}
      <div id="preview-synergy"></div>
    </div>`;
}
function attachSynergyHandlers(container) {
  container.querySelectorAll('input[type=checkbox][data-path]').forEach(cb => {
    cb.addEventListener('change', () => refreshStepPreview('synergy'));
  });
}
function previewSynergy(result) {
  const bp = result.businessPlan;
  function row(label, s) {
    return `<tr><td>${esc(label)}</td><td>${num(s.annualFreq)}件/年</td><td>${yen(s.perDealProfit)}</td><td>${yen(s.annualProfit)}</td></tr>`;
  }
  return `
    <h3>建築事業 利益イメージ</h3>
    <table class="plain">
      <thead><tr><th>事業</th><th>年間受注頻度</th><th>1件あたり利益</th><th>年間利益</th></tr></thead>
      <tbody>
        ${row('リフォーム', bp.reform)}
        ${row('自社請負', bp.selfBuild)}
        ${row('他社紹介', bp.referral)}
      </tbody>
    </table>`;
}

/* ===================== STEP 7: その他運営コスト ===================== */
function renderStepCosts() {
  const oc = appState.otherCosts;
  const ic = appState.initialCost;
  const ir = appState.incentiveRule;
  const pe = appState.plExtras;
  const st = computeStaff(appState);
  const travelMonth = st.salesHeadcount * 30000;
  const commMonth = st.salesHeadcount * 15000 + 25000;
  const taxMonth = nonNeg(appState.confirmedContractsPerMonth) * 10000;
  const equipmentAnnual = st.totalHeadcount * 100000;
  return `
    <div class="card">
      <h2>その他運営コスト</h2>
      <p class="desc">デフォルト値は物件王の標準想定値です。必要に応じて編集してください。月額・年額のどちらかを入力すると、もう一方の換算値も表示されます。</p>
      <div class="field-row">
        ${fieldNumber('消耗品費', 'otherCosts.consumables', oc.consumables, { suffix: '円/年', dual: { label: '月換算：', factor: 1 / 12 } })}
        ${fieldNumber('事務用品費', 'otherCosts.officeSupplies', oc.officeSupplies, { suffix: '円/年', dual: { label: '月換算：', factor: 1 / 12 } })}
        ${fieldNumber('諸会費', 'otherCosts.dues', oc.dues, { suffix: '円/年', dual: { label: '月換算：', factor: 1 / 12 } })}
      </div>
      <div class="field-row">
        ${fieldNumber('水道光熱費', 'otherCosts.utilities', oc.utilities, { suffix: '円/年', dual: { label: '月換算：', factor: 1 / 12 } })}
        ${fieldNumber('リース料', 'otherCosts.lease', oc.lease, { suffix: '円/年', dual: { label: '月換算：', factor: 1 / 12 } })}
        ${fieldNumber('雑費', 'otherCosts.misc', oc.misc, { suffix: '円/年', dual: { label: '月換算：', factor: 1 / 12 } })}
      </div>
      <div class="field-row">
        ${fieldNumber('研修費（成長投資費）', 'otherCosts.training', oc.training, { suffix: '円/月', dual: { label: '年換算：', factor: 12 }, hint: 'PPCコンサル費・SVコンサル費を含む合計額を入力してください' })}
        ${fieldNumber('店舗賃料', 'otherCosts.storeRent', oc.storeRent, { suffix: '円/月', dual: { label: '年換算：', factor: 12 }, hint: '備考：家賃等が発生する場合は計上' })}
        ${fieldNumber('採用費', 'otherCosts.recruiting', oc.recruiting, { suffix: '円（初月一括）', hint: '備考：想定年収×35%' })}
      </div>
      <h3>旅費交通費・通信費・租税公課・備品費（自動算出）</h3>
      <div class="field-row">
        <div class="field">
          <label>旅費交通費</label>
          <div class="suffix-input"><span style="padding:9px 0">${yen(travelMonth)}</span><span>円/月</span></div>
          <div class="hint">営業人数（${num(st.salesHeadcount)}名）× 30,000円</div>
        </div>
        <div class="field">
          <label>通信費</label>
          <div class="suffix-input"><span style="padding:9px 0">${yen(commMonth)}</span><span>円/月</span></div>
          <div class="hint">営業人数（${num(st.salesHeadcount)}名）× 15,000円＋25,000円（固定電話等）</div>
        </div>
        <div class="field">
          <label>租税公課</label>
          <div class="suffix-input"><span style="padding:9px 0">${yen(taxMonth)}</span><span>円/月</span></div>
          <div class="hint">必要契約件数（${num(appState.confirmedContractsPerMonth)}件/月）× 10,000円（印紙代等）</div>
        </div>
        <div class="field">
          <label>備品費</label>
          <div class="suffix-input"><span style="padding:9px 0">${yen(equipmentAnnual)}</span><span>円/年</span></div>
          <div class="hint">総人数（${num(st.totalHeadcount)}名）× 100,000円（PC費用等、開店時一括計上）</div>
        </div>
      </div>
      <p class="hint">※人員体制・必要契約件数から自動計算され、月次PLに反映されます。この画面では編集できません。</p>
      <div class="field-row">
        ${fieldNumber('接待交際費', 'otherCosts.entertainment', oc.entertainment, { suffix: '円/月', dual: { label: '年換算：', factor: 12 }, hint: '備考：店長等に予算を設けるのであれば設定' })}
        ${fieldNumber('保険料', 'otherCosts.insurance', oc.insurance, { suffix: '円/月', dual: { label: '年換算：', factor: 12 }, hint: '備考：火災保険や自動車保険等加入の場合計上' })}
      </div>
      <h3>減価償却（内装工事等）</h3>
      <div class="field-row">
        ${fieldNumber('内装工事費用（減価償却対象）', 'otherCosts.renovationCostBasis', oc.renovationCostBasis, { suffix: '円' })}
        <div class="field">
          <label>償却区分</label>
          <select data-path="otherCosts.depreciationType">
            <option value="改装" ${oc.depreciationType === '改装' ? 'selected' : ''}>改装（15年償却）</option>
            <option value="新築" ${oc.depreciationType !== '改装' ? 'selected' : ''}>新築等（20年償却）</option>
          </select>
        </div>
      </div>
      <h3>店舗組成費（イニシャル）</h3>
      <p class="desc" style="margin-top:-4px">免許費用（免許「無し」の場合のみ自動計上）に加え、以下は免許の有無に関わらず計上されます。</p>
      <div class="field-row">
        ${fieldNumber('物件王 加盟金', 'initialCost.franchiseFee', ic.franchiseFee, { suffix: '円' })}
        ${fieldNumber('物件王会費', 'initialCost.membershipFee', ic.membershipFee, { suffix: '円' })}
        ${fieldNumber('看板設置費用', 'initialCost.signageCost', ic.signageCost, { suffix: '円' })}
      </div>
      <h3>インセンティブ（仲介手数料連動）</h3>
      <div class="field-row">
        ${fieldNumber('足切り係数', 'incentiveRule.cutoffFactor', ir.cutoffFactor, { suffix: '倍', step: '0.1' })}
        ${fieldNumber('インセンティブ率', 'incentiveRule.incentiveRate', ir.incentiveRate * 100, { suffix: '%' })}
      </div>
      <h3>損益分岐点算出用の想定PPC費用</h3>
      <div class="field-row">
        ${fieldNumber('想定PPC費用', 'otherCosts.assumedPpcAnnual', oc.assumedPpcAnnual, { suffix: '円/年', hint: '損益分岐点計算に用いる簡易想定値（実際の広告予算とは別建て）' })}
      </div>
      <h3>営業外損益・特別損益・税金（任意）</h3>
      <p class="desc" style="margin-top:-4px">通常は入力不要（0円のまま）です。借入金の利息や保険金収入・法人税等の見込みがある場合のみ、年額で入力してください。月次PLの「経常損益」「当期純損益」「総資産」に反映されます。</p>
      <div class="field-row">
        ${fieldNumber('受取利息', 'plExtras.interestIncome', pe.interestIncome, { suffix: '円/年' })}
        ${fieldNumber('雑収入', 'plExtras.miscIncome', pe.miscIncome, { suffix: '円/年' })}
        ${fieldNumber('支払利息', 'plExtras.interestExpense', pe.interestExpense, { suffix: '円/年', hint: '借入金がある場合の利息' })}
      </div>
      <div class="field-row">
        ${fieldNumber('雑損失', 'plExtras.miscLoss', pe.miscLoss, { suffix: '円/年' })}
        ${fieldNumber('特別利益・損失', 'plExtras.extraordinaryItems', pe.extraordinaryItems, { suffix: '円/年', min: null, hint: '損失の場合はマイナスで入力' })}
        ${fieldNumber('法人税等', 'plExtras.corporateTax', pe.corporateTax, { suffix: '円/年' })}
      </div>
      <div id="preview-costs"></div>
    </div>`;
}
function previewCosts(result) {
  const bp = result.businessPlan;
  return `
    <div class="preview-panel">
      <h3>店舗組成費プレビュー</h3>
      <div class="preview-grid">
        <div class="preview-stat"><div class="label">店舗組成費合計（税込）</div><div class="value">${yen(bp.initialCostTotalTax)}</div></div>
      </div>
    </div>`;
}

const previewRenderers = {
  license: previewLicense, areas: previewAreas,
  goals: previewGoals, ad: previewAd, synergy: previewSynergy, costs: previewCosts
};
