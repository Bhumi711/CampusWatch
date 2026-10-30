"""Counter-delta rate and utilization maths. Returns None whenever a value cannot be derived honestly."""

COUNTER32_WRAP = 2**32


def compute_rate(prev_bytes: int | None, curr_bytes: int | None, elapsed_s: float | None,
                 counter_bits: int = 64) -> float | None:
    """rate_bps = (current - previous) * 8 / elapsed. None for first poll, zero/negative elapsed or counter reset."""
    if prev_bytes is None or curr_bytes is None or elapsed_s is None or elapsed_s <= 0:
        return None
    delta = curr_bytes - prev_bytes
    if delta < 0:
        if counter_bits != 32 or prev_bytes >= COUNTER32_WRAP:
            return None  # 64-bit counters don't wrap in practice: treat as a reset (device reboot)
        delta += COUNTER32_WRAP  # 32-bit SNMP counter wrapped once
    return delta * 8 / elapsed_s


def utilization(in_bps: float | None, out_bps: float | None, capacity_bps: float | None) -> float | None:
    """Full-duplex utilization = busiest direction / capacity. None when capacity is unknown."""
    if not capacity_bps or capacity_bps <= 0:
        return None
    rates = [r for r in (in_bps, out_bps) if r is not None]
    if not rates:
        return None
    return max(rates) / capacity_bps * 100
