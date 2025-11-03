import json
import os
import sys
from copy import deepcopy
from pathlib import Path
from typing import Dict, List, Optional, Set

import httpx
from fastmcp import FastMCP, Context

# Paths and configuration
ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = os.getenv(
    "MYOB_OPENAPI_PATH",
    str(ROOT / "REDBACK_TEST_API.json"),
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

def _parse_csv_env(name: str) -> Optional[List[str]]:
    raw = os.getenv(name)
    if not raw:
        return None
    # allow comma or semicolon separators
    items = [x.strip() for x in raw.replace(";", ",").split(",")]
    items = [x for x in items if x]
    return items or None


def filter_openapi_by_tags(
    spec: Dict,
    include_tags: Optional[List[str]] = None,
    exclude_tags: Optional[List[str]] = None,
    max_operations: Optional[int] = None,
) -> Dict:
    """Return a shallow-copied OpenAPI spec filtered by operation tags.

    - Keep only operations that match include_tags (if provided)
    - Drop operations that match exclude_tags (if provided)
    - Optionally cap the total number of kept operations
    """
    include: Optional[Set[str]] = set(t.strip() for t in include_tags) if include_tags else None
    exclude: Optional[Set[str]] = set(t.strip() for t in exclude_tags) if exclude_tags else None

    new_spec = deepcopy(spec)
    new_paths: Dict = {}
    kept = 0

    for path, path_item in spec.get("paths", {}).items():
        # Each method is an operation object (get/post/put/delete/patch/options/head)
        new_item = {}
        for method, op in path_item.items():
            if method.lower() not in ("get", "post", "put", "delete", "patch", "options", "head"):
                continue
            tags = set(op.get("tags", []) or [])

            if include is not None and tags.isdisjoint(include):
                continue
            if exclude is not None and not tags.isdisjoint(exclude):
                continue

            if max_operations is not None and kept >= max_operations:
                continue

            new_item[method] = op
            kept += 1

        if new_item:
            new_paths[path] = new_item

    new_spec["paths"] = new_paths
    return new_spec


def build_mcp_from_env() -> FastMCP:
    """Build a FastMCP server instance based on env configuration.

    Env options:
    - MYOB_INCLUDE_TAGS: comma/semicolon-separated list of tags to include
    - MYOB_EXCLUDE_TAGS: comma/semicolon-separated list of tags to exclude
    - MYOB_MAX_TOOLS: integer cap for number of operations exposed
    - MYOB_MODE: "full" (default) or "auth" (auth-only server)
    - MYOB_SERVER_NAME: override server name
    """
    # Load base spec
    with open(SPEC_PATH, "r", encoding="utf-8") as f:
        base_spec = json.load(f)

    mode = os.getenv("MYOB_MODE", "full").lower()
    include_tags = _parse_csv_env("MYOB_INCLUDE_TAGS")
    exclude_tags = _parse_csv_env("MYOB_EXCLUDE_TAGS")
    max_tools_raw = os.getenv("MYOB_MAX_TOOLS")
    max_tools = int(max_tools_raw) if (max_tools_raw and max_tools_raw.isdigit()) else None

    if mode == "auth":
        # Empty paths; auth tools will be added below
        filtered_spec = deepcopy(base_spec)
        filtered_spec["paths"] = {}
        name = os.getenv("MYOB_SERVER_NAME", "MYOB Advanced (Auth)")
    else:
        filtered_spec = filter_openapi_by_tags(
            base_spec, include_tags=include_tags, exclude_tags=exclude_tags, max_operations=max_tools
        )
        # Derive a short name
        if include_tags and len(include_tags) == 1:
            default_name = f"MYOB Advanced ({include_tags[0]})"
        elif include_tags:
            default_name = f"MYOB Advanced (tags: {', '.join(include_tags[:5])}{'…' if len(include_tags) > 5 else ''})"
        else:
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

        @mcp.tool
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

        @mcp.tool
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

        @mcp.tool
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
