"""Estimate saved storage, not RAM and not training VRAM."""
from .config import TARGET

# Strict decimal gigabytes, including runtime and memory allocation.
MAX_BYTES = 5_000_000_000

# File envelope with conservative overhead; budget is a planning bound,
# NOT a measured model artifact size.
ALLOCATIONS = {
    'quantized_core_4bit_and_scales': 1_800_000_000,
    'independent_multimodal_encoders': 600_000_000,
    'memory_index_and_database': 800_000_000,
    'weight_edits_and_version_history': 200_000_000,
    'runtime_and_tools': 500_000_000,
    'reserve': 800_000_000,
}

def budget_report():
    n = TARGET.parameter_count()
    raw_4bit = (n * 4 + 7) // 8
    total = sum(ALLOCATIONS.values())
    return {
        'target_parameters': n,
        'ideal_packed_4bit_bytes': raw_4bit,
        'storage_budget_bytes': total,
        'limit_bytes': MAX_BYTES,
        'fits_planned_budget': total <= MAX_BYTES,
        'allocations': ALLOCATIONS,
        'note': 'Not a trained checkpoint. 4bit estimate ignores kernel support and runtime memory.'
    }
