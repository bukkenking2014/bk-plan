/*
 * main.js
 * アプリのブートストラップ・ビュー切替。
 */

let activeView = 'wizard';

const VIEW_RENDERERS = {
  wizard: renderWizard,
  report: renderReport,
  salary: renderSalaryTool,
  incentive: renderIncentiveTool,
  skill: renderSkillTool
};

function setActiveView(view) {
  activeView = view;
  document.querySelectorAll('#appNav button').forEach(b => b.classList.toggle('active', b.getAttribute('data-view') === view));
  VIEW_RENDERERS[view]();
  window.scrollTo(0, 0);
}

function bootApp() {
  document.querySelectorAll('#appNav button').forEach(btn => {
    btn.addEventListener('click', () => setActiveView(btn.getAttribute('data-view')));
  });
  if (typeof initCloudUI === 'function') initCloudUI();

  const cloudId = typeof getCloudIdFromUrl === 'function' ? getCloudIdFromUrl() : '';
  if (cloudId && typeof loadFromCloud === 'function') {
    const main = document.getElementById('appMain');
    main.innerHTML = '<div class="card"><p class="desc">保存済みデータを読み込んでいます…</p></div>';
    loadFromCloud(cloudId).then(result => {
      if (!result.ok && result.needsSetup) {
        main.innerHTML = `
          <div class="card">
            <h2>クラウド保存データの読み込み</h2>
            <p class="desc">このURLは特定の会社様専用の保存データを指していますが、このブラウザには読み込み先（クラウド保存の設定）が未設定です。ヘッダーの「⚙」から設定してください。</p>
            <button class="btn-gold" id="cloudNeedsSetupBtn" type="button">設定を開く</button>
          </div>`;
        const btn = document.getElementById('cloudNeedsSetupBtn');
        if (btn) btn.onclick = () => openSettingsModal(false);
      } else if (!result.ok) {
        main.innerHTML = `
          <div class="card">
            <h2>クラウド保存データの読み込みに失敗しました</h2>
            <p class="desc">${esc(result.error || '不明なエラー')}</p>
            <p class="small text-muted">URLが正しいか、Apps Scriptが正しくデプロイされているかご確認ください。このまま進むと新規入力として開始します。</p>
            <button class="btn-outline" id="cloudLoadFailContinueBtn" type="button">新規入力として進む</button>
          </div>`;
        const btn = document.getElementById('cloudLoadFailContinueBtn');
        if (btn) btn.onclick = () => setActiveView('wizard');
      } else {
        setActiveView('wizard');
      }
    });
  } else {
    setActiveView('wizard');
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
