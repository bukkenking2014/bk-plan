/*
 * charts.js
 * 依存ライブラリなしのインラインSVGチャート生成。
 * dataviz スキルの指針に沿った実装：
 *   - 1軸のみ（2軸チャートは作らない）
 *   - カテゴリカル色は検証済みデフォルト配色のスロット1(blue)/スロット2(orange)を固定順で使用
 *   - 線2px、棒は角丸4px・接地面は直角、marker半径4px+サーフェスリング
 *   - 目盛線は1段階だけ地色から離した細いグレー（recessive）
 *   - 系列2本以上は凡例を必ず表示
 */

const CHART_COLORS = {
  series1: 'var(--chart-series-1)', // 売上高／1年目
  series2: 'var(--chart-series-2)', // 営業損益／2年目
  grid: 'var(--color-line)',
  text: 'var(--color-ink-soft)',
  textStrong: 'var(--color-ink)',
  surface: 'var(--color-surface)'
};

function niceTicks(min, max, count) {
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;
  const rawStep = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.001; v += step) ticks.push(Math.round(v));
  return { ticks, min: niceMin, max: niceMax };
}

function fmtAxisYen(v) {
  const sign = v < 0 ? '△' : '';
  const abs = Math.abs(v);
  let body;
  if (abs >= 100000000) body = (abs / 100000000).toFixed(1).replace(/\.0$/, '') + '億';
  else if (abs >= 10000) body = Math.round(abs / 10000).toLocaleString('ja-JP') + '万';
  else body = abs.toLocaleString('ja-JP');
  return sign + body;
}

/*
 * 月次推移ラインチャート（売上高・営業損益）
 * months: ['1ヵ月',...] (24個)  series: [{label, color, values:number[24]}]
 */
function renderLineChart(months, series, opts) {
  opts = opts || {};
  const W = 900, H = 320;
  const padL = 56, padR = 20, padT = 20, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const allValues = series.flatMap(s => s.values);
  const dataMin = Math.min(0, ...allValues);
  const dataMax = Math.max(0, ...allValues);
  const { ticks, min, max } = niceTicks(dataMin, dataMax, 5);

  const xStep = plotW / (months.length - 1);
  const x = i => padL + i * xStep;
  const y = v => padT + plotH - ((v - min) / (max - min)) * plotH;
  const yZero = y(0);

  const gridLines = ticks.map(t => `
    <line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="${CHART_COLORS.grid}" stroke-width="1" />
    <text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${CHART_COLORS.text}" font-variant-numeric="tabular-nums">${fmtAxisYen(t)}</text>
  `).join('');

  // ゼロ基準線はやや強調
  const zeroLine = min < 0 ? `<line x1="${padL}" y1="${yZero}" x2="${W - padR}" y2="${yZero}" stroke="${CHART_COLORS.text}" stroke-width="1" opacity="0.5" />` : '';

  const xTickIdx = months.map((_, i) => i).filter(i => i % 3 === 0 || i === months.length - 1);
  const xLabels = xTickIdx.map(i => `<text x="${x(i)}" y="${H - padB + 18}" text-anchor="middle" font-size="11" fill="${CHART_COLORS.text}">${esc(months[i].replace('ヵ月', ''))}</text>`).join('');

  const seriesPaths = series.map(s => {
    const points = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const lastIdx = s.values.length - 1;
    const endLabel = `<text x="${x(lastIdx) + 6}" y="${y(s.values[lastIdx])}" font-size="11" font-weight="700" fill="${s.color}" dominant-baseline="middle">${esc(s.label)}</text>`;
    const dots = s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${s.color}" stroke="${CHART_COLORS.surface}" stroke-width="2"><title>${esc(months[i])} ${esc(s.label)}: ${yenAcctText(v)}</title></circle>`).join('');
    return `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />${dots}${opts.endLabels !== false ? endLabel : ''}`;
  }).join('');

  const legend = series.length >= 2 ? `
    <div class="chart-legend">
      ${series.map(s => `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('')}
    </div>` : '';

  return `
    <div class="chart-block">
      ${opts.title ? `<h4 class="chart-title">${esc(opts.title)}</h4>` : ''}
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="${esc(opts.title || '')}">
        ${gridLines}
        ${zeroLine}
        ${seriesPaths}
        ${xLabels}
      </svg>
      ${legend}
    </div>`;
}

/*
 * 黒字化タイミング棒グラフ（月次24ヶ月：売上高／販売管理費／営業損益を色分けした棒グラフ）
 * 事業計画書の冒頭で「いつ黒字化するか」が一目でわかるようにするための専用チャート。
 * months: 24個のラベル  revenue/sga/profit: number[24]（円）
 */
// cumulativeProfit: 営業損益を月次で積み上げた累計額（number[24]）。
// 累計がプラスに転じた最初の月が「黒字化のタイミング」＝事業全体としての損益分岐点。
function renderBreakEvenBarChart(months, cumulativeProfit, opts) {
  opts = opts || {};
  const W = 1360, H = 340;
  const padL = 64, padR = 20, padT = 30, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const { ticks, min, max } = niceTicks(Math.min(0, ...cumulativeProfit), Math.max(0, ...cumulativeProfit), 5);
  const y = v => padT + plotH - ((v - min) / (max - min)) * plotH;
  const yZero = y(0);

  const n = months.length;
  const groupW = plotW / n;
  const barGap = 3;
  const barW = Math.max(4, groupW - barGap);

  const posColor = 'var(--color-ok)';
  const negColor = 'var(--color-warn)';

  const gridLines = ticks.map(t => `
    <line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="${CHART_COLORS.grid}" stroke-width="1" />
    <text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${CHART_COLORS.text}" font-variant-numeric="tabular-nums">${fmtAxisYen(t)}</text>
  `).join('');

  // タップ／クリックした棒のすぐ近くに金額を吹き出しでパッと表示する（<title>による
  // ホバー表示はタッチ端末では出ないことが多いため、クリックイベントで確実に表示する）。
  const bars = months.map((mo, i) => {
    const v = cumulativeProfit[i];
    const barX = padL + i * groupW + (groupW - barW) / 2;
    const barY = v >= 0 ? y(v) : yZero;
    const barH = Math.max(0.5, Math.abs(y(v) - yZero));
    const color = v >= 0 ? posColor : negColor;
    return `<rect class="be-bar" x="${barX}" y="${barY}" width="${barW}" height="${barH}" fill="${color}" style="cursor:pointer" onclick="showBreakEvenBarValue(this, '${esc(mo)}', '${yenAcctText(v).replace(/'/g, "\\'")}')"><title>${esc(mo)} 営業損益累計: ${yenAcctText(v)}</title></rect>`;
  }).join('');

  const xTickIdx = months.map((_, i) => i).filter(i => i % 3 === 0 || i === n - 1);
  const xLabels = xTickIdx.map(i => `<text x="${padL + i * groupW + groupW / 2}" y="${H - padB + 18}" text-anchor="middle" font-size="11" fill="${CHART_COLORS.text}">${esc(months[i])}</text>`).join('');

  // 黒字化（営業損益の累計が初めてプラスに転じる）月にマーカーを付ける
  const breakEvenIdx = cumulativeProfit.findIndex(v => v > 0);
  const breakEvenMarker = breakEvenIdx >= 0 ? `
    <line x1="${padL + breakEvenIdx * groupW + groupW / 2}" y1="${padT}" x2="${padL + breakEvenIdx * groupW + groupW / 2}" y2="${H - padB}" stroke="var(--color-gold-strong)" stroke-width="1.5" stroke-dasharray="4,3" />
    <text x="${padL + breakEvenIdx * groupW + groupW / 2}" y="${padT - 10}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--color-gold-strong)">黒字化：${esc(months[breakEvenIdx])}</text>` : '';

  const zeroLine = `<line x1="${padL}" y1="${yZero}" x2="${W - padR}" y2="${yZero}" stroke="${CHART_COLORS.textStrong}" stroke-width="1.2" />`;

  const legend = `
    <div class="chart-legend">
      <span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${posColor}"></span>営業損益累計（黒字）</span>
      <span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${negColor}"></span>営業損益累計（赤字）</span>
    </div>`;

  return `
    <div class="chart-block">
      ${opts.title ? `<h4 class="chart-title">${esc(opts.title)}</h4>` : ''}
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="${esc(opts.title || '')}">
        ${gridLines}
        ${bars}
        ${zeroLine}
        ${breakEvenMarker}
        ${xLabels}
      </svg>
      ${legend}
      <div id="breakEvenBarValue" class="chart-tap-value">棒をタップ／クリックすると、その月の金額が表示されます</div>
    </div>`;
}

// 黒字化棒グラフの棒がタップ／クリックされた時に、その棒のすぐ上に金額の吹き出しを
// パッと表示する（グラフ下の表示欄にも同じ内容を出し、読み上げ等でも分かるようにする）。
function showBreakEvenBarValue(rectEl, month, valueText) {
  const svg = rectEl.closest('svg');
  if (svg) {
    const x = parseFloat(rectEl.getAttribute('x')) + parseFloat(rectEl.getAttribute('width')) / 2;
    const topY = parseFloat(rectEl.getAttribute('y'));
    const vb = svg.viewBox.baseVal;
    let tip = svg.querySelector('#beb-tooltip-group');
    if (!tip) {
      tip = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      tip.setAttribute('id', 'beb-tooltip-group');
      svg.appendChild(tip); // 最後に追加＝他の棒より手前に描画される
    }
    const label = `${month}：${valueText}`;
    const boxW = Math.max(80, label.length * 8 + 20);
    const boxH = 28;
    let boxX = x - boxW / 2;
    boxX = Math.max(2, Math.min(boxX, vb.width - boxW - 2));
    const boxY = Math.max(2, topY - boxH - 10);
    tip.innerHTML = `
      <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="6" fill="#1a1a1a" stroke="#fff" stroke-width="1"></rect>
      <text x="${boxX + boxW / 2}" y="${boxY + boxH / 2 + 4}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">${esc(label)}</text>`;
  }
  const el = document.getElementById('breakEvenBarValue');
  if (el) el.innerHTML = `<strong>${esc(month)}</strong>　営業損益累計：<strong>${esc(valueText)}</strong>`;
}

/*
 * 年比較の棒グラフ（グループ化）
 * categories: ['売上高','販売管理費','営業損益']  series: [{label,color,values:number[categories.length]}]
 */
function renderGroupedBarChart(categories, series, opts) {
  opts = opts || {};
  const W = 700, H = 300;
  const padL = 64, padR = 20, padT = 20, padB = 36;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const allValues = series.flatMap(s => s.values);
  const dataMin = Math.min(0, ...allValues);
  const dataMax = Math.max(0, ...allValues);
  const { ticks, min, max } = niceTicks(dataMin, dataMax, 5);
  const y = v => padT + plotH - ((v - min) / (max - min)) * plotH;
  const yZero = y(0);

  const groupW = plotW / categories.length;
  const barGap = 2;
  const barW = Math.min(24, (groupW - barGap * (series.length + 1)) / series.length);
  const groupInnerW = barW * series.length + barGap * (series.length - 1);

  const gridLines = ticks.map(t => `
    <line x1="${padL}" y1="${y(t)}" x2="${W - padR}" y2="${y(t)}" stroke="${CHART_COLORS.grid}" stroke-width="1" />
    <text x="${padL - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${CHART_COLORS.text}" font-variant-numeric="tabular-nums">${fmtAxisYen(t)}</text>
  `).join('');

  const bars = categories.map((cat, ci) => {
    const groupX = padL + ci * groupW + (groupW - groupInnerW) / 2;
    const catBars = series.map((s, si) => {
      const v = s.values[ci];
      const barX = groupX + si * (barW + barGap);
      const barY = v >= 0 ? y(v) : yZero;
      const barH = Math.abs(y(v) - yZero);
      const r = Math.min(4, barW / 2);
      return `<path d="M${barX},${barY + (v >= 0 ? r : 0)}
        ${v >= 0 ? `a${r},${r} 0 0 1 ${r},${-r}` : ''}
        L${barX + barW - (v >= 0 ? r : 0)},${v >= 0 ? barY : barY}
        ${v >= 0 ? `a${r},${r} 0 0 1 ${r},${r}` : ''}
        L${barX + barW},${barY + barH}
        L${barX},${barY + barH} Z"
        fill="${s.color}"><title>${esc(cat)} ${esc(s.label)}: ${yenAcctText(v)}</title></path>
        <text x="${barX + barW / 2}" y="${v >= 0 ? barY - 6 : barY + barH + 14}" text-anchor="middle" font-size="10" fill="${CHART_COLORS.textStrong}" font-variant-numeric="tabular-nums">${fmtAxisYen(v)}</text>`;
    }).join('');
    const label = `<text x="${groupX + groupInnerW / 2}" y="${H - padB + 18}" text-anchor="middle" font-size="11" fill="${CHART_COLORS.text}">${esc(cat)}</text>`;
    return catBars + label;
  }).join('');

  const zeroLine = `<line x1="${padL}" y1="${yZero}" x2="${W - padR}" y2="${yZero}" stroke="${CHART_COLORS.text}" stroke-width="1" opacity="0.5" />`;

  const legend = `
    <div class="chart-legend">
      ${series.map(s => `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('')}
    </div>`;

  return `
    <div class="chart-block">
      ${opts.title ? `<h4 class="chart-title">${esc(opts.title)}</h4>` : ''}
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="${esc(opts.title || '')}">
        ${gridLines}
        ${bars}
        ${zeroLine}
      </svg>
      ${legend}
    </div>`;
}

/*
 * 全体フロー ガントチャート（4本のスイムレーン＋吹き出し状チップ＋研修①〜⑨の番号バッジ）。
 * 元Excel「全体フロー」シートの見た目（帯＋吹き出し＋番号丸）を再現する。
 * lanes: [{key,label}]  items: [{lane,day,label,sub,no}]  totalDay: 全体の相対日数（120）
 */
const LANE_COLORS = ['var(--lane-1)', 'var(--lane-2)', 'var(--lane-3)', 'var(--lane-4)'];

function wrapLabel(text, maxChars) {
  // 全角想定の簡易折り返し（記号／・で優先的に区切る）
  if (text.length <= maxChars) return [text];
  const breakPoints = ['／', '・', ' '];
  for (const bp of breakPoints) {
    const idx = text.indexOf(bp);
    if (idx > 0 && idx < text.length - 1) {
      return [text.slice(0, idx), text.slice(idx + 1)];
    }
  }
  return [text.slice(0, maxChars), text.slice(maxChars)];
}

function renderGanttDiagram(lanes, items, totalDay, opts) {
  opts = opts || {};
  const chipW = 108, chipH = 40, minGap = 118;
  const laneBarH = 26;
  const laneBlockH = 96; // チップ帯＋バーの高さ
  const padL = 118, padR = 30, padT = 34, padB = 34;
  const maxItemsPerLane = Math.max(...lanes.map(l => items.filter(it => it.lane === l.key).length));
  const plotW = Math.max(1200, maxItemsPerLane * (minGap + 10));
  const H = padT + laneBlockH * lanes.length + padB;
  const W = padL + plotW + padR;

  const dayToX = d => padL + (d / totalDay) * plotW;

  // レーンごとにチップの重なりを避けて配置（順序を保ったまま最低間隔を確保しつつ、
  // プロット幅からはみ出さないよう前方パス→後方パスの2段階で補正する）
  function layout(laneItems) {
    const sorted = [...laneItems].sort((a, b) => a.day - b.day);
    const n = sorted.length;
    if (n === 0) return [];
    const xs = sorted.map(it => dayToX(it.day));
    for (let i = 1; i < n; i++) xs[i] = Math.max(xs[i], xs[i - 1] + minGap);
    const maxX = padL + plotW;
    if (xs[n - 1] > maxX) {
      xs[n - 1] = maxX;
      for (let i = n - 2; i >= 0; i--) xs[i] = Math.min(xs[i], xs[i + 1] - minGap);
    }
    return sorted.map((it, i) => ({ ...it, x: xs[i] }));
  }

  const laneBlocks = lanes.map((lane, li) => {
    const color = LANE_COLORS[li % LANE_COLORS.length];
    const laneTop = padT + li * laneBlockH;
    const barY = laneTop + laneBlockH - laneBarH - 4;
    const laneItems = layout(items.filter(it => it.lane === lane.key));

    const bar = `<rect x="${padL - 8}" y="${barY}" width="${plotW + 16}" height="${laneBarH}" rx="${laneBarH / 2}" fill="${color}" opacity="0.9" />`;
    const laneLabel = `
      <rect x="4" y="${barY}" width="${padL - 20}" height="${laneBarH}" rx="6" fill="${color}" />
      <text x="${4 + (padL - 20) / 2}" y="${barY + laneBarH / 2 + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">${esc(lane.label)}</text>`;

    const chips = laneItems.map(it => {
      const chipX = it.x - chipW / 2;
      const chipY = barY - chipH - 10;
      const lines = wrapLabel(it.label, 8);
      const textLines = lines.map((ln, i) => `<tspan x="${it.x}" dy="${i === 0 ? 0 : 12}">${esc(ln)}</tspan>`).join('');
      const subLine = it.sub ? `<text x="${it.x}" y="${chipY + chipH - 4}" text-anchor="middle" font-size="7.5" fill="${CHART_COLORS.surface}" opacity="0.9">${esc(it.sub.length > 14 ? it.sub.slice(0, 13) + '…' : it.sub)}<title>${esc(it.sub)}</title></text>` : '';
      const badge = it.no ? `
        <circle cx="${it.x}" cy="${chipY - 12}" r="11" fill="var(--color-warn)" stroke="${CHART_COLORS.surface}" stroke-width="2" />
        <text x="${it.x}" y="${chipY - 8}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${it.no}</text>` : '';
      const fill = it.no ? color : CHART_COLORS.surface;
      const textFill = it.no ? '#fff' : CHART_COLORS.textStrong;
      // 研修番号（①〜⑨）付きのチップはタップ／クリックで詳細を表示できるようにする
      const clickAttrs = it.no ? ` class="gantt-chip-clickable" tabindex="0" role="button" aria-label="研修${it.no}番の詳細を見る" onclick="if(typeof showGanttDetail==='function'){showGanttDetail(${it.no})}" onkeypress="if(event.key==='Enter'&&typeof showGanttDetail==='function'){showGanttDetail(${it.no})}"` : '';
      return `
        <g${clickAttrs}>
          <line x1="${it.x}" y1="${chipY + chipH}" x2="${it.x}" y2="${barY + laneBarH / 2}" stroke="${color}" stroke-width="1.5" opacity="0.6" />
          <rect x="${chipX}" y="${chipY}" width="${chipW}" height="${chipH}" rx="7" fill="${fill}" stroke="${color}" stroke-width="1.2" />
          <text x="${it.x}" y="${chipY + (it.sub ? 15 : 22)}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${textFill}">${textLines}<title>${esc(it.label)}${it.sub ? '　' + esc(it.sub) : ''}</title></text>
          ${subLine}
          ${badge}
        </g>`;
    }).join('');

    return bar + laneLabel + chips;
  }).join('');

  // 軸目盛（加盟／1ヶ月/2ヶ月/3ヶ月/4ヶ月/オープン）
  const bands = [0, 24, 48, 72, 96, 120];
  const bandLabels = ['加盟', '1ヶ月', '2ヶ月', '3ヶ月', '4ヶ月', 'オープン'];
  const axisY = padT + laneBlockH * lanes.length + 14;
  const gridAndTicks = bands.map((d, i) => `
    <line x1="${dayToX(d)}" y1="${padT - 10}" x2="${dayToX(d)}" y2="${axisY - 10}" stroke="${CHART_COLORS.grid}" stroke-width="1" stroke-dasharray="3,3" />
    <text x="${dayToX(d)}" y="${axisY}" text-anchor="${i === 0 ? 'start' : i === bands.length - 1 ? 'end' : 'middle'}" font-size="12" font-weight="700" fill="${CHART_COLORS.textStrong}">${esc(bandLabels[i])}</text>
  `).join('');

  // オープン地点の旗マーカー
  const flagX = dayToX(120);
  const flag = `
    <g>
      <line x1="${flagX}" y1="${padT - 10}" x2="${flagX}" y2="${padT + laneBlockH * lanes.length - laneBarH - 4}" stroke="var(--color-warn)" stroke-width="1.5" stroke-dasharray="2,3" />
      <path d="M${flagX},${padT - 26} v22 l16,-6 l-16,-8 Z" fill="var(--color-warn)" />
      <text x="${flagX + 4}" y="${padT - 30}" font-size="11" font-weight="700" fill="var(--color-warn)">オープン</text>
    </g>`;

  return `
    <div class="chart-block gantt-diagram">
      ${opts.title ? `<h4 class="chart-title">${esc(opts.title)}</h4>` : ''}
      <div class="table-scroll">
        <svg viewBox="0 0 ${W} ${H}" class="chart-svg gantt-svg" style="min-width:${W}px" role="img" aria-label="${esc(opts.title || '')}">
          ${gridAndTicks}
          ${laneBlocks}
          ${flag}
        </svg>
      </div>
    </div>`;
}

/*
 * 売上構成比 ドーナツ（円）グラフ
 * labels: string[]  values: number[]（同じ並び）  colorVars: CSS変数名の配列（省略時は既定4色を使用）
 */
const PIE_COLORS = ['var(--chart-series-1)', 'var(--chart-series-2)', 'var(--chart-series-3)', 'var(--chart-series-4)'];

function renderPieChart(labels, values, opts) {
  opts = opts || {};
  const size = 220, cx = size / 2, cy = size / 2, rOuter = size / 2 - 4, rInner = rOuter * 0.55;
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);

  if (total <= 0) {
    return `
      <div class="chart-block pie-block">
        ${opts.title ? `<h4 class="chart-title">${esc(opts.title)}</h4>` : ''}
        <p class="text-muted small">データがありません。</p>
      </div>`;
  }

  function polar(angle, r) {
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }

  let startAngle = -Math.PI / 2; // 12時方向から開始
  const slices = [];
  labels.forEach((label, i) => {
    const v = Math.max(0, values[i]);
    if (v <= 0) return;
    const frac = v / total;
    const endAngle = startAngle + frac * Math.PI * 2;
    // 描画用の終点角度だけ、ごくわずか（見た目には分からない角度）延長する。
    // ①区分が単独で100%を占める場合に始点・終点が数学的に一致してSVGのA（円弧）が
    // 描画されない事象、②隣接スライスの継ぎ目にアンチエイリアスの細い隙間が入り
    // 「円が途中で切れて見える」事象、の両方を防ぐための処理（区切り角度自体＝各区分の
    // 比率は変えない。次のスライスの始点には本来のendAngleを使う）。
    const drawEndAngle = endAngle + 0.004;
    const color = PIE_COLORS[i % PIE_COLORS.length];
    const [x1, y1] = polar(startAngle, rOuter);
    const [x2, y2] = polar(drawEndAngle, rOuter);
    const [ix2, iy2] = polar(drawEndAngle, rInner);
    const [ix1, iy1] = polar(startAngle, rInner);
    const largeArc = (drawEndAngle - startAngle) > Math.PI ? 1 : 0;
    const path = `M${x1},${y1} A${rOuter},${rOuter} 0 ${largeArc} 1 ${x2},${y2} L${ix2},${iy2} A${rInner},${rInner} 0 ${largeArc} 0 ${ix1},${iy1} Z`;
    const midAngle = (startAngle + endAngle) / 2;
    const pct = Math.round(frac * 1000) / 10;
    let labelEl = '';
    if (frac >= 0.08) {
      const [lx, ly] = polar(midAngle, (rOuter + rInner) / 2);
      labelEl = `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="#fff">${pct}%</text>`;
    }
    // strokeは背景色ではなく塗りと同色にし、スライス同士の境目に区切り線（白い隙間）が
    // 見えないよう、途切れず繋がった一つの円に見えるようにする
    slices.push(`<path d="${path}" fill="${color}" stroke="${color}" stroke-width="1"><title>${esc(label)}: ${yenAcctText(v)}（${pct}%）</title></path>${labelEl}`);
    startAngle = endAngle;
  });

  const legend = `
    <div class="chart-legend pie-legend">
      ${labels.map((label, i) => {
        const v = Math.max(0, values[i]);
        if (v <= 0) return '';
        const pct = Math.round((v / total) * 1000) / 10;
        return `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>${esc(label)}　${pct}%（${yenAcctText(v)}）</span>`;
      }).join('')}
    </div>`;

  return `
    <div class="chart-block pie-block">
      ${opts.title ? `<h4 class="chart-title">${esc(opts.title)}</h4>` : ''}
      <div class="pie-layout">
        <svg viewBox="0 0 ${size} ${size}" class="pie-svg" role="img" aria-label="${esc(opts.title || '')}">
          ${slices.join('')}
          <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="10" fill="${CHART_COLORS.text}">合計</text>
          <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="13" font-weight="700" fill="${CHART_COLORS.textStrong}">${yenAcctText(total)}</text>
        </svg>
        ${legend}
      </div>
    </div>`;
}
