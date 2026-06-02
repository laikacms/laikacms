/**
 * Creates the two ArangoDB collections used by Laika if they don't exist yet.
 * Call this once at startup — ArangoDB returns 409 Conflict if the collection
 * already exists, which this helper treats as a no-op.
 *
 * ArangoDB does not create collections on first write (unlike SurrealDB or
 * DynamoDB), so this must run before any reads or writes.
 */
export async function ensureCollections(
  url: string,
  database: string,
  authHeader: string,
  collections: string[],
): Promise<void> {
  const base = `${url.replace(/\/+$/, '')}/_db/${encodeURIComponent(database)}/_api/collection`;
  for (const name of collections) {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ name, type: 2 }),
    });
    if (!res.ok && res.status !== 409) {
      const body = await res.text().catch(() => '');
      throw new Error(`ArangoDB ensureCollection(${name}) failed: ${res.status} ${body}`);
    }
  }
}
