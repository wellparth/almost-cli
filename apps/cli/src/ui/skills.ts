// Skill discovery from local SKILL.md files (issue #42).
import { access, readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
  source: string;
}

const HOME = homedir();

/** Directories scanned for `<name>/SKILL.md` files. */
export function skillRoots(): string[] {
  const project = process.cwd();
  return [
    ...(process.env.MYAGENT_SKILLS_DIR ? [process.env.MYAGENT_SKILLS_DIR] : []),
    join(HOME, ".opencode", "skills"),
    join(HOME, ".claude", "skills"),
    join(HOME, ".agents", "skills"),
    join(project, ".opencode", "skills"),
  ];
}

/** Parse `name`/`description` out of a SKILL.md frontmatter block. */
export function parseSkillFrontmatter(raw: string, fallbackName: string): { name?: string; description?: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const body = m[1] ?? "";
  const field = (key: string): string | undefined => {
    const line = body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.toLowerCase().startsWith(`${key}:`));
    if (!line) return undefined;
    const value = line.slice(line.indexOf(":") + 1).trim();
    return value ? value : undefined;
  };
  return {
    name: field("name") ?? fallbackName,
    description: field("description"),
  };
}

/** List all skills found under the scanned roots. */
export async function listSkills(): Promise<SkillEntry[]> {
  const out: SkillEntry[] = [];
  for (const root of skillRoots()) {
    if (!root) continue;
    let entries: Dirent[];
    try {
      entries = (await readdir(root, { withFileTypes: true })) as Dirent[];
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(root, entry.name);
      const skillFile = join(skillDir, "SKILL.md");
      let raw: string;
      try {
        await access(skillFile);
        raw = await readFile(skillFile, "utf8");
      } catch {
        continue;
      }
      const meta = parseSkillFrontmatter(raw, entry.name);
      const description =
        meta.description ??
        raw
          .replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "")
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.length > 0 && !l.startsWith("#")) ??
        "(no description)";
      out.push({ name: meta.name ?? entry.name, description, path: skillFile, source: root });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Find a single skill by name (case-insensitive, exact match preferred). */
export async function findSkill(name: string): Promise<SkillEntry | undefined> {
  const skills = await listSkills();
  return skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
}