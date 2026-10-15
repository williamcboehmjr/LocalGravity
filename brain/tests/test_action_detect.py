from src.agent.loop import AgentSession

class Dummy:
    _detect_tool_call = AgentSession._detect_tool_call

content = """<thought>
I need to get real-time weather data for zip code 90024. My training data isn't current, so I must use the live web search capability immediately.
</thought>

<action>
parallel_web_search(queries=["current temperature Los Angeles 90024", "weather now LA CA"])
</action>"""

tool = Dummy()._detect_tool_call(content)
print("DETECTED TOOL:", tool)
assert tool is not None
assert tool["name"] == "parallel_web_search"
assert len(tool["args"]["queries"]) == 2
print("SUCCESS: Tool properly detected!")
