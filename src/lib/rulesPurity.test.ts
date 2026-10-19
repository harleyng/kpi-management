// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The rules are pure (CLAUDE.md rule 5): they read the time only from the `Clock` they are given and
 * hold no module state, so the same inputs always give the same answer — in a test, in the mock
 * gateway and, later, against a database. This guard fails the build if one reaches for the machine.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const ruleFiles = readdirSync(dir).filter((f) => (/Rules\.ts$/.test(f) || f === 'isoDate.ts') && !f.endsWith('.test.ts'));

describe('rule modules read no clock and no randomness of their own', () => {
  it('finds the rule modules', () => {
    expect(ruleFiles).toEqual(expect.arrayContaining(['calcRules.ts', 'cycleRules.ts', 'scoreRules.ts', 'workflowRules.ts', 'isoDate.ts']));
  });

  it.each(ruleFiles)('%s', (file) => {
    // Comments may name what is forbidden; only code counts.
    const source = readFileSync(`${dir}/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/Date\.now\(|new Date\(\s*\)|Math\.random\(|crypto\.randomUUID\(/);
    expect(source).not.toMatch(/^let\s/m); // no mutable module state
  });
});
