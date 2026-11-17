# SPL MCP — design notes

These documents capture the design of an **MCP (Model Context Protocol) server**
that exposes the lifecycle operations of a **single** SPLALM-managed Software
Product Line (SPL) to AI assistants and other MCP clients.

SPLALM today is a multi-tenant tool: a user logs in and operates over many SPLs
("lines") and many products. The MCP we want is the opposite: it is bound to a
specific SPL at startup and exposes only the operations that make sense for
that one line and its products.

## Files

1. [`01-splalm-overview.md`](./01-splalm-overview.md) — What SPLALM does, what
   an SPL is, what a product is, and how the synchronization flow works.
2. [`02-splalm-functionalities.md`](./02-splalm-functionalities.md) — Catalog
   of every SPLALM capability (REST routes → services), used as the raw
   inventory we pick MCP tools from.
3. [`03-mcp-architecture.md`](./03-mcp-architecture.md) — Architecture options
   (HTTP proxy vs. direct integration), configuration, GitLab authentication
   and transport.
4. [`04-mcp-tools.md`](./04-mcp-tools.md) — Detailed MCP tool catalog with
   input/output schemas, descriptions, error modes and the SPLALM operation
   each one wraps.
5. [`05-draft-operations.md`](./05-draft-operations.md) — Final, condensed
   draft of the operations the MCP will expose, grouped by area.
