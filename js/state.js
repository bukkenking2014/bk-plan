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
    return deepMerge(createDefaultState(), parsed);
  } catch (e) {
    console.warn('state load failed, using defaults', e);
    return createDefaultState();
  }
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
