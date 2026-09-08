"""婚宴費用估算：素食大人另計價位，不影響小孩與服務費邏輯。"""
from app.stage import banquet_estimate

PARAMS = {
    "adult_price": 4000,
    "service_pct": 10,
    "child_mode": "half",
    "child_price": 0,
    "child_free_below": 90,
    "child_half_below": 120,
    "veg_price": 3000,
}


def test_veg_adults_use_veg_price():
    est = banquet_estimate(PARAMS, adults=10, children=[], veg_adults=3)
    assert est["regular_adults"] == 7 and est["veg_adults"] == 3
    assert est["regular_subtotal"] == 7 * 4000
    assert est["veg_subtotal"] == 3 * 3000
    assert est["adult_subtotal"] == 7 * 4000 + 3 * 3000
    assert est["service"] == round(est["adult_subtotal"] * 0.1)
    assert est["total"] == est["adult_subtotal"] + est["service"]


def test_veg_price_zero_means_same_as_adult():
    est = banquet_estimate({**PARAMS, "veg_price": 0}, adults=10, children=[], veg_adults=3)
    assert est["veg_unit_price"] == 4000
    assert est["adult_subtotal"] == 10 * 4000


def test_veg_adults_never_exceed_adults():
    est = banquet_estimate(PARAMS, adults=2, children=[], veg_adults=5)
    assert est["veg_adults"] == 2 and est["regular_adults"] == 0


def test_children_unaffected_by_veg():
    kids = [{"height": 100, "pricing": "auto"}, {"height": None, "pricing": "auto"}]
    est = banquet_estimate(PARAMS, adults=4, children=kids, veg_adults=1)
    assert est["child_counts"] == {"free": 0, "half": 1, "full": 0, "custom": 0, "unknown": 1}
    assert est["child_subtotal"] == 2 * 2000


def test_custom_child_mode_applies_to_all_children_except_manual_override():
    kids = [{"height": 80, "pricing": "auto"}, {"height": 150, "pricing": "auto"}, {"height": None, "pricing": "auto"}, {"height": 150, "pricing": "free"}]
    est = banquet_estimate({**PARAMS, "child_mode": "custom", "child_price": 2880}, adults=1, children=kids)
    assert est["child_counts"] == {"free": 1, "half": 0, "full": 0, "custom": 3, "unknown": 0}
    assert est["child_subtotal"] == 3 * 2880
    assert est["service"] == round((4000 + 3 * 2880) * 0.1)
