import json
import os
import sys
from pathlib import Path
from typing import Dict, Optional

import httpx
from fastmcp import FastMCP, Context

# Paths and configuration
ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = os.getenv(
    "MYOB_OPENAPI_PATH",
    str(ROOT / "REDBACK_TEST_API_short.json"),
)
BASE_URL = os.getenv(
    "MYOB_BASE_URL",
    "https://redback.myobadvanced.com/entity/Default/24.200.001",
)
LOGIN_URL = os.getenv("MYOB_LOGIN_URL", "https://redback.myobadvanced.com/entity/auth/login")
LOGOUT_URL = os.getenv("MYOB_LOGOUT_URL", "https://redback.myobadvanced.com/entity/auth/logout")


# Shared HTTP client using cookie jar. For simple single-user testing this is fine.
# For multi-user isolation, run a dedicated process per user.
client = httpx.AsyncClient(base_url=BASE_URL, headers={"Accept": "application/json"})


def build_mcp_from_env() -> FastMCP:
    """Build a FastMCP server instance based on env configuration.

    Env options:
    - MYOB_MODE: "full" (default) or "auth" (auth-only server)
    - MYOB_SERVER_NAME: override server name
    - MYOB_OPENAPI_PATH: path to the already-filtered OpenAPI JSON
    """
    # Load base spec
    with open(SPEC_PATH, "r", encoding="utf-8") as f:
        base_spec = json.load(f)

    mode = os.getenv("MYOB_MODE", "full").lower()

    if mode == "auth":
        # Empty paths; auth tools will be added below
        filtered_spec = {**base_spec, "paths": {}}
        name = os.getenv("MYOB_SERVER_NAME", "MYOB Advanced (Auth)")
    else:
        # Use spec as-is; any filtering/inlining should be done by the external script.
        filtered_spec = base_spec
        default_name = "MYOB Advanced (OpenAPI)"
        name = os.getenv("MYOB_SERVER_NAME", default_name)

    mcp = FastMCP.from_openapi(
        openapi_spec=filtered_spec,
        client=client,
        name=name,
        tags={"myob", "openapi"} if mode != "auth" else {"myob", "auth"},
    )

    # Always offer basic auth/connectivity helpers unless explicitly disabled
    if os.getenv("MYOB_DISABLE_AUTH_TOOLS", "false").lower() not in ("1", "true", "yes"):  # keep by default

        @mcp.tool()
        async def login(name: str, password: str, company: str, branch: str) -> dict:
            """Login to MYOB (cookie session). Required before calling other tools.
            Returns status code and any response JSON."""
            payload = {
                "name": name,
                "password": password,
                "company": company,
                "branch": branch,
            }
            resp = await client.post(
                LOGIN_URL, json=payload, headers={"Content-Type": "application/json"}
            )
            try:
                data = resp.json()
            except Exception:
                data = {"text": resp.text}
            return {"status_code": resp.status_code, "ok": resp.is_success, "data": data}

        @mcp.tool()
        async def logout() -> dict:
            """Logout current MYOB session and clear cookies."""
            global client
            resp = await client.post(LOGOUT_URL)
            # reset cookie jar (new client) to ensure state cleared
            try:
                await client.aclose()
            except Exception:
                pass
            client = httpx.AsyncClient(base_url=BASE_URL, headers={"Accept": "application/json"})
            return {"status_code": resp.status_code, "ok": resp.is_success}

        @mcp.tool()
        async def ping(ctx: Context) -> str:
            """Connectivity check for MYOB server and MCP transport."""
            await ctx.info(f"Base URL: {BASE_URL}")
            return "ok"

    return mcp


if __name__ == "__main__":
    # Build the server instance per env configuration (supports tag filtering and auth-only)
    mcp = build_mcp_from_env()

    # Choose transport: stdio (default), http, or sse
    transport = (sys.argv[1] if len(sys.argv) > 1 else "stdio").lower()
    if transport in ("http", "streamable-http"):
        # Serve on http://127.0.0.1:PORT/path (default: 8001, /mcp)
        path = os.getenv("MYOB_HTTP_PATH", "/mcp")
        mcp.run(
            transport="http",
            host=os.getenv("HOST", "127.0.0.1"),
            port=int(os.getenv("PORT", "8001")),
            path=path,
        )
    elif transport == "sse":
        mcp.run(transport="sse", host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8001")))
    else:
        # stdio
        mcp.run()
