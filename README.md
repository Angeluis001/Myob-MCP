# MYob MCP

Public repository for the MYob MCP workspace.

## Project structure

- `REDBACK_TEST_API.json` — API configuration/test file
- `fastmcp_myob/` — FastMCP-based MYOB server
  - `server.py` — entry point
  - `requirements.txt` — Python dependencies
  - `README.md` — module-specific documentation

## Quick start

1. Create and activate a virtual environment (Windows PowerShell):
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```
2. Install dependencies:
   ```powershell
   pip install -r .\fastmcp_myob\requirements.txt
   ```
3. Run the server (example):
   ```powershell
   python .\fastmcp_myob\server.py http
   ```

## Notes
- The `.gitignore` excludes `.venv/` and typical Python artifacts.
- Update this README with setup instructions specific to your environment.
