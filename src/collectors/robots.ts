/**
 * Intérprete mínimo de robots.txt (RFC 9309): grupos por user-agent,
 * Allow/Disallow con coincidencia más larga, comodines "*" y "$".
 */

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (!current) continue;
      if (field === 'disallow' && value === '') continue; // "Disallow:" vacío = todo permitido
      current.rules.push({ allow: field === 'allow', pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** userAgent: el "product token" (p. ej. "zzz-meta-knowledge"). path: ruta + query. */
export function isPathAllowed(robotsTxt: string, userAgent: string, path: string): boolean {
  const groups = parseRobots(robotsTxt);
  const token = userAgent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = applicable.flatMap((g) => g.rules);
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
