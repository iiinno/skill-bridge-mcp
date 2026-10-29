// Read an explicitly selected Markdown file from GitHub. No repository cloning,
// arbitrary URLs, public web proxying or script execution.
const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}$/;
const PART = /^[A-Za-z0-9._-]+$/;
const LIMIT = 65536;

export async function readGithubMarkdown({ owner, repo, file_path, ref = "HEAD" },
  { token = "", fetcher = fetch } = {}) {
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === ".." ||
      typeof file_path !== "string" || file_path.length > 240 ||
      typeof ref !== "string" || ref.length < 1 || ref.length > 128 ||
      !/^[A-Za-z0-9._/-]+$/.test(ref)) throw new Error("Invalid GitHub file reference");
  const parts = file_path.split("/");
  if (parts.some((p) => !PART.test(p) || p === "." || p === "..") ||
      !/\.md$/i.test(parts.at(-1))) throw new Error("Only a specific Markdown file can be fetched");
  const url = "https://api.github.com/repos/" + encodeURIComponent(owner) +
    "/" + encodeURIComponent(repo) + "/contents/" +
    parts.map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(ref);
  const headers = { accept: "application/vnd.github+json",
    "user-agent": "skill-bridge-mcp" };
  if (token) headers.authorization = "Bearer " + token;
  const response = await fetcher(url, { method: "GET", headers,
    signal: AbortSignal.timeout(7000), redirect: "error" });
  if (!response.ok) throw new Error("GitHub Markdown retrieval failed (HTTP " + response.status + ")");
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > LIMIT * 3) throw new Error("GitHub response too large");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > LIMIT * 3) throw new Error("GitHub response too large");
  const data = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (data.type !== "file" || data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error("Not a Markdown file");
  }
  const buffer = Buffer.from(data.content.replace(/\s/g, ""), "base64");
  if (buffer.byteLength > LIMIT) throw new Error("Markdown file exceeds 64 KiB");
  return { source: "github", repo: owner + "/" + repo, path: file_path, ref,
    sha: data.sha, bytes: buffer.byteLength, markdown: buffer.toString("utf8") };
}
