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
            記録して「端末に保存」。投稿文を入力
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
            <li>端末の写真アプリ（ギャラリー）への保存は、記録のあとに「端末に保存」から行います。ブラウザが自動で保存することはできません。</li>
            <li>投稿はXの画面で、あなた自身が行います。「Xで開く」を押すと、投稿文がXに渡されます。</li>
            <li>LT Share は、独自のサーバーやデータベースを持たない設計です。</li>
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
