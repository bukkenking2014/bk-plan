/*
 * schedule.js
 * 元Excel「全体フロー」シートは数式を持たない静的なガントチャート（4本のスイムレーン＋吹き出し状の図形）
 * だったため、暦日付を算出する数式は存在しなかった。カレンダー日付の自動算出は行わず、
 * ①どのレーン（宅建免許／Webサイト／物件情報準備／研修）に属するか、②実施の相対的な順序・目安時期
 * だけを、元シートの図形配置・研修詳細シートの記載順序をもとに再現する。
 * 加盟契約を起点（day 0）とする。
 */

const GANTT_LANES = [
  { key: 'license', label: '宅建免許' },
  { key: 'website', label: 'Webサイト' },
  { key: 'property', label: '物件情報準備' },
  { key: 'training', label: '研修' }
];

// day: 加盟(0)からの相対順序（暦日付には変換しない、位置の目安のみ）
// no: 研修①〜⑨の番号（該当する場合のみ）　sub: 補足の小さい文字
const GANTT_ITEMS = [
  // 宅建免許レーン
  { lane: 'license', day: 2, label: 'スタートアップMTG', sub: '宅建業無しの場合のみ実施', no: 1 },
  { lane: 'license', day: 16, label: '宅建士採用' },
  { lane: 'license', day: 22, label: '事務所設置' },
  { lane: 'license', day: 30, label: '全宅/全日の検討' },
  { lane: 'license', day: 46, label: '免許申請' },
  { lane: 'license', day: 86, label: '保証協会加入' },
  { lane: 'license', day: 119, label: '営業可能' },

  // Webサイトレーン
  { lane: 'website', day: 8, label: 'ロゴ／デザイン準備' },
  { lane: 'website', day: 18, label: 'スケジュール確定MTG', sub: 'Web立上げスケジュール・PPC予算確定', no: 4 },
  { lane: 'website', day: 24, label: 'ロゴ・サイトMTG' },
  { lane: 'website', day: 40, label: '最終Webチェック' },
  { lane: 'website', day: 50, label: 'ツールデザインMTG' },
  { lane: 'website', day: 64, label: 'サイト確認' },
  { lane: 'website', day: 80, label: 'PPC広告目標設定MTG' },
  { lane: 'website', day: 94, label: 'サイト集客・業務管理MTG' },
  { lane: 'website', day: 110, label: 'WebサイトOPEN', sub: '営業可能' },

  // 物件情報準備レーン
  { lane: 'property', day: 40, label: '管理画面利用開始' },
  { lane: 'property', day: 76, label: '管理画面アカウント作成' },
  { lane: 'property', day: 80, label: '物件確認' },
  { lane: 'property', day: 83, label: '物件詳細入力' },
  { lane: 'property', day: 85, label: '物件収集（ソクコレ）' },
  { lane: 'property', day: 87, label: '物件収集（早耳くん）' },
  { lane: 'property', day: 84, label: '物件収集キックオフ' },
  { lane: 'property', day: 86, label: '物件収集MTG①' },
  { lane: 'property', day: 88, label: '物件収集MTG②' },
  { lane: 'property', day: 90, label: '物件収集MTG③' },
  { lane: 'property', day: 92, label: '物件収集MTG④' },
  { lane: 'property', day: 94, label: '顧客管理MTG' },

  // 研修レーン
  { lane: 'training', day: 5, label: 'エリア確定MTG', no: 2 },
  { lane: 'training', day: 14, label: 'オーナー研修', sub: 'ビジネスプラン研修／1泊2日', no: 3 },
  { lane: 'training', day: 26, label: 'PPC予算の確定' },
  { lane: 'training', day: 45, label: '基礎研修', no: 5 },
  { lane: 'training', day: 55, label: '売買契約研修', no: 6 },
  { lane: 'training', day: 65, label: '事務サポート研修', no: 7 },
  { lane: 'training', day: 80, label: '営業研修', sub: '基礎実践研修／4泊5日', no: 8 },
  { lane: 'training', day: 100, label: '随時対応', sub: '基礎実践研修・営業研修・ライフプラン研修' },
  { lane: 'training', day: 116, label: '店舗実地研修', sub: '1日', no: 9 }
];

// 相対的な時期の目安（帯）。元シートの5帯構成（加盟/1ヶ月/2ヶ月/3ヶ月/4ヶ月/オープン）に対応。
function bandLabel(day) {
  if (day <= 0) return '起点';
  if (day <= 24) return '加盟〜1ヶ月';
  if (day <= 48) return '1ヶ月〜2ヶ月';
  if (day <= 72) return '2ヶ月〜3ヶ月';
  if (day <= 96) return '3ヶ月〜4ヶ月';
  return '4ヶ月〜オープン';
}

// 順序（1始まり）・帯ラベルを付与した一覧を返す（表形式表示用）。加盟契約が必ず1番目。
function getScheduleList() {
  const origin = { day: 0, key: 'kameiKeiyaku', label: '加盟契約', note: '全体フローの起点' };
  const rest = GANTT_ITEMS.map(it => ({ key: it.lane + it.label, label: it.label, day: it.day, note: it.sub || '' }));
  const sorted = [origin, ...rest].sort((a, b) => a.day - b.day);
  return sorted.map((m, i) => ({
    ...m,
    order: i + 1,
    band: bandLabel(m.day),
    isOrigin: m.day === 0,
    isMilestone: GANTT_ITEMS.some(it => it.label === m.label && it.no)
  }));
}
