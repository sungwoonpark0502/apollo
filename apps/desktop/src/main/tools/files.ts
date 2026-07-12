import { z } from 'zod';
import fg from 'fast-glob';
import { basename, resolve, sep } from 'node:path';
import { type ToolDef } from '@apollo/shared';

export interface FilesToolDeps {
  /** User-approved directories (settings; seeded with Documents/Desktop/Downloads). */
  getApprovedDirs: () => string[];
}

const DEPTH = 6;
const CAP = 200;

const params = z.object({
  query: z.string().min(1),
  extension: z.string().optional(),
});

export function createFilesTool(deps: FilesToolDeps): ToolDef {
  const find: ToolDef<typeof params> = {
    name: 'files.find',
    tier: 1,
    description:
      'Find files by case-insensitive name substring inside the user\'s approved folders (Documents, Desktop, Downloads by default). Optional extension filter like "pdf".',
    params,
    async execute(a) {
      const dirs = deps.getApprovedDirs().map((d) => resolve(d));
      if (dirs.length === 0) return { llmText: 'WARNING no approved folders are configured (Settings > Privacy).' };

      const ext = a.extension?.replace(/^\./, '').toLowerCase();
      const needle = a.query.toLowerCase();
      const results: string[] = [];

      for (const dir of dirs) {
        if (results.length >= CAP) break;
        let entries: string[];
        try {
          entries = await fg('**/*', {
            cwd: dir,
            deep: DEPTH,
            onlyFiles: true,
            dot: false,
            suppressErrors: true,
            absolute: true,
          });
        } catch {
          continue; // unreadable dir: degrade quietly
        }
        for (const p of entries) {
          const name = basename(p).toLowerCase();
          if (!name.includes(needle)) continue;
          if (ext && !name.endsWith(`.${ext}`)) continue;
          // C14.6: results stay confined to approved dirs
          if (!dirs.some((d) => p.startsWith(d + sep) || p === d)) continue;
          results.push(p);
          if (results.length >= CAP) break;
        }
      }

      if (results.length === 0) {
        return { llmText: `No files matching "${a.query}"${ext ? ` (.${ext})` : ''} in the approved folders.` };
      }
      const shown = results.slice(0, 20);
      return {
        llmText:
          `${results.length}${results.length >= CAP ? '+' : ''} file${results.length > 1 ? 's' : ''} found:\n` +
          shown.map((p, i) => `${i + 1}. ${p}`).join('\n') +
          (results.length > shown.length ? `\n…and ${results.length - shown.length} more.` : ''),
        card: { kind: 'text', body: shown.map((p) => basename(p)).join('\n') },
      };
    },
  };
  return find;
}
