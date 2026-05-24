import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

export const TWITTER_TOOLS: Tool[] = [
  {
    name: "post_tweet",
    description: "Post a tweet on X (Twitter) via Ayrshare. Requires AYRSHARE_API_KEY env var.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Tweet content (max 280 characters)" },
        reply_to: { type: "string", description: "Optional: tweet ID to reply to" },
      },
      required: ["text"],
    },
  },
];

const PostTweetSchema = z.object({
  text: z.string().min(1).max(280),
  reply_to: z.string().optional(),
});

export async function handleTwitterTool(name: string, args: unknown): Promise<ToolResult | null> {
  if (name !== "post_tweet") return null;

  const parsed = PostTweetSchema.safeParse(args);
  if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };

  const apiKey = process.env.AYRSHARE_API_KEY;
  if (!apiKey) {
    return {
      content: [{ type: "text", text: "AYRSHARE_API_KEY not set.\n\nGet your key at ayrshare.com → Profile → API Key" }],
      isError: true,
    };
  }

  const body: Record<string, any> = {
    post: parsed.data.text,
    platforms: ["twitter"],
  };
  if (parsed.data.reply_to) body.twitterOptions = { inReplyToStatusId: parsed.data.reply_to };

  try {
    const res = await fetch("https://app.ayrshare.com/api/post", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    const data: any = await res.json();
    if (!res.ok || data.status === "error") {
      const msg = data?.message ?? data?.errors?.[0] ?? JSON.stringify(data);
      return { content: [{ type: "text", text: `Ayrshare error: ${msg}` }], isError: true };
    }

    const tweetId = data?.postIds?.find((p: any) => p.platform === "twitter")?.id;
    const tweetUrl = tweetId ? `https://x.com/i/web/status/${tweetId}` : "";
    return {
      content: [{ type: "text", text: `✅ Tweet posted!\n\n"${parsed.data.text}"${tweetUrl ? `\n\n${tweetUrl}` : ""}` }],
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Failed to post tweet: ${err.message}` }], isError: true };
  }
}
