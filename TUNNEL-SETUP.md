# Skill Bridge 専用 Secure MCP Tunnel

CoSと同じ公式 tunnel-client を利用し、独立した Tunnel ID、独立した設定フォルダ、独立したプロセスで動かす。
既存CoSの接続は一切変更しない。

## 現状

- ローカル Skill Bridge MCP: http://127.0.0.1:8787/mcp
- CoS内蔵バイナリ: %LOCALAPPDATA%\Programs\Chat On Steroids\resources\tunnel\tunnel-client.exe
- このリポジトリのスクリプト: scripts\skill-bridge-tunnel.ps1
- 実行時のプロファイル / 認証情報: %LOCALAPPDATA%\SkillBridgeTunnel （リポジトリ外）
- Tunnel IDと実行用APIキーは各利用者が自分のPlatformアカウントで発行してください。
- WindowsからVPSへ移す場合は docs/VPS.md を参照。両方で同じIDを同時起動しないこと。

### 現在の環境から最短で接続する

エクスプローラーから connect-skill-bridge.cmd をダブルクリック。
PowerShellの非表示入力プロンプトに、新しく発行した実行用キーを貼り付けてEnter。
成功すればdoctor → start → statusを続けて実行する。
**キーはチャットに送らないこと。** エラー表示になったらキーは共有せず、エラー文だけ共有する。

## OpenAI Platform側の準備

1. https://platform.openai.com/settings/organization/tunnels で **Skill Bridge専用** のトンネルを作成。既存CoSのIDを使わない。
2. 利用するChatGPTワークスペースとPlatform組織を関連付ける。必要権限はトンネル作成にTunnels Read + Manage、実行とChatGPT登録にTunnels Read + Use。
3. https://platform.openai.com/settings/organization/api-keys から実行用キーを用意。可能なら**専用の制限付きキー**でTunnels Read + Useのみを許可。管理用キーは常駐クライアントに渡さない。

## PC側のセットアップ（PowerShell）

次のコマンドで、本リポジトリに秘密情報を保存せずセットアップできる。

    cd <インストールしたskill-bridge-mcpのフォルダ>
    .\scripts\skill-bridge-tunnel.ps1 setup -TunnelId tunnel_<新規ID>

プロンプトが開いたら、実行用APIキーを入力する。Windows DPAPIで現在のユーザー専用に暗号化して保存するため、コマンド引数・スクリプト・ログに平文キーを残さない。
入力を中断した場合は、セットアップを再実行せず次のコマンドから鍵を登録できる。

    .\scripts\skill-bridge-tunnel.ps1 set-key

    .\scripts\skill-bridge-tunnel.ps1 doctor
    .\scripts\skill-bridge-tunnel.ps1 start
    .\scripts\skill-bridge-tunnel.ps1 status

安定動作を確認したあと、任意でWindowsログイン時の自動起動を設定する。

    .\scripts\skill-bridge-tunnel.ps1 register-startup

自動起動だけ解除する場合:

    .\scripts\skill-bridge-tunnel.ps1 unregister-startup

専用トンネルだけ停止する場合:

    .\scripts\skill-bridge-tunnel.ps1 stop

**CoSのトンネルプロセスは一切停止しない。**

## ChatGPT側で接続

Web版ChatGPT → Plugins → Add custom MCP server → Connection: Tunnel → 上記の専用Tunnel IDを選択。
SKILL.md取得のみのローカルMCPなので、適切な個人用設定ではMCP側認証なしでも構成可能。ただしトンネルに対する組織・ワークスペース認可とクライアント鍵の保護は必須。

テストする:

> Skill Bridge の list_skills を実行し、利用できるスキルを一覧表示して

> research-brief を load_skill で読み込み、その内容に沿って簡単な調査を進めて

「doctor/ready」が成功していても、実際にChatGPTからツール呼出しが成功するまで接続完了とは扱わない。

## セキュリティ

- MCPは127.0.0.1で待受。パブリックなポート開放・Tailscale Funnel公開はしない。
- CoSの既存Tunnel ID・設定・認証情報を複製/共有しない。
- キーはWindows DPAPI暗号化のローカルファイルで保持。別PCへ持ち出しても復号できない。
- スキル保管庫に秘密情報を置かない。接続したChatGPTはスキル本文を取得できる。
- MCPはファイルの取得のみ。スキルのscriptsを実行しない。
- OpenAI Platformの鍵とTunnelの利用条件はPlus契約とは別。接続のためだけにLLM推論APIを呼ぶ構成ではないが、サービス提供条件はPlatform側で確認する。

公式ドキュメント:

- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://github.com/openai/tunnel-client/blob/master/docs/end-user-guide.md
