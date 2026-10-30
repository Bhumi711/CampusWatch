"""SNMP v2c/v3 polling of IF-MIB counters (pysnmp 7, asyncio). Failures are reported per device, never faked."""
import asyncio
import time
from datetime import datetime

from pysnmp.hlapi.v3arch.asyncio import (CommunityData, ContextData, ObjectIdentity, ObjectType, SnmpEngine,
                                         UdpTransportTarget, UsmUserData, bulk_walk_cmd, get_cmd,
                                         usmAesCfb128Protocol, usmAesCfb256Protocol, usmDESPrivProtocol,
                                         usmHMAC192SHA256AuthProtocol, usmHMACMD5AuthProtocol,
                                         usmHMACSHAAuthProtocol)

from app.collectors.base import CollectionResult, DeviceReading, DeviceTarget, InterfaceReading
from app.core.config import env

AUTH_PROTOCOLS = {"MD5": usmHMACMD5AuthProtocol, "SHA": usmHMACSHAAuthProtocol, "SHA256": usmHMAC192SHA256AuthProtocol}
PRIV_PROTOCOLS = {"DES": usmDESPrivProtocol, "AES": usmAesCfb128Protocol, "AES256": usmAesCfb256Protocol}

SYS_DESCR, SYS_UPTIME = "1.3.6.1.2.1.1.1.0", "1.3.6.1.2.1.1.3.0"
IF_COLUMNS = {
    "descr": "1.3.6.1.2.1.2.2.1.2", "type": "1.3.6.1.2.1.2.2.1.3", "speed": "1.3.6.1.2.1.2.2.1.5",
    "oper": "1.3.6.1.2.1.2.2.1.8", "in32": "1.3.6.1.2.1.2.2.1.10", "out32": "1.3.6.1.2.1.2.2.1.16",
    "name": "1.3.6.1.2.1.31.1.1.1.1", "in64": "1.3.6.1.2.1.31.1.1.1.6", "out64": "1.3.6.1.2.1.31.1.1.1.10",
    "high_speed": "1.3.6.1.2.1.31.1.1.1.15",
}
HR_PROCESSOR_LOAD = "1.3.6.1.2.1.25.3.3.1.2"
CISCO_CPU_1MIN = "1.3.6.1.4.1.9.9.109.1.1.1.1.7"
HR_STORAGE = {"type": "1.3.6.1.2.1.25.2.3.1.2", "units": "1.3.6.1.2.1.25.2.3.1.4",
              "size": "1.3.6.1.2.1.25.2.3.1.5", "used": "1.3.6.1.2.1.25.2.3.1.6"}
HR_STORAGE_RAM = "1.3.6.1.2.1.25.2.1.2"
OPER_STATUS = {1: "up", 2: "down", 3: "testing", 5: "dormant", 6: "notPresent", 7: "lowerLayerDown"}
SOFTWARE_LOOPBACK = 24


def auth_data(t: DeviceTarget):
    if t.snmp_version == "3":
        if not t.snmp_username:
            raise ValueError("SNMPv3 requires a username")
        kwargs = {}
        if t.snmp_auth_key:
            kwargs.update(authKey=t.snmp_auth_key, authProtocol=AUTH_PROTOCOLS[t.snmp_auth_protocol or "SHA"])
            if t.snmp_priv_key:
                kwargs.update(privKey=t.snmp_priv_key, privProtocol=PRIV_PROTOCOLS[t.snmp_priv_protocol or "AES"])
        return UsmUserData(t.snmp_username, **kwargs)
    if not t.snmp_community:
        raise ValueError("SNMPv2c requires a community string")
    return CommunityData(t.snmp_community, mpModel=1)


class SnmpSession:
    def __init__(self, engine: SnmpEngine, t: DeviceTarget):
        self.engine, self.target, self.auth = engine, t, auth_data(t)
        self.transport = None

    async def open(self):
        self.transport = await UdpTransportTarget.create(
            (self.target.address, self.target.snmp_port), timeout=env.snmp_timeout_seconds, retries=env.snmp_retries)

    async def get(self, *oids: str) -> list:
        err_ind, err_status, _, var_binds = await get_cmd(
            self.engine, self.auth, self.transport, ContextData(), *[ObjectType(ObjectIdentity(o)) for o in oids])
        if err_ind:
            raise ConnectionError(str(err_ind))
        if err_status:
            raise RuntimeError(err_status.prettyPrint())
        return [v for _, v in var_binds]

    async def walk(self, oid: str) -> dict[int, object]:
        """Column walk -> {last OID component (row index): value}. Missing column -> {}."""
        out = {}
        async for err_ind, err_status, _, var_binds in bulk_walk_cmd(
                self.engine, self.auth, self.transport, ContextData(), 0, 25,
                ObjectType(ObjectIdentity(oid)), lexicographicMode=False):
            if err_ind:
                raise ConnectionError(str(err_ind))
            if err_status:
                break
            for name, val in var_binds:
                if val.__class__.__name__ in ("NoSuchObject", "NoSuchInstance", "EndOfMibView"):
                    continue
                out[int(name[-1])] = val
        return out


def _num(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


async def poll_device(engine: SnmpEngine, t: DeviceTarget) -> tuple[DeviceReading, dict]:
    """Returns the reading plus diagnostic info (sysDescr, latency) for the connection test."""
    started = time.monotonic()
    try:
        s = SnmpSession(engine, t)
        await s.open()
        descr, _uptime = await s.get(SYS_DESCR, SYS_UPTIME)
    except Exception as exc:
        return DeviceReading(t.id, False, f"Unreachable or rejected: {exc or type(exc).__name__}"), {}
    info = {"sys_descr": str(descr)[:200], "latency_ms": round((time.monotonic() - started) * 1000, 1)}
    try:
        cols = {k: await s.walk(oid) for k, oid in IF_COLUMNS.items()}
    except Exception as exc:
        return DeviceReading(t.id, False, f"IF-MIB walk failed: {exc}"), info
    if not cols["descr"]:
        return DeviceReading(t.id, True, "Device answered but exposes no IF-MIB interfaces"), info

    ifaces = []
    for idx, descr in sorted(cols["descr"].items()):
        if _num(cols["type"].get(idx)) == SOFTWARE_LOOPBACK:
            continue
        hc = idx in cols["in64"] and idx in cols["out64"]
        high = _num(cols["high_speed"].get(idx))
        speed = _num(cols["speed"].get(idx))
        capacity = high * 1e6 if high else (speed if speed and speed < 4_294_967_295 else None)
        ifaces.append(InterfaceReading(
            name=str(cols["name"].get(idx) or descr)[:120],
            in_bytes=_num(cols["in64" if hc else "in32"].get(idx)),
            out_bytes=_num(cols["out64" if hc else "out32"].get(idx)),
            if_index=idx, oper_status=OPER_STATUS.get(_num(cols["oper"].get(idx)), "unknown"),
            speed_bps=capacity, counter_bits=64 if hc else 32))

    reading = DeviceReading(t.id, True, interfaces=ifaces)
    reading.cpu_pct, reading.memory_pct = await _cpu_mem(s)
    return reading, {**info, "interfaces": len(ifaces)}


async def _cpu_mem(s: SnmpSession) -> tuple[float | None, float | None]:
    """Best effort: HOST-RESOURCES-MIB, then Cisco CPU MIB. Unsupported -> None (shown as unavailable)."""
    cpu = mem = None
    try:
        loads = [_num(v) for v in (await s.walk(HR_PROCESSOR_LOAD)).values()] or \
                [_num(v) for v in (await s.walk(CISCO_CPU_1MIN)).values()]
        loads = [v for v in loads if v is not None]
        cpu = round(sum(loads) / len(loads), 1) if loads else None
        st = {k: await s.walk(oid) for k, oid in HR_STORAGE.items()}
        for idx, typ in st["type"].items():
            if str(typ) == HR_STORAGE_RAM and _num(st["size"].get(idx)):
                mem = round(_num(st["used"].get(idx)) / _num(st["size"][idx]) * 100, 1)
                break
    except Exception:
        pass
    return cpu, mem


class SnmpCollector:
    mode = "snmp"

    async def collect(self, targets: list[DeviceTarget], now: datetime) -> CollectionResult:
        if not targets:
            return CollectionResult(error="SNMP mode is active but no enabled SNMP targets are configured")
        engine = SnmpEngine()
        try:
            results = await asyncio.gather(*(poll_device(engine, t) for t in targets))
        finally:
            engine.close_dispatcher()
        return CollectionResult([r for r, _ in results])


async def test_target(t: DeviceTarget) -> dict:
    engine = SnmpEngine()
    try:
        reading, info = await poll_device(engine, t)
    finally:
        engine.close_dispatcher()
    return {"reachable": reading.reachable, "error": reading.error, **info,
            "cpu_pct": reading.cpu_pct, "memory_pct": reading.memory_pct}
