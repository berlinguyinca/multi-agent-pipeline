import type { SecurityFinding, SecuritySeverity } from './types.js';

export interface SecurityPattern {
  rule: string;
  severity: SecuritySeverity;
  description: string;
  test: (content: string) => SecurityFinding[];
}

export function regexPattern(
  rule: string,
  severity: SecuritySeverity,
  description: string,
  regex: RegExp,
): SecurityPattern {
  return {
    rule,
    severity,
    description,
    test(content: string): SecurityFinding[] {
      const findings: SecurityFinding[] = [];
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          findings.push({
            rule,
            severity,
            message: description,
            line: i + 1,
            snippet: lines[i].trim(),
          });
        }
      }
      return findings;
    },
  };
}

// ---------------------------------------------------------------------------
// OWASP Top 10 patterns (1-10)
// ---------------------------------------------------------------------------

const evalInjection = regexPattern(
  'eval-injection',
  'critical',
  'eval() with dynamic input can lead to code injection',
  /\beval\s*\((?!['"`])/,
);

const newFunctionInjection = regexPattern(
  'new-function-injection',
  'critical',
  'new Function() can execute arbitrary code',
  /new\s+Function\s*\(/,
);

const sqlInjection = regexPattern(
  'sql-injection',
  'critical',
  'String concatenation in SQL queries enables SQL injection',
  /(?:query|execute|raw)\s*\(\s*['"`].*\+|(?:query|execute|raw)\s*\(\s*`[^`]*\$\{/,
);

const commandInjection = regexPattern(
  'command-injection',
  'critical',
  'Unsanitized shell execution enables command injection',
  /(?:exec|execSync|spawn|spawnSync)\s*\(\s*`[^`]*\$\{/,
);

const pathTraversal = regexPattern(
  'path-traversal',
  'high',
  'Path traversal via ../ can access files outside intended directory',
  /\.\.[\\/]/,
);

const hardcodedSecret = regexPattern(
  'hardcoded-secret',
  'high',
  'Hardcoded secret or API key detected',
  /(?:api[_-]?key|secret|token|password|passwd|credential)\s*[=:]\s*['"`][A-Za-z0-9+/=_\-]{16,}/i,
);

const xssInnerhtml = regexPattern(
  'xss-innerhtml',
  'high',
  'innerHTML or dangerouslySetInnerHTML enables XSS attacks',
  /(?:innerHTML|dangerouslySetInnerHTML)\s*[=:]/,
);

const insecureDeserialization = regexPattern(
  'insecure-deserialization',
  'high',
  'JSON.parse on request data without validation enables deserialization attacks',
  /JSON\.parse\s*\(\s*(?:req|request|body|params|query)\b/,
);

const ssrfPattern = regexPattern(
  'ssrf-pattern',
  'high',
  'User-controlled URL in HTTP request enables SSRF',
  /(?:fetch|axios|http\.(?:get|request)|got)\s*\(\s*(?:req|request|params|query|userInput|url)/,
);

const weakCrypto = regexPattern(
  'weak-crypto',
  'medium',
  'MD5/SHA1 are cryptographically weak hash algorithms',
  /(?:createHash|crypto\.(?:MD5|SHA1))\s*\(\s*['"`](?:md5|sha1)['"`]/i,
);

// ---------------------------------------------------------------------------
// CWE Top 25 patterns (11-15)
// ---------------------------------------------------------------------------

const missingInputValidation = regexPattern(
  'missing-input-validation',
  'medium',
  'Direct use of request parameters without validation',
  /(?:req|request)\.(?:body|params|query)\s*\[/,
);

const raceConditionFile = regexPattern(
  'race-condition-file',
  'medium',
  'TOCTOU race condition in file operations',
  /(?:existsSync|accessSync|statSync)\s*\(.*\)\s*(?:;|\n)\s*(?:readFileSync|writeFileSync|unlinkSync|appendFileSync)/,
);

const prototypePollution = regexPattern(
  'prototype-pollution',
  'high',
  'Object.assign with user input enables prototype pollution',
  /Object\.assign\s*\(\s*(?:\{\}|target|dest|obj)\s*,\s*(?:req|request|body|params|query|userInput|input)\b/,
);

const regexDos = regexPattern(
  'regex-dos',
  'medium',
  'User-controlled input in RegExp constructor enables ReDoS',
  /new\s+RegExp\s*\(\s*(?:req|request|params|query|userInput|input|body)\b/,
);

const openRedirect = regexPattern(
  'open-redirect',
  'medium',
  'Unvalidated redirect URL enables open redirect attacks',
  /(?:redirect|location\.href|location\.assign|location\.replace)\s*(?:\(|=)\s*(?:req|request|params|query|userInput|url)\b/,
);

// ---------------------------------------------------------------------------
// MAP-specific patterns (16-22)
// ---------------------------------------------------------------------------

const dangerousCommand = regexPattern(
  'dangerous-command',
  'critical',
  'Dangerous system command that could destroy data',
  /(?:rm\s+-rf\s+\/|mkfs\s|dd\s+if=|format\s+[A-Z]:|\bfdisk\b)/,
);

const networkExfiltration = regexPattern(
  'network-exfiltration',
  'critical',
  'Network command piped to shell enables remote code execution',
  /(?:curl|wget)\s+.*\|\s*(?:sh|bash|zsh|exec)|(?:curl|wget)\s+.*>\s*\/(?:tmp|dev)/,
);

const systemDirWrite = regexPattern(
  'system-dir-write',
  'critical',
  'Writing to system directories can compromise the host',
  /(?:writeFile|writeFileSync|appendFile|appendFileSync)\s*\(\s*['"`]\/(?:etc|usr|sys|boot|sbin)\//,
);

const promptInjectionMarker = regexPattern(
  'prompt-injection-marker',
  'critical',
  'Prompt injection marker detected in generated code',
  /(?:IGNORE\s+(?:ALL\s+)?PREVIOUS|SYSTEM\s*:|ACT\s+AS\s+|DISREGARD\s+(?:ALL\s+)?(?:PREVIOUS|ABOVE))/i,
);

const toolScopeBypass = regexPattern(
  'tool-scope-bypass',
  'high',
  'Tool attempting to escalate privileges or bypass scope',
  /(?:chmod\s+(?:[0-7]{3,4}|[+]?[ugoarwxst]+)\s|sudo\s|pkill\s|killall\s|chown\s)/,
);

const credentialHarvesting = regexPattern(
  'credential-harvesting',
  'critical',
  'Attempting to read credential or key files',
  /(?:readFile|readFileSync|createReadStream)\s*\(\s*['"`].*(?:\.ssh|\.aws|\.env|\.gnupg|\.npmrc|credentials)/,
);

const cryptoMining = regexPattern(
  'crypto-mining',
  'critical',
  'Crypto-mining indicators detected',
  /(?:stratum\+tcp|coinhive|xmrig|cryptonight|minergate|hashrate)/i,
);

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export const SECURITY_PATTERNS: SecurityPattern[] = [
  // OWASP Top 10
  evalInjection,
  newFunctionInjection,
  sqlInjection,
  commandInjection,
  pathTraversal,
  hardcodedSecret,
  xssInnerhtml,
  insecureDeserialization,
  ssrfPattern,
  weakCrypto,
  // CWE Top 25
  missingInputValidation,
  raceConditionFile,
  prototypePollution,
  regexDos,
  openRedirect,
  // MAP-specific
  dangerousCommand,
  networkExfiltration,
  systemDirWrite,
  promptInjectionMarker,
  toolScopeBypass,
  credentialHarvesting,
  cryptoMining,
];

export function matchPatterns(content: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const pattern of SECURITY_PATTERNS) {
    findings.push(...pattern.test(content));
  }
  return findings;
}
