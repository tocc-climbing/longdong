import type { AboutTextProps } from './types'

export default function AboutText({ projectUrl, sheetUrl }: AboutTextProps) {
  return (
    <>
      <p className="alert">
        本サイトの情報は参考用です。岩や支点の状態はいつでも変わる可能性があります。登る前に必ず現地で確認し、自己責任で登ってください。
      </p>

      <h2>オフライン利用</h2>
      <p>
        初回の表示後、アプリと全ルートのデータが端末に保存され、電波の届かない龍洞でも閲覧できます。iPhone
        でオフラインデータが削除されないよう、ブラウザの「ホーム画面に追加」でインストールしてください。
      </p>

      <h2>アカウントとプライバシー</h2>
      <p>
        Google
        アカウントでログインします。お気に入りと登攀記録は本人のみ閲覧できます。コメントはニックネームとともに公開され、評価は平均と件数のみ表示されます。メールアドレスは公開されません。データは台湾アウトドアクライミング協会（TOCC）の
        Firebase プロジェクトに保存されます。不適切なコメントは「報告」から管理者に知らせてください。
        <a href="./terms.html">利用規約</a>と<a href="./privacy.html">プライバシーポリシー</a>
        （中国語・英語）もご覧ください。アカウントとすべてのデータを削除するには、「マイページ」の設定を開いてください。
      </p>

      <h2>データの出典</h2>
      <p>
        ルートとボルトのデータは
        <a href={projectUrl} target="_blank" rel="noreferrer">
          TOCC リボルトプロジェクト
        </a>
        が
        <a href={sheetUrl} target="_blank" rel="noreferrer">
          Google Sheet
        </a>
        で管理しており、本サイトは毎日更新を確認し、確認後に公開しています。誤りを見つけた場合は TOCC
        までご連絡ください。ルートの説明と備考は中国語のみです。
      </p>
    </>
  )
}
