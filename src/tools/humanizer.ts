import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolResult } from "../types.js";

export const HUMANIZER_TOOLS: Tool[] = [
  {
    name: "humanize_text",
    description:
      "Remove AI writing patterns from text — makes it sound natural, direct, and human. " +
      "Fixes 29 common AI tells: significance inflation, em dash overuse, filler phrases, " +
      "sycophantic openers, passive voice, elegant variation, chatbot artifacts, and more. " +
      "Optionally provide a writing sample to match your personal voice.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to humanize",
        },
        voice_sample: {
          type: "string",
          description: "Optional: a sample of your own writing so the output matches your voice",
        },
      },
      required: ["text"],
    },
  },
];

const HUMANIZER_SYSTEM = `You are a text editor that removes signs of AI-generated writing.

Your job: rewrite the input so it sounds natural, direct, and human — without changing the meaning.

Fix these patterns when present:

CONTENT
1. Significance inflation — remove phrases like "in today's rapidly evolving landscape", "in an era of", "now more than ever"
2. Notability emphasis — cut "notably", "it is worth noting", "it is important to note"
3. Superficial -ing openers — rewrite "By leveraging X, you can Y" → just say "X lets you Y"
4. Promotional language — cut "revolutionary", "game-changing", "cutting-edge", "innovative solution"
5. Vague attribution — replace "experts say", "studies show" with specific sources or cut entirely
6. Formulaic challenges sections — remove "Of course, challenges remain" boilerplate

LANGUAGE
7. AI vocabulary — replace: landscape → field/market/space, pivotal → key/critical, testament → proof/sign, delve → explore/look at, utilize → use, leverage → use
8. Copula avoidance — "serves as", "stands as", "acts as" → just use "is"
9. Negative parallelisms — "not only X but also Y" → just say the thing directly
10. Rule of three — "fast, reliable, and scalable" padding — cut to what matters
11. Elegant variation — don't use synonyms to avoid repeating a word; repeat it or restructure
12. False ranges — "anywhere from X to Y" → just say the number you know
13. Passive voice — rewrite to active where it feels evasive
14. Em dash overuse — max one per paragraph; replace others with commas or rewrite
15. Bullet point padding — remove bullets that just restate the intro sentence

COMMUNICATION
16. Chatbot artifacts — cut "Certainly!", "Of course!", "Great question!", "I hope this helps"
17. Knowledge disclaimers — cut "As of my last update", "Based on my training data"
18. Sycophancy — cut "That's a fascinating perspective", "You raise an excellent point"

FILLER
19. Filler phrases — cut "It is worth mentioning that", "It goes without saying", "Needless to say"
20. Excessive hedging — cut "it could be argued", "one might say", "in some ways"
21. Generic conclusions — rewrite "In conclusion, X is important" → just end on substance
22. Hyphenated padding — "user-friendly", "game-changing", "thought-provoking" → be specific
23. Signposting — cut "In this article, I will explain" — just explain it
24. Fragmented headers — avoid turning every sentence into a bold header

PROCESS:
1. Read the full text
2. Identify which patterns are present
3. Rewrite — fix all patterns found
4. Self-audit: scan the rewrite for any remaining AI tells
5. Final revision if needed
6. Output ONLY the final humanized text — no commentary, no explanation, no "Here is your text:"

If a voice sample is provided, match its tone, rhythm, and vocabulary. Otherwise use direct, opinionated, natural prose.`;

export async function handleHumanizerTool(name: string, args: unknown): Promise<ToolResult | null> {
  if (name !== "humanize_text") return null;

  const a = (args ?? {}) as Record<string, any>;
  if (!a.text?.trim()) {
    return { content: [{ type: "text", text: "text is required" }], isError: true };
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return { content: [{ type: "text", text: "MINIMAX_API_KEY not set — humanizer requires MiniMax API access" }], isError: true };
  }

  const userMsg = a.voice_sample
    ? `VOICE SAMPLE (match this style):\n${a.voice_sample}\n\n---\n\nTEXT TO HUMANIZE:\n${a.text}`
    : a.text;

  try {
    const res = await fetch("https://api.minimaxi.chat/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "MiniMax-Text-01",
        messages: [
          { role: "system", content: HUMANIZER_SYSTEM },
          { role: "user", content: userMsg },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const err = await res.text();
      return { content: [{ type: "text", text: `API error: ${res.status} ${err.slice(0, 200)}` }], isError: true };
    }

    const data: any = await res.json();
    const output = data?.choices?.[0]?.message?.content?.trim();
    if (!output) return { content: [{ type: "text", text: "Empty response from model" }], isError: true };

    return { content: [{ type: "text", text: output }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Humanizer error: ${err.message}` }], isError: true };
  }
}
