/*
 * state.js
 * アプリ状態の保持・localStorage永続化。
 */

const STORAGE_KEY = 'bkPlanSimulator.state.v1';

let appState = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const parsed = JSON.parse(raw);
    return fixCorruptedPercentFields(deepMerge(createDefaultState(), parsed));
  } catch (e) {
    console.warn('state load failed, using defaults', e);
    return createDefaultState();
  }
}

// 割合（0〜1）を保存すべき項目一覧。過去バージョンの入力欄バグにより、
// 画面表示用に100倍した値（例：30％→30）がそのまま保存されてしまっている
// ケースがあるため、1を超えている（＝100%を超える割合はあり得ない）場合は
// 誤って100倍のまま保存されたものとみなし、自動的に100で割って補正する。
const PERCENT_FIELD_PATHS = [
  'ad.cvr',
  'synergy.reform.profitRate', 'synergy.reform.allocRate', 'synergy.reform.conversionRate',
  'synergy.selfBuild.profitRate', 'synergy.selfBuild.allocRate', 'synergy.selfBuild.conversionRate',
  'synergy.referral.allocRate', 'synergy.referral.conversionRate',
  'incentiveRule.incentiveRate'
];
function fixCorruptedPercentFields(state) {
  PERCENT_FIELD_PATHS.forEach(path => {
    const v = getPath(state, path);
    if (typeof v === 'number' && v > 1) {
      setPath(state, path, v / 100);
    }
  });
  return state;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (e) {
    console.warn('state save failed', e);
  }
}

function resetState() {
  if (!confirm('入力内容をすべて初期値に戻します。よろしいですか？')) return;
  appState = createDefaultState();
  saveState();
  location.reload();
}

function deepMerge(base, override) {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? override : base;
  }
  if (base && typeof base === 'object') {
    const result = { ...base };
    if (override && typeof override === 'object') {
      Object.keys(override).forEach(key => {
        if (key in base) {
          result[key] = deepMerge(base[key], override[key]);
        } else {
          result[key] = override[key];
        }
      });
    }
    return result;
  }
  return override !== undefined ? override : base;
}

// ネストされたパス（例: "otherCosts.consumables"）で値を取得/設定するヘルパー
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}
