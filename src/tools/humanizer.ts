import { z } from "zod";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callLLM } from "../llm.js";
import { ToolResult } from "../types.js";

export const HUMANIZER_TOOLS: Tool[] = [
  {
    name: "write_content",
    description:
      "Write viral-style crypto/tech content for Twitter/X. " +
      "Two formats: 'thread' returns a numbered multi-tweet thread (1/, 2/, ...) with hook + insights + closer. " +
      "'post' returns a single punchy post under 280 chars (or 500 with long=true). " +
      "No AI tells, no fluff — direct practitioner voice. Optionally match your writing style with a voice sample.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "What to write about — a thought, alpha, market insight, or narrative",
        },
        format: {
          type: "string",
          enum: ["thread", "post"],
          description: "Output format: 'thread' (multi-tweet, default) or 'post' (single tweet)",
        },
        tone: {
          type: "string",
          enum: ["alpha", "educational", "opinion", "story", "hook", "hot-take", "question", "observation"],
          description: "Writing tone/style. For threads: alpha/educational/opinion/story. For posts: hook/hot-take/alpha/question/observation. Default: opinion/hook.",
        },
        tweets: {
          type: "number",
          description: "Number of tweets in a thread, 4–12 (default: 7). Ignored for post format.",
        },
        long: {
          type: "boolean",
          description: "Allow up to 500 chars instead of 280. Post format only.",
        },
        voice_sample: {
          type: "string",
          description: "Optional: paste 1-3 of your existing posts to match your voice",
        },
      },
      required: ["topic"],
    },
  },
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

const HumanizerSchema = z.object({
  text: z.string().min(1).max(20_000),
  voice_sample: z.string().max(5_000).optional(),
});

const WriteThreadSchema = z.object({
  topic:        z.string().min(3).max(500),
  tone:         z.enum(["alpha", "educational", "opinion", "story"]).optional(),
  tweets:       z.number().int().min(4).max(12).optional(),
  voice_sample: z.string().max(5_000).optional(),
});

const WritePostSchema = z.object({
  topic:        z.string().min(3).max(500),
  style:        z.enum(["hook", "hot-take", "alpha", "question", "observation"]).optional(),
  long:         z.boolean().optional(),
  voice_sample: z.string().max(5_000).optional(),
});


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

const THREAD_SYSTEM = `You are a crypto Twitter ghostwriter who writes threads that go viral. Your style: direct, no fluff, confident without being cringe. You understand DeFi, on-chain data, narratives, and market structure. You write like a smart practitioner, not a content creator.

Rules:
- First tweet is the hook — bold claim or surprising insight. Must make people stop scrolling.
- Middle tweets: each one standalone insight. No "in this thread I'll explain" filler.
- Last tweet: the payoff. Strong closer, optional CTA (follow, RT, reply) — one CTA max.
- Number format: 1/ 2/ 3/ etc. Each tweet on its own line, separated by blank line.
- Under 280 chars per tweet unless it genuinely needs more (max 500).
- No em dashes, no "delve", no "landscape", no "it's worth noting".
- No hashtags unless they're actually used. No emojis unless they add meaning.
- Write in the user's voice if a sample is provided.`;

const POST_SYSTEM = `You are a crypto Twitter ghostwriter. Write one punchy, high-impact post. Direct. No fluff. Hook in the first line. No em dashes, no AI vocabulary. Write like a smart practitioner with an edge.`;

export async function handleHumanizerTool(name: string, args: unknown): Promise<ToolResult | null> {
  if (name === "write_content") {
    const input = args as any;
    const topic        = String(input?.topic ?? "");
    const format       = input?.format === "post" ? "post" : "thread";
    const voice_sample = input?.voice_sample as string | undefined;

    if (!topic) return { content: [{ type: "text", text: "Invalid input: topic is required" }], isError: true };

    if (format === "thread") {
      const parsed = WriteThreadSchema.safeParse(args);
      if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
      const { tone = "opinion", tweets = 7 } = parsed.data;

      const toneGuides: Record<string, string> = {
        alpha:       "Share non-obvious insights or edge. Act like you have information most people don't.",
        educational: "Explain a concept clearly. Assume smart but non-expert reader.",
        opinion:     "Take a clear position. Defend it with reasoning. Don't hedge.",
        story:       "Tell a real story with a beginning, conflict, and lesson. Make it personal and specific.",
      };
      const toneKey = Object.keys(toneGuides).includes(tone) ? tone : "opinion";

      const prompt = [
        `Write a ${tweets}-tweet Twitter/X thread on: ${topic}`,
        ``,
        `Tone: ${toneKey} — ${toneGuides[toneKey]}`,
        voice_sample ? `Voice sample (match this style):\n${voice_sample}` : "",
        ``,
        `Format: number each tweet as 1/ 2/ 3/ etc., separated by blank lines.`,
        `First tweet = hook. Last tweet = strong closer.`,
        `Output only the tweets — no intro, no explanation.`,
      ].filter(Boolean).join("\n");

      try {
        const output = await callLLM(THREAD_SYSTEM, prompt, 2000);
        return { content: [{ type: "text", text: output.trim() }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `write_content error: ${err.message}` }], isError: true };
      }
    }

    // format === "post"
    const parsed = WritePostSchema.safeParse(args);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues[0].message}` }], isError: true };
    const { style = "hook", long = false } = parsed.data;

    const styleGuides: Record<string, string> = {
      hook:        "Strong first line that stops the scroll. Deliver the insight after.",
      "hot-take":  "Controversial opinion stated plainly. Don't soften it.",
      alpha:       "Non-obvious market insight written like you're sharing it with one smart friend.",
      question:    "Ask a sharp, thought-provoking question. Don't answer it.",
      observation: "One specific thing you noticed that most people missed.",
    };
    const styleKey = Object.keys(styleGuides).includes(style) ? style : "hook";
    const charLimit = long ? 500 : 280;

    const prompt = [
      `Write one ${styleKey} post about: ${topic}`,
      `Style: ${styleGuides[styleKey]}`,
      `Max length: ${charLimit} characters.`,
      voice_sample ? `Voice sample:\n${voice_sample}` : "",
      `Output only the post text — nothing else.`,
    ].filter(Boolean).join("\n");

    try {
      const output = await callLLM(POST_SYSTEM, prompt, 300);
      return { content: [{ type: "text", text: output.trim() }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `write_content error: ${err.message}` }], isError: true };
    }
  }

  if (name !== "humanize_text") return null;

  const parsed = HumanizerSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: `Invalid input: text ${parsed.error.issues[0].message}` }], isError: true };
  }

  const { text, voice_sample } = parsed.data;

  const userMsg = voice_sample
    ? `VOICE SAMPLE (match this style):\n${voice_sample}\n\n---\n\nTEXT TO HUMANIZE:\n${text}`
    : text;

  try {
    const output = await callLLM(HUMANIZER_SYSTEM, userMsg, 4096);
    if (!output) return { content: [{ type: "text", text: "Empty response from model" }], isError: true };
    return { content: [{ type: "text", text: output.trim() }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Humanizer error: ${err.message}` }], isError: true };
  }
}
