// Pulls the first JSON object out of a model reply. Kept dependency-free so the web page can import the analyst module.
export function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in reply");
  return JSON.parse(match[0]) as T;
}
