"""透過已安裝的 Blender MCP 呼叫工具，保留可重現的建模來源。"""
import argparse
import asyncio
import json
import os
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", required=True)
    parser.add_argument("--tool", default="get_scene_info")
    parser.add_argument("--code-file")
    parser.add_argument("--output")
    args = parser.parse_args()
    env = {**os.environ, "BLENDER_HOST": "127.0.0.1", "BLENDER_PORT": "9876", "BLENDER_MCP_DISABLE_TELEMETRY": "1"}
    parameters = StdioServerParameters(command=args.server, env=env)
    async with stdio_client(parameters) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            payload = {"user_prompt": "製作台北美福 2F 大宴會廳場地，不含桌椅，保留既有使用者場景。"}
            if args.code_file:
                project_root = str(Path(__file__).resolve().parents[1])
                payload["code"] = f"WEDDING_PROJECT_ROOT = {project_root!r}\n" + Path(args.code_file).read_text(encoding="utf-8")
            result = await session.call_tool(args.tool, payload)
            texts = [c.text for c in result.content if c.type == "text"]
            output = json.dumps({"isError": result.isError, "content": texts}, ensure_ascii=False)
            if args.output:
                Path(args.output).write_text(output, encoding="utf-8")
            print(output)
            if result.isError or any(t.startswith("Error") for t in texts):
                raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
