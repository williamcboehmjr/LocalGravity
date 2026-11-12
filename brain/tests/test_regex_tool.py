import re

samples = [
    '<parallel_web_search queries=[["current temperature in Westwood Los Angeles right now", "weather Westwood CA live forecast", "Google weather Westwood LA today"]]>',
    'parallel_web_search(queries=["temp in Westwood", "weather LA"])',
    'parallel_web_search(["temp in Westwood", "weather LA"])',
    '<parallel_web_search queries=["temp in Westwood"]>',
    'search_web("Westwood temperature")',
    '<search_web query="Westwood temperature">'
]

pattern = r'(?:<|\b)parallel_web_search(?:[\s\(]+(?:queries\s*=\s*)?|\s+queries\s*=\s*)\[([\s\S]*?)\]'

for s in samples:
    m = re.search(pattern, s)
    if m:
        raw_list = m.group(1)
        queries = [q.strip("\"' \t\n\r[]") for q in re.findall(r'["\']([^"\']+)["\']', raw_list)]
        queries = [q for q in queries if len(q) > 1]
        print(f"MATCHED parallel: {queries}")
    else:
        # single query
        s_match = re.search(r'(?:<|\b)(?:search_web|parallel_web_search)[\s\(]+(?:query\s*=\s*|queries\s*=\s*)?["\']([^"\']+)["\']', s)
        if s_match:
            print(f"MATCHED single: {[s_match.group(1)]}")
        else:
            print(f"FAILED: {s}")
