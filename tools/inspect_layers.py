import sys
sys.path.insert(0, r"C:\Users\Sue\AppData\Local\Strata\install\third_party\llama.cpp\gguf-py")
import gguf

reader = gguf.GGUFReader(r"F:\Models\Qwen3.8-Flash-Next\Qwen3.8-Flash-Next-IQ3_XXS-00001-of-00003.gguf")
for k, field in reader.fields.items():
    if any(s in k.lower() for s in ["block", "layer", "expert", "arch"]):
        print(f"{k} = {field.contents()}")
