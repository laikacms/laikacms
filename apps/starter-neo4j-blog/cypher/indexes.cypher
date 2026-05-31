// Optional but recommended — run once to improve query performance.
// Neo4j creates LaikaFile and LaikaFolder nodes on first write; no
// schema migration is needed before starting the app.
//
//   cat cypher/indexes.cypher | cypher-shell -u neo4j -p <password>
//   # or paste into the Neo4j Browser

CREATE INDEX laika_file_path IF NOT EXISTS FOR (n:LaikaFile) ON (n.path);
CREATE INDEX laika_file_parent IF NOT EXISTS FOR (n:LaikaFile) ON (n.parent);
CREATE INDEX laika_folder_path IF NOT EXISTS FOR (n:LaikaFolder) ON (n.path);
CREATE INDEX laika_folder_parent IF NOT EXISTS FOR (n:LaikaFolder) ON (n.parent);
