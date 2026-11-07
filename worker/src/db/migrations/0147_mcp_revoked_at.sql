-- "Sign out of all devices" also disconnects Claude (the MCP server): MCP grants made
-- before this moment (epoch ms) are refused and revoked by the MCP worker, which keeps
-- its grants in its own KV that the API worker can't reach. NULL = never.
ALTER TABLE users ADD COLUMN mcp_revoked_at INTEGER;
