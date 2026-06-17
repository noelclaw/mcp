// Static heuristic scanner for Solidity audit grounding.
//
// The LLM-only audit path was dangerous: a model could say "this contract
// looks safe" without any structural basis, and a user might trust that
// claim with real funds. This module runs a regex/pattern scan over the
// source BEFORE the LLM call and forces the LLM to address each finding
// (either confirm the risk or explain why it's a false positive). The
// resulting report leads with "automated static checks", then "LLM review
// over those findings", then a mandatory disclaimer.
//
// This is NOT a substitute for a professional audit. It catches obvious
// antipatterns. Subtle vulnerabilities (reentrancy guarded by state ordering,
// signature replay, oracle manipulation under non-obvious conditions) still
// need human review or specialized tooling (Slither, Mythril, Echidna).

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type ScanFinding = {
  id: string;          // stable identifier (e.g. "SOL-TX-ORIGIN")
  severity: Severity;
  title: string;
  detail: string;      // 1-2 sentence explanation
  lineHint?: number;   // 1-based line number where pattern first appears
  matched: string;     // the matched snippet, clipped
  reference?: string;  // optional URL for further reading
};

type Pattern = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  // Either a RegExp to apply per-line, or a function returning matches.
  regex?: RegExp;
  customScan?: (lines: string[]) => Array<{ line: number; matched: string }>;
  reference?: string;
};

const PATTERNS: Pattern[] = [
  // ─── Critical ─────────────────────────────────────────────────────────────
  {
    id: "SOL-TX-ORIGIN",
    severity: "critical",
    title: "tx.origin used for authorization",
    detail:
      "tx.origin returns the original EOA that started the call chain - vulnerable to phishing where a malicious contract relays calls. Use msg.sender for auth.",
    regex: /\btx\.origin\b/,
    reference: "https://docs.soliditylang.org/en/latest/security-considerations.html#tx-origin",
  },
  {
    id: "SOL-DELEGATECALL",
    severity: "critical",
    title: "delegatecall to a non-immutable target",
    detail:
      "delegatecall executes target code in caller's storage. If target is a state variable or function parameter it can be hijacked to overwrite storage or steal funds.",
    customScan: (lines) => {
      const out: Array<{ line: number; matched: string }> = [];
      lines.forEach((l, i) => {
        if (/\.delegatecall\s*\(/i.test(l) && !/immutable|constant/.test(l)) {
          out.push({ line: i + 1, matched: l.trim().slice(0, 200) });
        }
      });
      return out;
    },
    reference: "https://docs.soliditylang.org/en/latest/security-considerations.html#use-the-checks-effects-interactions-pattern",
  },
  {
    id: "SOL-SELFDESTRUCT",
    severity: "critical",
    title: "selfdestruct present",
    detail:
      "selfdestruct (renamed `selfdestruct` in 0.8.x; deprecated post-Cancun) wipes contract code. Requires strict access control. Note: Cancun changed semantics - most uses should be removed entirely.",
    regex: /\bselfdestruct\s*\(|suicide\s*\(/,
  },

  // ─── High ─────────────────────────────────────────────────────────────────
  {
    id: "SOL-REENTRANCY-PATTERN",
    severity: "high",
    title: "External call before state mutation (reentrancy risk)",
    detail:
      "Heuristic detects `.call{value:` or `.transfer(` followed by storage writes in the next ~15 lines. Confirm Checks-Effects-Interactions ordering or ReentrancyGuard usage.",
    customScan: (lines) => {
      const out: Array<{ line: number; matched: string }> = [];
      lines.forEach((l, i) => {
        if (/\.call\s*\{|\.transfer\s*\(|\.send\s*\(/.test(l) && !/^\s*\/\//.test(l)) {
          // Look ahead for storage write
          const slice = lines.slice(i + 1, Math.min(i + 16, lines.length)).join("\n");
          if (/^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*=|^\s*[a-zA-Z_][a-zA-Z0-9_]*\[[^\]]*\]\s*=|\.push\s*\(|\.pop\s*\(|delete\s+/m.test(slice)) {
            out.push({ line: i + 1, matched: l.trim().slice(0, 200) });
          }
        }
      });
      return out;
    },
    reference: "https://swcregistry.io/docs/SWC-107",
  },
  {
    id: "SOL-UNCHECKED-CALL",
    severity: "high",
    title: "Low-level call return value not checked",
    detail:
      "`.call(...)` and `.delegatecall(...)` return (bool, bytes). Ignoring the bool means failures silently pass.",
    customScan: (lines) => {
      const out: Array<{ line: number; matched: string }> = [];
      lines.forEach((l, i) => {
        if (/\.call\s*\{|\.call\s*\(|\.delegatecall\s*\(/.test(l)) {
          // Has assignment / require / boolean check?
          const hasCheck = /\(bool|=\s*(?:address|payable)?[a-zA-Z_]/i.test(l)
            || /require\s*\(/.test(l)
            || /\(\s*bool\s+/i.test(l);
          if (!hasCheck) out.push({ line: i + 1, matched: l.trim().slice(0, 200) });
        }
      });
      return out;
    },
    reference: "https://swcregistry.io/docs/SWC-104",
  },
  {
    id: "SOL-FLOATING-PRAGMA",
    severity: "medium",
    title: "Floating pragma",
    detail:
      "Using `^0.8.x` lets the contract compile with any minor version - different compilers can introduce subtle behavior changes. Pin to a specific version for production.",
    regex: /pragma\s+solidity\s+\^/i,
  },
  {
    id: "SOL-BLOCK-TIMESTAMP",
    severity: "medium",
    title: "block.timestamp used in conditional logic",
    detail:
      "Miners can shift block.timestamp by ~15s. Acceptable for long timeouts; dangerous for randomness, short deadlines, or precise time-locks.",
    regex: /\bblock\.timestamp\b|\bnow\b/,
    reference: "https://swcregistry.io/docs/SWC-116",
  },
  {
    id: "SOL-BLOCK-NUMBER-RAND",
    severity: "high",
    title: "block.number / blockhash used as randomness source",
    detail:
      "block.number is predictable; blockhash returns 0 for blocks older than 256. Use Chainlink VRF or commit-reveal for fair randomness.",
    customScan: (lines) => {
      const out: Array<{ line: number; matched: string }> = [];
      lines.forEach((l, i) => {
        if (/\b(?:blockhash|block\.difficulty|block\.prevrandao)\s*\(/.test(l)
          && /\b(?:random|rand|seed|lottery)/i.test(l)) {
          out.push({ line: i + 1, matched: l.trim().slice(0, 200) });
        }
      });
      return out;
    },
  },

  // ─── Medium ───────────────────────────────────────────────────────────────
  {
    id: "SOL-MISSING-ZERO-CHECK",
    severity: "low",
    title: "Address parameter without zero-address check (heuristic)",
    detail:
      "Setter functions that store an address but don't `require(addr != address(0))` can permanently break the contract. Heuristic - verify whether your intent allows zero.",
    customScan: (lines) => {
      const out: Array<{ line: number; matched: string }> = [];
      lines.forEach((l, i) => {
        // Match `function setX(address _x)` or similar
        const fn = l.match(/function\s+set\w*\s*\(\s*address\s+/);
        if (fn) {
          const body = lines.slice(i, Math.min(i + 12, lines.length)).join("\n");
          if (!/require\s*\([^)]*address\s*\(\s*0\s*\)|!=\s*address\s*\(\s*0\s*\)/.test(body)) {
            out.push({ line: i + 1, matched: l.trim().slice(0, 200) });
          }
        }
      });
      return out;
    },
  },
  {
    id: "SOL-PUBLIC-MUTATING",
    severity: "low",
    title: "Public function with no access modifier (heuristic)",
    detail:
      "External functions that mutate state with no onlyOwner/AccessControl modifier may be unintentionally open. Verify intent.",
    customScan: (lines) => {
      const out: Array<{ line: number; matched: string }> = [];
      lines.forEach((l, i) => {
        // function ... public ... { but no onlyOwner / require( msg.sender on next few lines
        if (/function\s+\w+\s*\([^)]*\)\s+(?:public|external)\s/.test(l)
          && !/view|pure/.test(l)
          && !/onlyOwner|onlyRole|onlyAdmin|nonReentrant/.test(l)) {
          const body = lines.slice(i, Math.min(i + 4, lines.length)).join("\n");
          if (!/require\s*\(\s*msg\.sender|onlyOwner|onlyRole|AccessControl/.test(body)) {
            out.push({ line: i + 1, matched: l.trim().slice(0, 200) });
          }
        }
      });
      return out;
    },
  },
  {
    id: "SOL-UNBOUNDED-LOOP",
    severity: "medium",
    title: "Loop over array of unbounded length",
    detail:
      "for/while loops over arrays that anyone can grow are gas-bomb vectors and DoS risks.",
    customScan: (lines) => {
      const out: Array<{ line: number; matched: string }> = [];
      lines.forEach((l, i) => {
        if (/for\s*\(.*<\s*[a-zA-Z_][a-zA-Z0-9_]*\.length/.test(l)
          && !/i\s*<\s*\d+/.test(l)) {
          out.push({ line: i + 1, matched: l.trim().slice(0, 200) });
        }
      });
      return out;
    },
  },

  // ─── Info ─────────────────────────────────────────────────────────────────
  {
    id: "SOL-NO-EVENTS",
    severity: "info",
    title: "State-mutating function may not emit events",
    detail:
      "Critical state changes should emit events for off-chain indexers and auditability.",
    customScan: (lines) => {
      // Crude heuristic - only flag if zero `emit` statements in entire file
      const hasEmit = lines.some((l) => /\bemit\s+\w+\s*\(/.test(l));
      if (hasEmit) return [];
      // Find first state-changing fn for the report
      for (let i = 0; i < lines.length; i++) {
        if (/function\s+\w+\s*\([^)]*\)\s+(?:public|external)\s/.test(lines[i])
          && !/view|pure/.test(lines[i])) {
          return [{ line: i + 1, matched: lines[i].trim().slice(0, 200) }];
        }
      }
      return [];
    },
  },
  {
    id: "SOL-NO-LICENSE",
    severity: "info",
    title: "Missing SPDX license identifier",
    detail:
      "Solidity emits a warning when no SPDX comment is present. Required for clean compile in CI.",
    customScan: (lines) => {
      const hasLicense = lines.slice(0, 10).some((l) => /SPDX-License-Identifier:/.test(l));
      return hasLicense ? [] : [{ line: 1, matched: lines[0]?.trim().slice(0, 200) ?? "(file start)" }];
    },
  },
];

/**
 * Run all patterns over a Solidity source string. Returns flat list of
 * findings sorted by severity (critical first).
 */
export function staticScanSolidity(source: string): ScanFinding[] {
  const lines = source.split(/\r?\n/);
  const findings: ScanFinding[] = [];

  for (const p of PATTERNS) {
    if (p.regex) {
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        // Skip pure comment lines
        if (/^(\/\/|\*|\/\*)/.test(trimmed)) return;
        if (p.regex!.test(line)) {
          findings.push({
            id: p.id, severity: p.severity, title: p.title, detail: p.detail,
            lineHint: idx + 1, matched: line.trim().slice(0, 200),
            reference: p.reference,
          });
        }
      });
    } else if (p.customScan) {
      const hits = p.customScan(lines);
      for (const h of hits) {
        findings.push({
          id: p.id, severity: p.severity, title: p.title, detail: p.detail,
          lineHint: h.line, matched: h.matched,
          reference: p.reference,
        });
      }
    }
  }

  // Dedup: same id + same line = one entry
  const seen = new Set<string>();
  const deduped = findings.filter((f) => {
    const k = `${f.id}:${f.lineHint ?? "0"}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const sevRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return deduped.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
}

/**
 * Format findings as a markdown block to inject into the LLM prompt or
 * into the final report.
 */
export function formatFindings(findings: ScanFinding[]): string {
  if (findings.length === 0) {
    return "_No common antipatterns detected by static scan. This does not mean the contract is safe - subtle issues still need human review._";
  }
  const byCat: Record<Severity, ScanFinding[]> = { critical: [], high: [], medium: [], low: [], info: [] };
  for (const f of findings) byCat[f.severity].push(f);

  const sections: string[] = [];
  const labels: Record<Severity, string> = {
    critical: "🚨 CRITICAL", high: "🔴 HIGH", medium: "🟡 MEDIUM", low: "🔵 LOW", info: "ℹ️ INFO",
  };
  for (const sev of ["critical", "high", "medium", "low", "info"] as Severity[]) {
    if (byCat[sev].length === 0) continue;
    sections.push(`### ${labels[sev]} (${byCat[sev].length})`);
    for (const f of byCat[sev]) {
      sections.push([
        `- **${f.title}** \`${f.id}\``,
        f.lineHint ? `  - Line ${f.lineHint}: \`${f.matched}\`` : "",
        `  - ${f.detail}`,
        f.reference ? `  - Reference: ${f.reference}` : "",
      ].filter(Boolean).join("\n"));
    }
    sections.push("");
  }
  return sections.join("\n");
}

/**
 * Mandatory disclaimer appended to every audit report. Sets expectations
 * so users don't treat the output as a professional audit.
 */
export const AUDIT_DISCLAIMER = `
---

## ⚠️ Scope of this audit

This report combines:
1. **Automated static scan** - regex/pattern heuristics flagging common antipatterns (tx.origin, reentrancy patterns, unchecked low-level calls, etc.)
2. **LLM review over those findings + the contract source** - model-generated analysis, not a formal proof

This is **NOT** a substitute for:
- A professional security audit (CertiK, Trail of Bits, OpenZeppelin, Spearbit, etc.)
- Formal verification (Certora, Halmos)
- Specialized tooling (Slither, Mythril, Echidna, Manticore)
- Manual review by an experienced Solidity engineer

**Do not deploy contracts holding user funds based on this report alone.** Treat findings as a starting point for human review.
`;
