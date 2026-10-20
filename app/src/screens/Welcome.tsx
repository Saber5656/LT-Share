import { useApp } from "../app/context.ts";
import { Footer } from "../components/chrome.tsx";
import { markWelcomeSeen } from "../lib/welcome.ts";

// First-run notice (NFR-05, C-02..C-05). Shown once and reopenable from the saved-drafts screen.
export function Welcome() {
  const { nav } = useApp();
  // The first entry of a visit is the first run; a reopened notice was pushed on top of another screen.
  const firstRun = nav.entry.depth === 0;

  const done = () => {
    if (firstRun) {
      markWelcomeSeen();
      nav.replace({ view: "composer" });
    } else {
      nav.back();
    }
  };

  return (
    <>
      <main className="screen welcome">
        <h1 className="welcome-title">LT Share</h1>
        <p className="welcome-lead">LTを聞きながら、記録からXへの共有までを少ない操作で。</p>
        <ol className="welcome-steps">
          <li>
            <span className="step-number">1</span>
            イベントのハッシュタグを設定
          </li>
          <li>
            <span className="step-number">2</span>
            サーバーで投稿文を作成、または手入力して確認
          </li>
          <li>
            <span className="step-number">3</span>
            Xで確認して、あなたが投稿
          </li>
        </ol>
        <section className="welcome-notes" aria-label="データの扱い">
          <h2>データの扱い</h2>
          <ul>
            <li>写真・動画と投稿案は、この端末（ブラウザ）に保存します。ブラウザのデータを消すと失われます。</li>
            <li>写真アプリにも残す場合は「端末に保存」を使えます。写真アプリへの自動追加は行いません。保存確認なしで次の投稿へ進めます。</li>
            <li>投稿はXの画面で、あなた自身が行います。「ポスト確認」からXを開き、投稿文を確認してください。</li>
            <li>自動要約は最初からONです（記録欄でOFFにできます）。要約時は縮小した写真（動画は複数時点の静止画）をCloudflareへ送信します。モデルのダウンロードや準備は不要です。サーバーを利用できないときも手入力で続けられます。</li>
          </ul>
        </section>
      </main>
      <Footer>
        <button type="button" className="primary-button" onClick={done}>
          {firstRun ? "はじめる" : "閉じる"}
        </button>
      </Footer>
    </>
  );
}
