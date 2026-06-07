import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

const GH_BASE = "https://api.github.com";

function ghHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const h: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "noelclaw-mcp/3.4.0",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh(path: string): Promise<any> {
  const res = await fetch(`${GH_BASE}${path}`, {
    headers: ghHeaders(),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(`GitHub ${res.status}: ${err.message ?? res.statusText}`);
  }
  return res.json();
}

function text(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export const GITHUB_TOOLS: Tool[] = [
  {
    name: "github_list_repos",
    description:
      "List GitHub repositories for a user or org. Leave username empty to list your own repos (requires GITHUB_TOKEN). " +
      "Returns name, description, language, stars, forks, last updated.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "GitHub username or org. Empty = your own repos (needs GITHUB_TOKEN)." },
        sort:     { type: "string", enum: ["updated", "created", "pushed", "full_name"], description: "Sort field (default: updated)" },
        per_page: { type: "number", description: "Max results (default 20, max 100)" },
      },
    },
  },
  {
    name: "github_list_prs",
    description: "List pull requests for a GitHub repository. Returns PR number, title, author, state, branch, additions/deletions.",
    inputSchema: {
      type: "object",
      properties: {
        owner:    { type: "string", description: "Repo owner (user or org)" },
        repo:     { type: "string", description: "Repository name" },
        state:    { type: "string", enum: ["open", "closed", "all"], description: "PR state (default: open)" },
        per_page: { type: "number", description: "Max results (default 15, max 100)" },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github_get_pr",
    description:
      "Get full details of a pull request — title, body, diff summary, changed files, reviews, and comments. " +
      "Use to understand what a PR does before reviewing or merging.",
    inputSchema: {
      type: "object",
      properties: {
        owner:     { type: "string", description: "Repo owner" },
        repo:      { type: "string", description: "Repository name" },
        pr_number: { type: "number", description: "Pull request number" },
      },
      required: ["owner", "repo", "pr_number"],
    },
  },
  {
    name: "github_list_issues",
    description: "List issues for a GitHub repository. Returns issue number, title, author, labels, comment count.",
    inputSchema: {
      type: "object",
      properties: {
        owner:    { type: "string", description: "Repo owner" },
        repo:     { type: "string", description: "Repository name" },
        state:    { type: "string", enum: ["open", "closed", "all"], description: "Issue state (default: open)" },
        labels:   { type: "string", description: "Comma-separated label names to filter by" },
        per_page: { type: "number", description: "Max results (default 15, max 100)" },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github_get_issue",
    description: "Get a GitHub issue with full body and all comments. Use to understand a bug or feature request in depth.",
    inputSchema: {
      type: "object",
      properties: {
        owner:        { type: "string", description: "Repo owner" },
        repo:         { type: "string", description: "Repository name" },
        issue_number: { type: "number", description: "Issue number" },
      },
      required: ["owner", "repo", "issue_number"],
    },
  },
  {
    name: "github_get_file",
    description: "Read a file from a GitHub repository. Returns decoded content (up to 10k chars). Use for reading code, configs, READMEs.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Repo owner" },
        repo:  { type: "string", description: "Repository name" },
        path:  { type: "string", description: "File path in the repo (e.g. src/index.ts, README.md)" },
        ref:   { type: "string", description: "Branch, tag, or commit SHA (default: main branch)" },
      },
      required: ["owner", "repo", "path"],
    },
  },
  {
    name: "github_get_commits",
    description: "Get recent commits for a repo, branch, or specific file. Returns SHA, message, author, date.",
    inputSchema: {
      type: "object",
      properties: {
        owner:    { type: "string", description: "Repo owner" },
        repo:     { type: "string", description: "Repository name" },
        branch:   { type: "string", description: "Branch name (default: repo default branch)" },
        path:     { type: "string", description: "Filter to commits touching a specific file path" },
        per_page: { type: "number", description: "Number of commits (default 15, max 100)" },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "github_search_code",
    description:
      "Search code on GitHub. Supports qualifiers: repo:owner/repo, language:typescript, path:src/, filename:package.json, etc. " +
      "Requires GITHUB_TOKEN for best results.",
    inputSchema: {
      type: "object",
      properties: {
        query:    { type: "string", description: "Search query with optional qualifiers (e.g. 'useState repo:facebook/react language:typescript')" },
        per_page: { type: "number", description: "Max results (default 10, max 30)" },
      },
      required: ["query"],
    },
  },
];

export async function handleGithubTool(name: string, args: unknown): Promise<ToolResult | null> {
  const a = (args ?? {}) as any;

  switch (name) {
    case "github_list_repos": {
      const sort     = a.sort ?? "updated";
      const per_page = Math.min(a.per_page ?? 20, 100);
      const path     = a.username
        ? `/users/${encodeURIComponent(a.username)}/repos?sort=${sort}&per_page=${per_page}`
        : `/user/repos?type=owner&sort=${sort}&per_page=${per_page}`;
      const repos: any[] = await gh(path);
      return text(repos.map(r => ({
        name:           r.full_name,
        description:    r.description,
        language:       r.language,
        stars:          r.stargazers_count,
        forks:          r.forks_count,
        updated:        r.updated_at,
        default_branch: r.default_branch,
        private:        r.private,
        url:            r.html_url,
      })));
    }

    case "github_list_prs": {
      const { owner, repo, state = "open" } = a;
      const per_page = Math.min(a.per_page ?? 15, 100);
      const prs: any[] = await gh(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=${per_page}`);
      return text(prs.map(p => ({
        number:        p.number,
        title:         p.title,
        state:         p.state,
        author:        p.user?.login,
        draft:         p.draft,
        head:          p.head?.ref,
        base:          p.base?.ref,
        additions:     p.additions,
        deletions:     p.deletions,
        changed_files: p.changed_files,
        created:       p.created_at,
        updated:       p.updated_at,
        url:           p.html_url,
        body:          p.body?.slice(0, 300),
      })));
    }

    case "github_get_pr": {
      const { owner, repo, pr_number } = a;
      const [pr, files, reviews, comments]: any[] = await Promise.all([
        gh(`/repos/${owner}/${repo}/pulls/${pr_number}`),
        gh(`/repos/${owner}/${repo}/pulls/${pr_number}/files?per_page=50`),
        gh(`/repos/${owner}/${repo}/pulls/${pr_number}/reviews`),
        gh(`/repos/${owner}/${repo}/issues/${pr_number}/comments`),
      ]);
      return text({
        number:        pr.number,
        title:         pr.title,
        state:         pr.state,
        author:        pr.user?.login,
        body:          pr.body?.slice(0, 2000),
        head:          pr.head?.ref,
        base:          pr.base?.ref,
        draft:         pr.draft,
        additions:     pr.additions,
        deletions:     pr.deletions,
        changed_files: pr.changed_files,
        mergeable:     pr.mergeable,
        url:           pr.html_url,
        files: files.slice(0, 30).map((f: any) => ({
          filename:  f.filename,
          status:    f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch:     f.patch?.slice(0, 1200),
        })),
        reviews: reviews.map((r: any) => ({
          author:    r.user?.login,
          state:     r.state,
          body:      r.body?.slice(0, 500),
          submitted: r.submitted_at,
        })),
        comments: comments.slice(0, 10).map((c: any) => ({
          author:  c.user?.login,
          body:    c.body?.slice(0, 500),
          created: c.created_at,
        })),
      });
    }

    case "github_list_issues": {
      const { owner, repo, state = "open", labels } = a;
      const per_page = Math.min(a.per_page ?? 15, 100);
      let path = `/repos/${owner}/${repo}/issues?state=${state}&per_page=${per_page}`;
      if (labels) path += `&labels=${encodeURIComponent(labels)}`;
      const issues: any[] = await gh(path);
      return text(
        issues
          .filter((i: any) => !i.pull_request)
          .map((i: any) => ({
            number:    i.number,
            title:     i.title,
            state:     i.state,
            author:    i.user?.login,
            labels:    i.labels?.map((l: any) => l.name),
            assignees: i.assignees?.map((a: any) => a.login),
            comments:  i.comments,
            created:   i.created_at,
            updated:   i.updated_at,
            url:       i.html_url,
            body:      i.body?.slice(0, 300),
          }))
      );
    }

    case "github_get_issue": {
      const { owner, repo, issue_number } = a;
      const [issue, comments]: any[] = await Promise.all([
        gh(`/repos/${owner}/${repo}/issues/${issue_number}`),
        gh(`/repos/${owner}/${repo}/issues/${issue_number}/comments?per_page=20`),
      ]);
      return text({
        number:    issue.number,
        title:     issue.title,
        state:     issue.state,
        author:    issue.user?.login,
        labels:    issue.labels?.map((l: any) => l.name),
        assignees: issue.assignees?.map((a: any) => a.login),
        body:      issue.body?.slice(0, 3000),
        created:   issue.created_at,
        updated:   issue.updated_at,
        url:       issue.html_url,
        comments:  comments.map((c: any) => ({
          author:  c.user?.login,
          body:    c.body?.slice(0, 1000),
          created: c.created_at,
        })),
      });
    }

    case "github_get_file": {
      const { owner, repo, path: filePath, ref } = a;
      let url = `/repos/${owner}/${repo}/contents/${filePath}`;
      if (ref) url += `?ref=${encodeURIComponent(ref)}`;
      const data: any = await gh(url);
      if (data.type !== "file") {
        return { content: [{ type: "text" as const, text: `Not a file — got type: ${data.type}. Specify a full file path.` }] };
      }
      const content = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
      return text({
        path:      data.path,
        size:      data.size,
        sha:       data.sha,
        url:       data.html_url,
        content:   content.slice(0, 10000),
        truncated: content.length > 10000,
      });
    }

    case "github_get_commits": {
      const { owner, repo, branch, path: filePath } = a;
      const per_page = Math.min(a.per_page ?? 15, 100);
      let url = `/repos/${owner}/${repo}/commits?per_page=${per_page}`;
      if (branch) url += `&sha=${encodeURIComponent(branch)}`;
      if (filePath) url += `&path=${encodeURIComponent(filePath)}`;
      const commits: any[] = await gh(url);
      return text(commits.map(c => ({
        sha:     c.sha?.slice(0, 8),
        message: c.commit?.message?.split("\n")[0].slice(0, 120),
        author:  c.commit?.author?.name,
        date:    c.commit?.author?.date,
        url:     c.html_url,
      })));
    }

    case "github_search_code": {
      const { query } = a;
      const per_page = Math.min(a.per_page ?? 10, 30);
      const data: any = await gh(`/search/code?q=${encodeURIComponent(query)}&per_page=${per_page}`);
      return text({
        total_count: data.total_count,
        results: data.items?.map((item: any) => ({
          path: item.path,
          repo: item.repository?.full_name,
          url:  item.html_url,
          sha:  item.sha?.slice(0, 8),
        })),
      });
    }

    default:
      return null;
  }
}
