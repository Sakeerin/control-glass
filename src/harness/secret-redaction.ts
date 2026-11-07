export function createSecretRedactor(env: NodeJS.ProcessEnv = process.env): (text: string) => string {
  const values = [...new Set(Object.entries(env)
    .filter(([name, value]) => /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i.test(name) && value !== undefined && value.trim().length > 0)
    .flatMap(([, value]) => value === undefined ? [] : [value, value.trim(), JSON.stringify(value).slice(1, -1)]))].sort((left, right) => right.length - left.length);
  return text => {
    let result = text.replace(/-----BEGIN ((?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g, "[REDACTED]")
      .replace(/\b(?:sk-(?:proj-)?[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{30,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED]");
    for (const value of values) result = result.split(value).join("[REDACTED]");
    return result;
  };
}

export function redactedJson(value: unknown): string {
  const redact = createSecretRedactor();
  return JSON.stringify(value, (key, item: unknown) => typeof item === "string" && !["status", "ruleId", "category", "kind", "language", "recommendedTier"].includes(key) ? redact(item) : item, 2);
}

export function redactReportStrings<T>(report: T): T {
  return JSON.parse(redactedJson(report)) as T;
}
