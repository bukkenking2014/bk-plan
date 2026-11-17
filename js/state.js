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
    return buildStateFrom(parsed);
  } catch (e) {
    console.warn('state load failed, using defaults', e);
    return createDefaultState();
  }
}

// 保存済みデータ（raw）から状態を組み立てる：初期値とマージ → 旧バージョンの項目を移行 → 割合の補正
function buildStateFrom(raw) {
  return fixCorruptedPercentFields(migrateLegacyFields(deepMerge(createDefaultState(), raw), raw));
}

// 旧バージョンで保存されたデータを、現在の入力項目へ移す（rawに無い項目だけを対象にする）。
function migrateLegacyFields(state, raw) {
  const rawOc = (raw && raw.otherCosts) || {};
  const rawIc = (raw && raw.initialCost) || {};
  // 物件王会費：旧＝初期費用（一括）→ 現＝店舗経費の月額（事業検討!L46）
  if (rawOc.membership === undefined) {
    state.otherCosts.membership = Math.max(0, Number(rawIc.membershipFee) || 0);
  }
  state.initialCost.membershipFee = 0;
  // 研修費：旧＝PPC・SVコンサルを含む合計310,000円を1項目 → 現＝研修費／PPCコンサル／SVコンサルの3項目
  if (rawOc.training !== undefined && !Number(rawOc.ppcConsulting) && !Number(rawOc.svConsulting) && Number(rawOc.training) === 310000) {
    state.otherCosts.training = 50000;
    state.otherCosts.ppcConsulting = 10000;
    state.otherCosts.svConsulting = 250000;
  }
  return state;
}

// 割合（0〜1）を保存すべき項目一覧。過去バージョンの入力欄バグにより、
// 画面表示用に100倍した値（例：30％→30）がそのまま保存されてしまっている
// ケースがあるため、1を超えている（＝100%を超える割合はあり得ない）場合は
// 誤って100倍のまま保存されたものとみなし、自動的に100で割って補正する。
const PERCENT_FIELD_PATHS = [
  'ad.cvr', 'incentive.rate',
  'synergy.reform.profitRate', 'synergy.reform.allocRate', 'synergy.reform.conversionRate',
  'synergy.selfBuild.profitRate', 'synergy.selfBuild.allocRate', 'synergy.selfBuild.conversionRate',
  'synergy.referral.allocRate', 'synergy.referral.conversionRate'
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

// skipSync=true：読み込み直後などの「人が入力したわけではない」保存。Googleドライブの自動更新を予約しない。
function saveState(skipSync) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (e) {
    console.warn('state save failed', e);
  }
  if (!skipSync) {
    if (typeof scheduleCloudAutoSave === 'function') scheduleCloudAutoSave();
    if (typeof scheduleDriveSync === 'function') scheduleDriveSync();
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
