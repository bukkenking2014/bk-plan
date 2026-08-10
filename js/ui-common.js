/*
 * ui-common.js
 * 画面共通のフォーマット・入力バインディングヘルパー。
 */

function yen(n) {
  if (n === null || n === undefined || isNaN(n)) return '―';
  return Math.round(n).toLocaleString('ja-JP') + '円';
}
// 会計表記：マイナスは「-」ではなく△（赤字）で表す（日本の会計書類の慣例）
function yenAcct(n) {
  if (n === null || n === undefined || isNaN(n)) return '―';
  const r = Math.round(n);
  if (r < 0) return `<span class="neg">△${Math.abs(r).toLocaleString('ja-JP')}円</span>`;
  return r.toLocaleString('ja-JP') + '円';
}
// プレーンテキスト版（SVGのtitle属性など、HTMLタグを使えない場所用）
function yenAcctText(n) {
  if (n === null || n === undefined || isNaN(n)) return '―';
  const r = Math.round(n);
  return (r < 0 ? `△${Math.abs(r).toLocaleString('ja-JP')}` : r.toLocaleString('ja-JP')) + '円';
}
function numAcct(n, digits) {
  if (n === null || n === undefined || isNaN(n)) return '―';
  const v = Number(n);
  const s = Math.abs(v).toLocaleString('ja-JP', { maximumFractionDigits: digits || 0, minimumFractionDigits: digits || 0 });
  return v < 0 ? `<span class="neg">△${s}</span>` : s;
}
function man(n) {
  if (n === null || n === undefined || isNaN(n)) return '―';
  return (Math.round(n * 10) / 10).toLocaleString('ja-JP') + '万円';
}
function num(n, digits) {
  if (n === null || n === undefined || isNaN(n)) return '―';
  return Number(n).toLocaleString('ja-JP', { maximumFractionDigits: digits || 0, minimumFractionDigits: digits || 0 });
}
function pct(n, digits) {
  if (n === null || n === undefined || isNaN(n)) return '―';
  return (n * 100).toLocaleString('ja-JP', { maximumFractionDigits: digits === undefined ? 1 : digits }) + '%';
}
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// data-path属性を持つ入力要素からappStateへ値を反映する委譲ハンドラをコンテナに設置
function attachBindings(container, onChange) {
  container.addEventListener('input', e => {
    const el = e.target;
    // IME変換中（日本語入力の未確定文字列）は反映処理をスキップする。
    // 変換確定時に改めてinputイベントが発火するため、確定後の値で正しく反映される。
    // これを行わないと、変換中に毎回state更新→プレビュー再描画が走り、
    // 環境によっては変換中の文字列が消えて英数字しか入力できないように見える事がある。
    if (e.isComposing) return;
    const path = el.getAttribute('data-path');
    if (!path) return;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'number') {
      value = el.value === '' ? 0 : parseFloat(el.value);
      if (!isNaN(value) && el.min !== '') {
        const min = parseFloat(el.min);
        if (!isNaN(min) && value < min) { value = min; el.value = min; }
      }
    }
    else value = el.value;
    setPath(appState, path, value);
    saveState();
    // 月⇄年など「もう一方の単位換算」表示を持つ項目があればライブ更新する
    if (el.type === 'number') {
      container.querySelectorAll(`[data-dual-source="${path}"]`).forEach(d => {
        const factor = parseFloat(d.getAttribute('data-dual-factor'));
        const label = d.getAttribute('data-dual-label') || '';
        d.textContent = label + yen(value * factor);
      });
    }
    if (onChange) onChange();
  });
  container.addEventListener('change', e => {
    const el = e.target;
    if (el.tagName === 'SELECT' || el.type === 'radio') {
      const path = el.getAttribute('data-path');
      if (!path) return;
      const value = el.type === 'radio' ? el.value === 'true' ? true : (el.value === 'false' ? false : el.value) : el.value;
      setPath(appState, path, value);
      saveState();
      if (onChange) onChange();
    }
  });
}

// opts.dual: { label, factor } を渡すと、月⇄年など「もう一方の単位換算」を
// ライブ更新のヒント表示として追加する（例: 円/月の入力に対し年換算を表示、factor=12）。
function fieldNumber(label, path, value, opts) {
  opts = opts || {};
  const suffix = opts.suffix || '';
  const hint = opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : '';
  // このアプリの数値入力（件数・金額・料率など）はすべて0以上。
  // opts.min に明示的にnullを渡した場合のみ下限なしにできる。
  const min = opts.min === null ? null : (opts.min !== undefined ? opts.min : 0);
  const dual = opts.dual ? `<div class="hint" data-dual-source="${path}" data-dual-factor="${opts.dual.factor}" data-dual-label="${esc(opts.dual.label)}">${esc(opts.dual.label)}${yen((Number(value) || 0) * opts.dual.factor)}</div>` : '';
  return `
    <div class="field">
      <label>${esc(label)}</label>
      <div class="suffix-input">
        <input type="number" data-path="${path}" value="${value}" step="${opts.step || 'any'}" ${min !== null ? `min="${min}"` : ''}>
        ${suffix ? `<span>${esc(suffix)}</span>` : ''}
      </div>
      ${hint}
      ${dual}
    </div>`;
}

function fieldText(label, path, value, opts) {
  opts = opts || {};
  return `
    <div class="field">
      <label>${esc(label)}</label>
      <input type="text" data-path="${path}" value="${esc(value)}" placeholder="${esc(opts.placeholder || '')}" autocomplete="off">
      ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}
    </div>`;
}

function fieldDate(label, path, value) {
  return `
    <div class="field">
      <label>${esc(label)}</label>
      <input type="date" data-path="${path}" value="${esc(value)}">
    </div>`;
}

// 物件種別ラベル（ターゲットエリアシート C17:C20 等）
const PROPERTY_TYPE_LABELS = { land: '土地', usedHouse: '中古戸建', newHouse: '新築戸建', mansion: 'マンション' };

// エリア1件分の「種別ごとの手数料・基本構成比・構成比手数料」テーブルHTML
// dark=true で暗い背景（プレビューパネル内）用の配色にする
function areaTypeBreakdownTable(areaName, detail, dark) {
  const rows = PROPERTY_TYPES.map(t => `
    <tr>
      <td>${esc(PROPERTY_TYPE_LABELS[t])}</td>
      <td>${num(detail.counts[t])}件</td>
      <td>${man(detail.prices[t])}</td>
      <td>${man(detail.fees[t])}</td>
      <td>${pct(detail.compRatio[t], 1)}</td>
      <td>${man(detail.weightedFee[t])}</td>
    </tr>`).join('');
  const headColor = dark ? 'color:#cba55c' : '';
  return `
    <div class="table-scroll">
    <table class="${dark ? 'mini-table' : 'plain'}" style="${dark ? 'color:#fff' : ''}">
      <thead>
        <tr><th colspan="6" style="text-align:left;${headColor}">${esc(areaName)}</th></tr>
        <tr>
          <th style="${headColor}">種別</th><th style="${headColor}">物件数</th><th style="${headColor}">平均価格</th>
          <th style="${headColor}">手数料</th><th style="${headColor}">基本構成比</th><th style="${headColor}">構成比手数料</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5">手数料/件（加重平均）</td><td>${man(detail.feePerDealMan)}</td></tr></tfoot>
    </table>
    </div>`;
}
