/*
 * defaults.js
 * 初期状態（デフォルト値）定義。
 * 各値の出所は元Excel「260708_事業計画検討書_雛型」のセル番地をコメントで明記。
 */

function createDefaultState() {
  return {
    meta: {
      // 社名シート C15
      companyName: '○〇○〇株式会社',
      // 全体フローシートの起点になる「オープン予定日」（ユーザー入力・逆算の基準）
      openDate: '',
      createdAt: new Date().toISOString().slice(0, 10)
    },

    // 免許シート D3（有り/無し）＋ D9,D14:D21（費用内訳、都道府県により異なるため編集可）
    license: {
      hasLicense: true,
      items: [
        { key: 'registrationTax', label: '免許申請時登録免許税', amount: 33000, group: 'prefecture' },
        { key: 'associationFee', label: '宅建協会入会金', amount: 800000, group: 'association' },
        { key: 'signboard', label: '宅建協会店頭看板代', amount: 3000, group: 'association' },
        { key: 'associationAnnualFee', label: '宅建協会会費（年額）', amount: 54000, group: 'association' },
        { key: 'guaranteeAssocFee', label: '保証協会入会金', amount: 200000, group: 'association' },
        { key: 'guaranteeDeposit', label: '保証協会弁済業務保証金分担金', amount: 600000, group: 'association' },
        { key: 'guaranteeAnnualFee', label: '保証協会会費（年額）', amount: 6000, group: 'association' },
        { key: 'realEstateCourse', label: '不動産総合コース申込金', amount: 10000, group: 'association' },
        { key: 'politicalLeague', label: '不動産政治連盟', amount: 200000, group: 'association' }
      ]
    },

    // ターゲットエリアシート AV3（CPC）
    cpc: 100,

    // ターゲットエリアシート C6:C11, K6:K11, K17:K20, Q17:Q20 etc（複数エリア対応）
    areas: [
      {
        name: '○○市',
        households: 110000,
        land: { count: 195, priceMan: 1380 },
        usedHouse: { count: 122, priceMan: 2280 },
        newHouse: { count: 57, priceMan: 3068 },
        mansion: { count: 51, priceMan: 1780 }
      }
    ],

    // 目標設定シート B7:B12 / E7:E12（人員体制・給与）
    staff: {
      // 店長（経験者）目標設定!E7
      managers: [{ salary: 300000 }],
      // エージェント 目標設定!E8:E10
      agents: [{ salary: 250000 }],
      // サポート 目標設定!E11:E12
      supports: [{ salary: 200000 }]
    },

    // 目標設定シート B21（2年目以降の年間営業利益目標）
    targetProfitAnnual: 0,

    // 事業検討シート F11（確定契約件数/月、閑散期も均した数値）
    confirmedContractsPerMonth: 3,

    // 事業検討シート D38/K38/U38（対応事業トグル）＋各種入力
    synergy: {
      reform: {
        enabled: true,
        unitPrice: 2000000, // S36
        profitRate: 0.3, // T36
        allocRate: 0.1, // U36（不動産分配利益率）
        conversionRate: 0.8 // Y37（歩留り、中古系ターゲット件数に対する比率）
      },
      selfBuild: {
        enabled: true,
        unitPrice: 25000000, // S37
        profitRate: 0.25, // T37
        allocRate: 0.05, // U37
        conversionRate: 0.2, // Y38（歩留り、土地ターゲット件数に対する比率）
        capSolo: 2, // Y43（営業1名の場合の年間上限件数）
        capTeam: 5 // Z43（営業2名以上の場合の年間上限件数）
      },
      referral: {
        enabled: true,
        unitPrice: 25000000, // S38
        allocRate: 0.03, // U38
        conversionRate: 0.35, // Y39
        capSolo: 3, // Y44
        capTeam: 6 // Z44
      }
    },

    // 事業検討シート【広告宣伝費】G30(CVR)、D26-D29（その他広告費）
    ad: {
      targetLeads: 30, // C25 目標反響数/月（既定値は営業2名×15件相当。編集可能）
      cvr: 0.01, // G30
      other1: 0, // D26
      other2: 0, // D27
      portal: 0, // D28 ポータル
      assessmentSite: 0 // D29 査定サイト
    },

    // 事業検討シート【その他費用】各種年額（円）
    otherCosts: {
      consumables: 500000, // L18 消耗品費/年
      officeSupplies: 500000, // L21 事務用品費/年
      dues: 54000, // L24 諸会費/年
      utilities: 600000, // L28 水道光熱費/年
      lease: 320000, // L31 リース料/年
      misc: 240000, // L37 雑費/年
      // 研修費（成長投資費）: L42研修費+L43 PPCコンサル+L44 SVコンサルの合計を1項目にまとめて入力する
      // （既定値 50,000+10,000+250,000=310,000）。ppcConsulting/svConsultingは後方互換のため残すが常に0固定。
      training: 310000,
      ppcConsulting: 0,
      svConsulting: 0,
      storeRent: 0, // 店舗賃料/月（家賃等発生する場合）
      recruiting: 0, // C43 採用費/年（想定年収×35%目安）
      entertainment: 0, // B44 接待交際費/月
      insurance: 0, // B45 保険料/月
      renovationCostBasis: 0, // 減価償却の基礎になる内装工事費用（L54相当）
      depreciationType: '改装', // C48（改装=15年 / それ以外=20年）
      assumedPpcAnnual: 2400000 // O63 損益分岐点算出用の想定PPC費用/年（仮20万/月）
    },

    // 事業検討シート【店舗組成費（イニシャル）】
    initialCost: {
      franchiseFee: 3500000, // L51 物件王加盟金
      signageCost: 300000, // L55 看板設置費用
      membershipFee: 0 // 会費（協会入会金等）※免許有無に関わらず新規出店時に発生しうる会費。編集可
    },

    // 事業検討シート【インセンティブ（仲手のみ反映）】
    incentiveRule: {
      cutoffFactor: 1.5, // D54 足切り係数
      incentiveRate: 0.2 // D58 インセンティブ率
    },

    // PL（1年目）／PL（2年目以降）シートの営業外・特別損益～当期純損益ブロック
    // （行43:57）。元Excelでは全て空欄（既定値0）の手動入力セルのため、
    // 本アプリでも編集可能な年額入力として用意する（任意項目）。
    plExtras: {
      interestIncome: 0, // 受取利息/年
      miscIncome: 0, // 雑収入/年
      interestExpense: 0, // 支払利息/年
      miscLoss: 0, // 雑損失/年
      extraordinaryItems: 0, // 特別利益・損失/年（マイナス可）
      corporateTax: 0 // 法人税等/年
    },

  };
}
