import numpy as np
import sys
sys.path.insert(0, r"C:\Users\user\AppData\Local\Strata\install\third_party\llama.cpp\gguf-py")
import gguf

reader = gguf.GGUFReader(r"F:\Models\Qwen3.8-Flash-Next\Qwen3.8-Flash-Next-IQ3_XXS-00001-of-00003.gguf")
non_finite_count = 0
for t in reader.tensors:
    if any(k in t.name for k in ["hc_attn_down", "gate", "norm", "dense"]):
        try:
            val = gguf.quants.dequantize(t.data, t.tensor_type)
            if not np.isfinite(val).all():
                print("NON-FINITE:", t.name, t.tensor_type, "NaNs:", np.isnan(val).sum(), "Infs:", np.isinf(val).sum())
                non_finite_count += 1
        except Exception as e:
            print("Error on", t.name, e)

print("Total non-finite tensors found:", non_finite_count)
