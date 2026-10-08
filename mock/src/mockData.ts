import type { Draft, DraftState } from "./lib/draft";

// Mock event content. Photos are generated stand-ins for what the camera would capture.
const TALKS = [
  {
    photo: "/assets/photos/lt1-ci.jpg",
    text: "CIを5分速くしたLT。キャッシュと並列化の実践がテーマで、待ち時間を削る工夫を紹介。設定の見直しから試せそうで、手元のCIにも取り入れたい。",
  },
  {
    photo: "/assets/photos/lt2-api-types.jpg",
    text: "型で守るAPI設計のLT。スキーマから始めるTypeScriptがテーマで、型でクライアントとサーバーのずれを防ぐ考え方が参考になる。",
  },
  {
    photo: "/assets/photos/lt3-rust-cli.jpg",
    text: "RustでCLIツールを作るLT。clapで引数処理を書き、cargo-distで配布まで自動化する流れを紹介。小さく作って早く配る実践例として参考になる。",
  },
  {
    photo: "/assets/photos/lt4-local-llm.jpg",
    text: "ローカルLLMで議事録をつくるLT。会議メモを手元で要約するというテーマで、情報を外に出さずに議事録を整える使い方が気になる。",
  },
];

function talkFor(index: number) {
  return TALKS[(index - 1) % TALKS.length];
}

export function photoForIndex(index: number) {
  return talkFor(index).photo;
}

export function generatedTextForIndex(index: number) {
  return talkFor(index).text;
}

function savedDraft(index: number, tags: string[], openedInX: boolean): Draft {
  return {
    id: `d${index}`,
    index,
    tags,
    body: generatedTextForIndex(index),
    bodySource: "ai",
    media: { kind: "photo", src: photoForIndex(index), saveStatus: "saved" },
    includeDeveloper: false,
    generation: "done",
    openedInX,
  };
}

// The hero state: the 3rd talk of the evening, recorded and summarized.
export const initialDraftState: DraftState = {
  history: [savedDraft(1, ["#TechLTNight"], true), savedDraft(2, ["#TechLTNight"], false)],
  current: savedDraft(3, ["#TechLTNight", "#Rust"], false),
  nextId: 4,
};
