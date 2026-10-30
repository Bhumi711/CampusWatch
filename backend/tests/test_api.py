from sqlalchemy import select

from app.models import Alert


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_summary_from_seeded_demo(client, seeded):
    assert seeded["seeded"] is True
    s = client.get("/api/v1/summary").json()
    assert s["source_mode"] == "demo" and s["synthetic"] is True
    assert s["devices"] == {"total": 15, "online": 13, "offline": 1, "unknown": 1}
    assert s["traffic"]["in_bps"] > 0 and s["utilization"]["links_with_capacity"] > 0


def test_seeding_is_idempotent(client, seeded, db):
    from app.services import seed
    assert seed.seed_demo(db)["seeded"] is False
    assert len(client.get("/api/v1/devices").json()) == 15


def test_device_filters_and_detail(client, seeded):
    off = client.get("/api/v1/devices", params={"status": "offline"}).json()
    assert [d["name"] for d in off] == ["ADMIN-PRN-01"]
    assert off[0]["in_bps"] is None  # unavailable, not zero
    stu = client.get("/api/v1/devices", params={"q": "stu-"}).json()
    assert {d["location_name"] for d in stu} == {"Student Area"}
    host = next(d for d in client.get("/api/v1/devices").json() if d["name"] == "ACAD-LAB-PC-01")
    detail = client.get(f"/api/v1/devices/{host['id']}").json()
    assert detail["interfaces"][0]["capacity_bps"] is None and detail["interfaces"][0]["utilization_pct"] is None
    assert client.get("/api/v1/devices/99999").status_code == 404
    m = client.get(f"/api/v1/devices/{host['id']}/metrics", params={"range": "1h"}).json()
    assert m["interfaces"][0]["points"] and m["system"]


def test_traffic_and_locations(client, seeded):
    assert client.get("/api/v1/metrics/traffic", params={"range": "3y"}).status_code == 422
    t1 = client.get("/api/v1/metrics/traffic", params={"range": "1h"}).json()
    t24 = client.get("/api/v1/metrics/traffic", params={"range": "24h"}).json()
    assert t1["bucket_seconds"] == 60 and t24["bucket_seconds"] == 900
    assert len(t1["points"]) > 30 and len(t24["points"]) > 80
    locs = client.get("/api/v1/locations").json()
    assert {l["name"]: (l["subnet"], l["vlan"]) for l in locs}["Academic Block"] == ("192.168.10.0/24", 10)
    by_loc = client.get("/api/v1/metrics/traffic/by-location", params={"range": "6h"}).json()
    assert len(by_loc["groups"]) == 4
    top = client.get("/api/v1/metrics/top", params={"range": "24h", "by": "device", "limit": 3}).json()
    totals = [t["avg_in_bps"] + t["avg_out_bps"] for t in top]
    assert len(top) == 3 and totals == sorted(totals, reverse=True)


def test_seeded_anomalies_are_explained(client, seeded):
    page = client.get("/api/v1/alerts", params={"category": "traffic_anomaly", "limit": 100}).json()
    assert page["total"] > 0
    a = page["items"][0]
    assert a["baseline"] and a["observed_value"] > a["baseline"] and "σ" in a["message"]
    assert client.get("/api/v1/alerts", params={"severity": "bogus"}).status_code == 422


def test_acknowledge_persists(client, seeded, db):
    a = client.get("/api/v1/alerts", params={"acknowledged": "false", "limit": 1}).json()["items"][0]
    r = client.post(f"/api/v1/alerts/{a['id']}/acknowledge")
    assert r.status_code == 200 and r.json()["acknowledged_at"]
    db.expire_all()
    assert db.get(Alert, a["id"]).acknowledged_at is not None
    assert client.get(f"/api/v1/alerts/{a['id']}").json()["acknowledged_at"] == r.json()["acknowledged_at"]
    assert client.post("/api/v1/alerts/999999/acknowledge").status_code == 404


def test_settings_validation(client):
    assert client.patch("/api/v1/settings", json={"poll_interval_seconds": 1}).status_code == 422
    assert client.patch("/api/v1/settings", json={"congestion_warning_pct": 95}).status_code == 422  # > critical
    assert client.patch("/api/v1/settings", json={"unknown": 1}).status_code == 422
    r = client.patch("/api/v1/settings", json={"poll_interval_seconds": 15})
    assert r.status_code == 200 and client.get("/api/v1/settings").json()["poll_interval_seconds"] == 15
    client.patch("/api/v1/settings", json={"poll_interval_seconds": 10})


def test_interface_capacity_override(client, seeded):
    row = next(i for i in client.get("/api/v1/interfaces").json() if i["capacity_bps"] is None)
    r = client.patch(f"/api/v1/interfaces/{row['id']}", json={"capacity_bps": 1e9}).json()
    assert r["capacity_bps"] == 1e9 and r["capacity_source"] == "configured"
    r = client.patch(f"/api/v1/interfaces/{row['id']}", json={"capacity_bps": None}).json()
    assert r["capacity_bps"] is None and r["capacity_source"] is None
    assert client.patch(f"/api/v1/interfaces/{row['id']}", json={"capacity_bps": -5}).status_code == 422


def test_snmp_secrets_never_returned_and_failures_reported(client, seeded, db):
    secret = "s3cret-community-xyz"
    bad = client.post("/api/v1/devices", json={"name": "x", "address": "not a host!", "snmp_community": secret})
    assert bad.status_code == 422
    assert client.post("/api/v1/devices", json={"name": "x", "address": "10.0.0.1"}).status_code == 422  # no community

    # SNMP mode with no targets -> honest collector error, no crash
    assert client.patch("/api/v1/settings", json={"collection_mode": "snmp"}).status_code == 200
    run = client.post("/api/v1/collector/poll").json()
    assert run["success"] is False and "no enabled SNMP targets" in run["error"]

    r = client.post("/api/v1/devices", json={"name": "LAB-SW", "address": "127.0.0.1", "snmp_port": 9,
                                             "snmp_version": "2c", "snmp_community": secret})
    assert r.status_code == 201 and secret not in r.text and r.json()["snmp"]["has_community"] is True
    dev_id = r.json()["id"]
    assert secret not in client.get("/api/v1/devices", params={"source": "all"}).text

    run = client.post("/api/v1/collector/poll").json()  # nothing listens on udp/9
    assert run["devices_failed"] == 1 and run["success"] is False and secret not in str(run)
    dev = client.get(f"/api/v1/devices/{dev_id}").json()
    assert dev["status"] == "offline" and dev["status_reason"]
    cats = {a["category"] for a in client.get("/api/v1/alerts", params={"source": "snmp"}).json()["items"]}
    assert {"device_unavailable"} <= cats
    status = client.get("/api/v1/collector/status").json()
    assert status["mode"] == "snmp" and status["last_run"]["details"][0]["device"] == "LAB-SW"

    test = client.post(f"/api/v1/devices/{dev_id}/test").json()
    assert test["reachable"] is False and test["error"]

    # demo data is not mixed into the snmp view
    assert client.get("/api/v1/summary").json()["devices"]["total"] == 1
    client.patch("/api/v1/settings", json={"collection_mode": "demo"})
    assert client.delete(f"/api/v1/devices/{dev_id}").status_code == 204


def test_ml_status_is_honest(client, seeded):
    d = client.post("/api/v1/detection/ml/train").json()["isolation_forest"]
    assert d["trained"] and d["synthetic"] and "SYNTHETIC" in d["message"] and d["score_threshold"]


def test_destructive_actions_need_confirmation(client):
    assert client.post("/api/v1/demo/reset", json={"confirm": False}).status_code == 400
    assert client.post("/api/v1/demo/clear", json={}).status_code == 422
