import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { callConvex } from "../convex.js";
import type { ToolResult } from "../types.js";

export const PACKET_TOOLS: Tool[] = [
  {
    name: "packet_create",
    description:
      "Create or update a Packet - a named, reusable AI workflow stored in your vault. " +
      "A Packet is a sequence of steps (tool calls or prompts) that can be run later or shared. " +
      "Example: a 'daily-research' packet that runs web_search → ask_noel → vault_save each morning. " +
      "Steps can be tool calls with explicit args, or natural language prompts for the AI to interpret. " +
      "Packets are saved to vault as type='workflow' with versioning and sharing built in.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Packet name (slug-style, e.g. 'daily-eth-research')",
        },
        description: {
          type: "string",
          description: "What this packet does",
        },
        steps: {
          type: "array",
          description: "Ordered list of steps to execute",
          items: {
            type: "object",
            properties: {
              step:        { type: "number",  description: "Step number" },
              description: { type: "string",  description: "What this step does" },
              tool:        { type: "string",  description: "Tool name to call (optional)" },
              args:        { type: "object",  description: "Tool arguments (optional)" },
              prompt:      { type: "string",  description: "Natural language instruction (alternative to tool)" },
            },
            required: ["step", "description"],
          },
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for discovery (e.g. ['research', 'daily', 'defi'])",
        },
      },
      required: ["name", "description", "steps"],
    },
  },
  {
    name: "packet_run",
    description:
      "Load and execute a Packet by name. Returns all steps formatted for sequential execution. " +
      "After calling this, execute each step in order - tool steps are called directly, prompt steps are interpreted as instructions.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Packet name to run",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "packet_list",
    description: "List all your Packets - reusable workflows stored in vault. Shows name, description, step count, and whether it's shared.",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Optional search term to filter packets",
        },
      },
    },
  },
  {
    name: "packet_share",
    description:
      "Publish a Packet to the community so others can discover and use it. " +
      "Once shared, the packet appears in the public Packets gallery.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Packet name to share",
        },
        authorName: {
          type: "string",
          description: "Your display name for attribution",
        },
      },
      required: ["name"],
    },
  },
];

function packetKey(name: string): string {
  return `packets/${name.toLowerCase().replace(/\s+/g, "-")}`;
}

export async function handlePacket(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {

  if (toolName === "packet_create") {
    const { name, description, steps, tags } = args as {
      name: string;
      description: string;
      steps: Array<{ step: number; description: string; tool?: string; args?: Record<string, unknown>; prompt?: string }>;
      tags?: string[];
    };

    const content = JSON.stringify({ name, description, steps }, null, 2);
    const data = await callConvex("/vault/save", "POST", {
      key: packetKey(name),
      type: "workflow",
      title: name,
      content,
      contentType: "json",
      tags: ["packet", ...(tags ?? [])],
    }, "packet_create");

    return {
      content: [{
        type: "text",
        text: [
          `📦 **Packet saved: \`${name}\`**`,
          ``,
          `**${steps.length} step${steps.length !== 1 ? "s" : ""}:**`,
          ...steps.map((s) =>
            `  ${s.step}. ${s.description}${s.tool ? ` → \`${s.tool}\`` : ""}`
          ),
          ``,
          `Version: ${data.version ?? 1}`,
          `Run it: \`packet_run name: "${name}"\``,
          `Share it: \`packet_share name: "${name}"\``,
        ].join("\n"),
      }],
    };
  }

  if (toolName === "packet_run") {
    const { name } = args as { name: string };
    const data = await callConvex(
      `/vault/entry?key=${encodeURIComponent(packetKey(name))}`,
      "GET",
      undefined,
      "packet_run",
    );

    if (!data?.content || data?.error) {
      return {
        content: [{ type: "text", text: `Packet \`${name}\` not found. Use \`packet_list\` to see available packets.` }],
        isError: true,
      };
    }

    let packet: { name: string; description: string; steps: Array<{ step: number; description: string; tool?: string; args?: Record<string, unknown>; prompt?: string }> };
    try {
      packet = JSON.parse(data.content);
    } catch {
      return {
        content: [{ type: "text", text: `Packet \`${name}\` has invalid content.` }],
        isError: true,
      };
    }

    const lines: string[] = [
      `## 📦 Running Packet: \`${packet.name}\``,
      `*${packet.description}*`,
      ``,
      `**Execute these ${packet.steps.length} steps in order:**`,
      ``,
    ];

    for (const s of packet.steps) {
      lines.push(`### Step ${s.step}: ${s.description}`);
      if (s.tool) {
        lines.push(`**Tool:** \`${s.tool}\``);
        if (s.args && Object.keys(s.args).length > 0) {
          lines.push(`**Args:** \`\`\`json\n${JSON.stringify(s.args, null, 2)}\n\`\`\``);
        }
      } else if (s.prompt) {
        lines.push(`**Instruction:** ${s.prompt}`);
      }
      lines.push("");
    }

    lines.push(`*Log completion: \`chronicle_add type="tool" title="Ran packet: ${name}"\`*`);

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (toolName === "packet_list") {
    const { search } = args as { search?: string };
    const params = new URLSearchParams({ type: "workflow", limit: "50" });
    if (search) params.set("q", search);

    const endpoint = search ? `/vault/search?${params}` : `/vault/list?${params}`;
    const data = await callConvex(endpoint, "GET", undefined, "packet_list");

    const entries: any[] = (data.entries ?? data.results ?? []).filter(
      (e: any) => (e.tags ?? []).includes("packet")
    );

    if (entries.length === 0) {
      return {
        content: [{
          type: "text",
          text: [
            "No packets found. Create one:",
            `\`\`\``,
            `packet_create name="daily-research" description="My daily research workflow" steps=[...]`,
            `\`\`\``,
          ].join("\n"),
        }],
      };
    }

    const lines = [`## 📦 Your Packets (${entries.length})`, ""];
    for (const e of entries) {
      let stepCount = "?";
      try {
        const p = JSON.parse(e.content ?? "{}");
        stepCount = String(p.steps?.length ?? "?");
      } catch {}
      const shared = e.isPublic ? " · 🌐 public" : "";
      lines.push(`**${e.title}** · ${stepCount} steps${shared}`);
      if (e.tags?.length) {
        const displayTags = e.tags.filter((t: string) => t !== "packet");
        if (displayTags.length) lines.push(`  Tags: ${displayTags.join(", ")}`);
      }
      lines.push(`  \`packet_run name: "${e.title}"\``);
      lines.push("");
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (toolName === "packet_share") {
    const { name, authorName } = args as { name: string; authorName?: string };

    await callConvex("/vault/publish", "POST", {
      key: packetKey(name),
      authorName: authorName ?? "anonymous",
    }, "packet_share");

    return {
      content: [{
        type: "text",
        text: [
          `🌐 **Packet shared: \`${name}\`**`,
          ``,
          `It's now public and discoverable by others.`,
          `Unshare anytime: \`vault_read key: "packets/${name}"\` → unpublish via vault.`,
        ].join("\n"),
      }],
    };
  }

  return { content: [{ type: "text", text: `Unknown packet tool: ${toolName}` }], isError: true };
}
