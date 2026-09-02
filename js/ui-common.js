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
// 手数料など、四捨五入ではなく切り捨て（小数第1位）で表示したい金額用
function manFloor(n) {
  if (n === null || n === undefined || isNaN(n)) return '―';
  return (Math.floor(n * 10) / 10).toLocaleString('ja-JP') + '万円';
}
// 月次PLなど列数が多い表向け：万円単位・整数（小数なし）・「万円」の文字は付けず数字のみ
// （表の見出しに単位：万円と明記し、セル自体は数字だけにして横幅を詰める）
function manUnit(n) {
  if (n === null || n === undefined || isNaN(n)) return '―';
  return Math.round(n / 10000).toLocaleString('ja-JP');
}
// 会計表記版（マイナスは△表示）
function manUnitAcct(n) {
  if (n === null || n === undefined || isNaN(n)) return '―';
  const r = Math.round(n / 10000);
  if (r < 0) return `<span class="neg">△${Math.abs(r).toLocaleString('ja-JP')}</span>`;
  return r.toLocaleString('ja-JP');
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

// カンマ区切りの数値入力欄（fieldNumber）用：表示用フォーマット／パース
function formatNum(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  if (isNaN(n)) return '';
  return n.toLocaleString('ja-JP', { maximumFractionDigits: 6 });
}
function parseNum(raw) {
  if (raw === null || raw === undefined) return NaN;
  const cleaned = String(raw).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '-') return NaN;
  return parseFloat(cleaned);
}

// data-path属性を持つ入力要素からappStateへ値を反映する委譲ハンドラをコンテナに設置
//
// IME（日本語入力）変換中の扱いについて：
// 変換中に毎回state更新→プレビュー再描画を走らせると、環境によっては変換中の
// 文字列が消えて英数字しか入力できないように見える事がある。これを防ぐため、
// 変換中は反映処理をスキップし、変換確定後にまとめて反映する。
// e.isComposing はブラウザによって信頼できない事があるため（特にSafariは
// 過去バージョンでinputイベントのisComposingが正しく立たない不具合が知られている）、
// compositionstart/compositionendを自前で追跡して判定する。
function attachBindings(container, onChange) {
  let composingEl = null;
  container.addEventListener('compositionstart', e => { composingEl = e.target; });
  container.addEventListener('compositionend', e => {
    composingEl = null;
    // 変換確定時、ブラウザによってはcompositionendの後にinputイベントが
    // 発火しない事があるため、ここで改めて反映処理を呼んで確実に反映する。
    commitInput_(container, e.target, onChange);
  });
  container.addEventListener('input', e => {
    if (e.isComposing || composingEl === e.target) return;
    commitInput_(container, e.target, onChange);
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
  // カンマ区切り数値入力（data-numeric="true"）：入力中は生の文字列のまま（カーソル位置を
  // 崩さないため）、フォーカスが外れた時点でカンマ区切り表示に整形し直す。
  // blurはバブリングしないため委譲にはfocusoutを使う。
  container.addEventListener('focusout', e => {
    const el = e.target;
    if (!(el && el.dataset && el.dataset.numeric === 'true')) return;
    const parsed = parseNum(el.value);
    let value = isNaN(parsed) ? 0 : parsed;
    const minAttr = el.getAttribute('data-min');
    if (minAttr !== null && minAttr !== '') {
      const min = parseFloat(minAttr);
      if (!isNaN(min) && value < min) value = min;
    }
    el.value = formatNum(value);
  });
}

function commitInput_(container, el, onChange) {
  const path = el.getAttribute('data-path');
  if (!path) return;
  let value;
  if (el.type === 'checkbox') value = el.checked;
  else if (el.dataset && el.dataset.numeric === 'true') {
    const parsed = parseNum(el.value);
    value = isNaN(parsed) ? 0 : parsed;
    const minAttr = el.getAttribute('data-min');
    if (minAttr !== null && minAttr !== '') {
      const min = parseFloat(minAttr);
      if (!isNaN(min) && value < min) value = min;
    }
  }
  else value = el.value;
  setPath(appState, path, value);
  saveState();
  // 月⇄年など「もう一方の単位換算」表示を持つ項目があればライブ更新する
  if (el.dataset && el.dataset.numeric === 'true') {
    container.querySelectorAll(`[data-dual-source="${path}"]`).forEach(d => {
      const factor = parseFloat(d.getAttribute('data-dual-factor'));
      const label = d.getAttribute('data-dual-label') || '';
      d.textContent = label + yen(value * factor);
    });
  }
  if (onChange) onChange();
}

// opts.dual: { label, factor } を渡すと、月⇄年など「もう一方の単位換算」を
// ライブ更新のヒント表示として追加する（例: 円/月の入力に対し年換算を表示、factor=12）。
// 数値入力欄は文章入力欄（会社名等）と違って長い文字列を入れないため、既定で幅を狭くする
// （.field-numericクラス、CSS側でmax-widthを指定）。opts.wideで従来幅に戻せる。
function fieldNumber(label, path, value, opts) {
  opts = opts || {};
  const suffix = opts.suffix || '';
  const hint = opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : '';
  // このアプリの数値入力（件数・金額・料率など）はすべて0以上。
  // opts.min に明示的にnullを渡した場合のみ下限なしにできる。
  const min = opts.min === null ? null : (opts.min !== undefined ? opts.min : 0);
  const dual = opts.dual ? `<div class="hint" data-dual-source="${path}" data-dual-factor="${opts.dual.factor}" data-dual-label="${esc(opts.dual.label)}">${esc(opts.dual.label)}${yen((Number(value) || 0) * opts.dual.factor)}</div>` : '';
  return `
    <div class="field${opts.wide ? '' : ' field-numeric'}">
      <label>${esc(label)}</label>
      <div class="suffix-input">
        <input type="text" inputmode="decimal" data-numeric="true" data-path="${path}" value="${esc(formatNum(value))}" style="text-align:right" ${min !== null ? `data-min="${min}"` : ''} autocomplete="off">
        ${suffix ? `<span>${esc(suffix)}</span>` : ''}
      </div>
      ${hint}
      ${dual}
    </div>`;
}

// 他のステップで既に入力済みの値を、ここでは編集不要な参照値として青字で表示する。
// （例：CPCはターゲットエリアで入力済みなので、広告宣伝費では再入力させずここで表示する）
function fieldLinkedValue(label, formattedValue, opts) {
  opts = opts || {};
  return `
    <div class="field">
      <label>${esc(label)}</label>
      <div class="suffix-input"><span class="linked-value" style="padding:9px 0">${esc(formattedValue)}</span>${opts.suffix ? `<span>${esc(opts.suffix)}</span>` : ''}</div>
      ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}
    </div>`;
}

// opts.narrow: trueで入力欄の幅を狭くする（短い名称のみを入れる項目向け）。
function fieldText(label, path, value, opts) {
  opts = opts || {};
  return `
    <div class="field${opts.narrow ? ' field-narrow' : ''}">
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
      <td>${manFloor(detail.fees[t])}</td>
      <td>${pct(detail.compRatio[t], 1)}</td>
      <td>${manFloor(detail.weightedFee[t])}</td>
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
      <tfoot><tr><td colspan="5">手数料/件（加重平均）</td><td>${manFloor(detail.feePerDealMan)}</td></tr></tfoot>
    </table>
    </div>`;
}
