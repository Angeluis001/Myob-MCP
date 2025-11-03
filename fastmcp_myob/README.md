MYOB Advanced MCP (FastMCP OpenAPI)

Run
- Install deps: pip install -r fastmcp_myob/requirements.txt
- Start (HTTP): python fastmcp_myob/server.py http
  - URL: http://127.0.0.1:8001/mcp
- Start (STDIO): python fastmcp_myob/server.py

Tools added on top of OpenAPI
- login(name, password, company, branch) -> cookie session
- logout() -> end session
- ping() -> connectivity check

Notes
- The OpenAPI file is read from REDBACK_TEST_API.json at repo root.
- The HTTP base_url is https://redback.myobadvanced.com/entity/Default/24.200.001
- Most endpoints are auto-exposed as Tools based on operationId names.

Tag filtering and multi-server setup
- You can dramatically reduce the registered tools by filtering the OpenAPI by tag(s).
- Configure via environment variables before starting the server:
  - MYOB_INCLUDE_TAGS: comma/semicolon separated list of tags to keep (e.g., "Salesperson,Shipment").
  - MYOB_EXCLUDE_TAGS: comma/semicolon separated list of tags to drop.
  - MYOB_MAX_TOOLS: integer cap to limit total operations (e.g., 200).
  - MYOB_MODE: "full" (default) or "auth". In "auth" mode, only the helper tools are exposed (login/logout/ping).
  - MYOB_DISABLE_AUTH_TOOLS: set to "true" to hide login/logout/ping from non-auth servers.
  - MYOB_SERVER_NAME: optional override for the server display name.
  - PORT / HOST / MYOB_HTTP_PATH: network overrides when using http transport.

Examples (PowerShell)
- Start an auth-only server on port 8000:
  - $env:MYOB_MODE = "auth"; $env:PORT = "8000"; python fastmcp_myob/server.py http
- Start a server limited to the Salesperson tag on port 8001:
  - $env:MYOB_INCLUDE_TAGS = "Salesperson"; $env:PORT = "8001"; python fastmcp_myob/server.py http
- Start another server for Shipment on port 8002:
  - $env:MYOB_INCLUDE_TAGS = "Shipment"; $env:PORT = "8002"; python fastmcp_myob/server.py http

Register multiple servers in your mcp.json by pointing each entry to the different ports. Optionally keep the auth-only server separate.
