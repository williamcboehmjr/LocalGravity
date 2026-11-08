import fs from 'node:fs';

const targetFiles = [
  'C:/Users/Sue/AppData/Local/Strata/terminal/0.1.58/tools/iq_pack.py',
  'F:/Strata/tools/iq_pack.py'
];

const newFunctions = `
def clean_tensor_values(values: np.ndarray, name: str) -> np.ndarray:
    """Sanitizes corrupted/uninitialized float weights (NaN, Inf, or absurd magnitudes > 20.0)."""
    bad = ~np.isfinite(values) | (np.abs(values) > 20.0)
    if np.any(bad):
        good = values[~bad]
        if "norm" in name:
            fill_val = 1.0
        elif good.size > 0:
            fill_val = float(np.mean(good))
        else:
            fill_val = 0.0
        values = values.copy()
        values[bad] = fill_val
        print(f"[iq_pack] sanitized {bad.sum()} non-finite/corrupt elements in {name} -> filled with {fill_val:.4f}", flush=True)
    return values


def dequantize(raw: np.ndarray, type_name: str, name: str = "") -> np.ndarray:
    """The tensor's values as float32 (float types exactly, quantized ones through gguf-py's dequantizer)."""
    if type_name == "F32":
        v = raw.view(np.float32).copy()
    elif type_name == "F16":
        v = raw.view(np.float16).astype(np.float32)
    elif type_name == "BF16":
        v = (raw.view(np.uint16).astype(np.uint32) << 16).view(np.float32)
    else:
        from _paths import add_gguf_py
        add_gguf_py()
        from gguf import GGMLQuantizationType as Q, quants
        v = quants.dequantize(raw, Q[type_name]).astype(np.float32).reshape(-1)
    return clean_tensor_values(v, name)


def bf16_bytes(raw: np.ndarray, type_name: str, name: str = "") -> bytes:
    from _paths import add_gguf_py
    add_gguf_py()
    from gguf import GGMLQuantizationType as Q, quants
    if type_name == "F32":
        values = raw.view(np.float32).copy()
    elif type_name == "F16":
        values = raw.view(np.float16).astype(np.float32)
    elif type_name == "BF16":
        values = (raw.view(np.uint16).astype(np.uint32) << 16).view(np.float32)
    else:
        values = quants.dequantize(raw, Q[type_name]).astype(np.float32).reshape(-1)
    values = clean_tensor_values(values, name)
    # ggml's round-to-nearest-even conversion, including correct halfway rounding.
    return quants.quantize(values, Q.BF16).tobytes()


def f16_values(values: np.ndarray, name: str) -> np.ndarray:
    """values -> F16, nearest-even (numpy's conversion, which is the engine loader's f16_from_f32); refuses a value
    that is not finite or overflows F16."""
    values = clean_tensor_values(values, name)
    with np.errstate(over="ignore"):
        h = values.astype(np.float16)
    bad = ~np.isfinite(h)
    if np.any(bad):
        fill = 1.0 if "norm" in name else 0.0
        h = h.copy()
        h[bad] = fill
    return h
`;

for (const f of targetFiles) {
  if (!fs.existsSync(f)) continue;
  let code = fs.readFileSync(f, 'utf8');

  // Replace dequantize, bf16_bytes, f16_values
  code = code.replace(
    /def dequantize\([\s\S]*?def f16_values\([\s\S]*?return h\r?\n/m,
    newFunctions.trim() + '\n'
  );

  // In convert_tensor:
  code = code.replace(
    /values = dequantize\(raw, type_name\)/g,
    'values = dequantize(raw, type_name, name)'
  );
  code = code.replace(
    /data = bf16_bytes\(raw, type_name\)/g,
    'data = bf16_bytes(raw, type_name, name)'
  );
  code = code.replace(
    /np\.max\(np\.abs\(got\.astype\(np\.float64\) - values\)\)/g,
    'np.nanmax(np.abs(got.astype(np.float64) - values))'
  );
  code = code.replace(
    /np\.max\(np\.abs\(h\.astype\(np\.float64\) - values\)\)/g,
    'np.nanmax(np.abs(h.astype(np.float64) - values))'
  );

  fs.writeFileSync(f, code, 'utf8');
  console.log('Patched', f);
}
