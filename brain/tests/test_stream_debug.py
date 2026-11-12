from src.models.thinking_guard import ThoughtStreamParser

parser = ThoughtStreamParser(max_thinking_tokens=256)
raw_response = """<thought>
- This is a real-time query requiring fresh weather data
- I'll fan out multiple search queries across different platforms for accuracy
- Need to verify the results before presenting to user
</thought>

I'm running parallel searches to get the most current temperature data for Westwood, LA from multiple sources:

<parallel_web_search queries=[["current temperature in Westwood Los Angeles right now", "weather Westwood CA live forecast", "Google weather Westwood LA today"]]>
"""

total_thought = ""
total_content = ""
for char in raw_response:
    t, c, fin = parser.process_chunk(char)
    total_thought += t
    total_content += c

print("THOUGHT LENGTH:", len(total_thought))
print("CONTENT LENGTH:", len(total_content))
print("CONTENT PREVIEW:", repr(total_content[:100]))
