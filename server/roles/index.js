// Role loader — ported from hiring-agent's roles.py (HackerRank's open-sourced
// resume scorer, PR #375 "role-agnostic scoring"). A role lives in
// server/roles/<name>/ and bundles role.json (categories, weights, score
// bounds) with a systemMessage.js/criteria.js pair. The categories in
// role.json drive the dynamic scoring schema built in server/llm/scoreCv.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROLES_DIR = path.dirname(fileURLToPath(import.meta.url));

export function listAvailableRoles() {
  return fs
    .readdirSync(ROLES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(ROLES_DIR, e.name, 'role.json')))
    .map((e) => e.name)
    .sort();
}

export async function loadRole(name) {
  const roleDir = path.join(ROLES_DIR, name);
  const manifestPath = path.join(roleDir, 'role.json');
  if (!fs.existsSync(manifestPath)) {
    const available = listAvailableRoles().join(', ') || '(none found)';
    throw new Error(`Unknown role '${name}'. Available roles: ${available}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const categories = manifest.categories ?? [];
  if (!categories.length) {
    throw new Error(`Role '${name}' role.json must define a non-empty 'categories' list`);
  }

  const seen = new Set();
  for (const c of categories) {
    if (!c.key || c.max == null) throw new Error(`Role '${name}': each category needs a 'key' and 'max'`);
    if (seen.has(c.key)) throw new Error(`Role '${name}': duplicate category key '${c.key}'`);
    seen.add(c.key);
  }

  const { SYSTEM_MESSAGE } = await import(pathToFileURL(path.join(roleDir, 'systemMessage.js')));
  const { buildCriteria } = await import(pathToFileURL(path.join(roleDir, 'criteria.js')));

  return {
    name,
    positionTitle: manifest.position_title ?? name,
    categories,
    bonusMax: manifest.bonus_max ?? 20,
    minFinalScore: manifest.min_final_score ?? 0,
    maxFinalScore:
      manifest.max_final_score ??
      categories.reduce((sum, c) => sum + c.max, 0) + (manifest.bonus_max ?? 20),
    systemMessage: SYSTEM_MESSAGE,
    buildCriteria,
  };
}
