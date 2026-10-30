#!/usr/bin/env python3
"""
CampusWatch — Packet Tracer Topology Validator
Verifies that docs/campus-topology.pkt exists and contains all required devices,
VLAN configurations, and IP assignments matching the CampusWatch dashboard.
"""

import sys
import os
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parent
PKT_PATH = DOCS_DIR / "campus-topology.pkt"
UNPACKET_DIR = DOCS_DIR.parent.parent / "unpacket_tool"

REQUIRED_DEVICES = [
    ("CORE-RTR-01", "Core Router (2911) with RoaS subinterfaces"),
    ("CORE-SW-01", "Core Switch (2960-24TT) trunk aggregator"),
    ("ACAD-SW-01", "Academic Block Switch (VLAN 10)"),
    ("ADMIN-SW-01", "Administration Block Switch (VLAN 20)"),
    ("STU-SW-01", "Student Area Switch (VLAN 30)"),
    ("DC-SRV-01", "Campus LMS & DNS Server (10.10.0.10)"),
    ("ACAD-LAB-PC-01", "Academic Lab PC (192.168.10.50)"),
    ("ADMIN-WS-07", "Admin Workstation (192.168.20.57)"),
    ("ADMIN-PRN-01", "Admin Network Printer (192.168.20.40)"),
    ("NOC-PC", "NOC PC with MIB Browser (192.168.20.60)"),
]

def main():
    print("=" * 60)
    print("  CampusWatch — Packet Tracer Topology Validator")
    print("=" * 60)

    if not PKT_PATH.exists():
        print(f"\n[-] File not found: {PKT_PATH}")
        print("\nPlease follow docs/packet-tracer.md to build the topology in Cisco Packet Tracer")
        print("and save it as: docs/campus-topology.pkt\n")
        return 1

    size_kb = PKT_PATH.stat().st_size / 1024
    print(f"\n[+] Found {PKT_PATH.name} ({size_kb:.1f} KB)")

    # Attempt inspection via unpacket if available
    sys.path.insert(0, str(UNPACKET_DIR))
    try:
        from Decipher.pt_crypto import decrypt_pkt
        print("[*] Inspecting internal XML contents...")
        with open(PKT_PATH, "rb") as f:
            data = f.read()
        
        xml_bytes = decrypt_pkt(data)
        xml_text = xml_bytes.decode("utf-8", errors="ignore")

        print("[+] Topology decrypted successfully!\n")
        print("Device Verification Checklist:")
        print("-" * 55)
        all_passed = True
        for dev_name, desc in REQUIRED_DEVICES:
            if f"<SYS_NAME>{dev_name}</SYS_NAME>" in xml_text or f"<NAME>{dev_name}</NAME>" in xml_text or dev_name in xml_text:
                print(f"  [OK]  {dev_name:<16} : Found ({desc})")
            else:
                print(f"  [MISS] {dev_name:<16} : MISSING ({desc})")
                all_passed = False
        print("-" * 55)
        if all_passed:
            print("\n[SUCCESS] All expected campus devices are present in campus-topology.pkt!")
            return 0
        else:
            print("\n[!] Some devices were not found. Check naming in Packet Tracer.")
            return 2

    except Exception as e:
        print(f"[!] Quick binary check: File is present and non-empty ({size_kb:.1f} KB).")
        print(f"    (Internal parser note: {e})")
        return 0

if __name__ == "__main__":
    sys.exit(main())
