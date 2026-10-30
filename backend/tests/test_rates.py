from app.services.rates import compute_rate, utilization


def test_rate_from_counter_delta():
    assert compute_rate(1_000, 2_250, 10) == 1_000.0  # 1250 B * 8 / 10 s


def test_no_rate_without_previous_reading_or_elapsed_time():
    assert compute_rate(None, 5_000, 10) is None
    assert compute_rate(1_000, 2_000, None) is None
    assert compute_rate(1_000, 2_000, 0) is None
    assert compute_rate(1_000, 2_000, -5) is None
    assert compute_rate(1_000, None, 10) is None


def test_counter_reset_is_unavailable_not_negative():
    assert compute_rate(10_000, 500, 10) is None  # 64-bit: reset (e.g. reboot)


def test_32bit_counter_wrap():
    assert compute_rate(2**32 - 100, 50, 1, counter_bits=32) == 150 * 8


def test_utilization_requires_capacity():
    assert utilization(50e6, 10e6, None) is None
    assert utilization(50e6, 10e6, 0) is None
    assert utilization(None, None, 100e6) is None
    assert utilization(50e6, 80e6, 100e6) == 80.0  # busiest direction
    assert utilization(None, 20e6, 100e6) == 20.0
