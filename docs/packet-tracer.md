# Campus topology in Cisco Packet Tracer

Build the CampusWatch campus in Packet Tracer (8.x). It uses the dashboard's demo device names, VLANs and IPs,
so you can show the same network in both. Allow about 30 to 40 minutes. Copy each config block into the
device's **CLI** tab (or **Config → CLI**).

> Packet Tracer runs as a simulation, so CampusWatch on your laptop can't poll these devices. Demo SNMP from
> inside Packet Tracer with a PC's **MIB Browser** (step 6). Then show the dashboard in Demo mode, which uses the
> same campus. This is the honest split the project spec asks for.

## 1. Topology

```text
                              [ISP-RTR] 2911            (optional, simulates the Internet)
                                  │ Gi0/0  203.0.113.1/30
                                  │
                                  │ Gi0/0  203.0.113.2/30
                            [CORE-RTR-01] 2911          router-on-a-stick: gateway .1 of every VLAN, DHCP
                                  │ Gi0/1  trunk (VLAN 10,20,30,100)
                                  │
                                  │ Gi0/1
                            [CORE-SW-01] 2960-24TT      mgmt 10.10.0.2 (VLAN 100)
                ┌──────────────┬──┴───────────┬────────────────┐
           Fa0/1 trunk     Fa0/2 trunk    Fa0/3 trunk      Fa0/10 access VLAN 100
                │              │              │                │
          [ACAD-SW-01]   [ADMIN-SW-01]   [STU-SW-01]     [DC-SRV-01] Server 10.10.0.10
          VLAN 10        VLAN 20         VLAN 30          (HTTP "LMS", DNS)
          .10.2          .20.2           .30.2
           │ Fa0/2 ACAD-LAB-PC-01 .50     │ Fa0/2 ADMIN-WS-07 .57      │ Fa0/2 STU-AP-01  ))) laptops
           │ Fa0/3 ACAD-AP-01   )))       │ Fa0/3 ADMIN-AP-01  )))     │ Fa0/3 STU-AP-02  ))) phones
           │ Fa0/4 ACAD-AP-02   )))       │ Fa0/4 ADMIN-PRN-01 .40     │ Fa0/4 STU-AP-03  )))
                                          │ Fa0/5 NOC-PC .60 (MIB Browser)
```

| Campus area | VLAN | Subnet | Gateway | Switch mgmt | DHCP range | Dashboard colour |
|---|---|---|---|---|---|---|
| Academic Block | 10 | 192.168.10.0/24 | .1 | .2 | .100 to .254 | blue |
| Administration Block | 20 | 192.168.20.0/24 | .1 | .2 | .100 to .254 | orange |
| Student Area | 30 | 192.168.30.0/24 | .1 | .2 | .100 to .254 | green |
| Data Center | 100 | 10.10.0.0/24 | .1 | .2 | static only | violet |

Static addresses (outside the DHCP range): switches `.2`, lab PC `.50`, workstation `.57`, printer `.40`, NOC PC `.60`,
server `10.10.0.10`.

## 2. Place devices and cables

| Device (rename to this) | Packet Tracer model |
|---|---|
| CORE-RTR-01, ISP-RTR | Routers → **2911** |
| CORE-SW-01, ACAD-SW-01, ADMIN-SW-01, STU-SW-01 | Switches → **2960-24TT** |
| DC-SRV-01 | End Devices → **Server-PT** |
| ACAD-LAB-PC-01, ADMIN-WS-07, NOC-PC | End Devices → **PC-PT** |
| ADMIN-PRN-01 | End Devices → **Printer-PT** |
| ACAD-AP-01/02, ADMIN-AP-01, STU-AP-01/02/03 | Network Devices → Wireless → **AccessPoint-PT** |
| Wireless clients (2 or 3 per area) | **Laptop-PT** (swap its NIC for **WPC300N**: power off, drag the module out, drag WPC300N in, power on) or **Smartphone-PT** |

| From | Port | To | Port | Cable |
|---|---|---|---|---|
| ISP-RTR | Gi0/0 | CORE-RTR-01 | Gi0/0 | Copper cross-over |
| CORE-RTR-01 | Gi0/1 | CORE-SW-01 | Gi0/1 | Copper straight-through |
| CORE-SW-01 | Fa0/1 | ACAD-SW-01 | Gi0/1 | Copper cross-over |
| CORE-SW-01 | Fa0/2 | ADMIN-SW-01 | Gi0/1 | Copper cross-over |
| CORE-SW-01 | Fa0/3 | STU-SW-01 | Gi0/1 | Copper cross-over |
| CORE-SW-01 | Fa0/10 | DC-SRV-01 | Fa0 | Copper straight-through |
| ACAD-SW-01 | Fa0/2, Fa0/3, Fa0/4 | ACAD-LAB-PC-01, ACAD-AP-01, ACAD-AP-02 | Fa0 / Port 0 | Copper straight-through |
| ADMIN-SW-01 | Fa0/2, Fa0/3, Fa0/4, Fa0/5 | ADMIN-WS-07, ADMIN-AP-01, ADMIN-PRN-01, NOC-PC | Fa0 / Port 0 | Copper straight-through |
| STU-SW-01 | Fa0/2, Fa0/3, Fa0/4 | STU-AP-01, STU-AP-02, STU-AP-03 | Port 0 | Copper straight-through |

Presentation polish: use **Place Note** to label each area with its VLAN and subnet, and **Draw Rectangle** around
each area in the dashboard's colour.

## 3. Router configs

**CORE-RTR-01**

```text
enable
configure terminal
hostname CORE-RTR-01
no ip domain-lookup
!
interface GigabitEthernet0/0
 description ISP uplink
 ip address 203.0.113.2 255.255.255.252
 no shutdown
!
interface GigabitEthernet0/1
 description Trunk to CORE-SW-01
 no ip address
 no shutdown
!
interface GigabitEthernet0/1.10
 description Academic Block
 encapsulation dot1Q 10
 ip address 192.168.10.1 255.255.255.0
!
interface GigabitEthernet0/1.20
 description Administration Block
 encapsulation dot1Q 20
 ip address 192.168.20.1 255.255.255.0
!
interface GigabitEthernet0/1.30
 description Student Area
 encapsulation dot1Q 30
 ip address 192.168.30.1 255.255.255.0
!
interface GigabitEthernet0/1.100
 description Data Center
 encapsulation dot1Q 100
 ip address 10.10.0.1 255.255.255.0
!
ip dhcp excluded-address 192.168.10.1 192.168.10.99
ip dhcp excluded-address 192.168.20.1 192.168.20.99
ip dhcp excluded-address 192.168.30.1 192.168.30.99
!
ip dhcp pool ACADEMIC
 network 192.168.10.0 255.255.255.0
 default-router 192.168.10.1
 dns-server 10.10.0.10
ip dhcp pool ADMIN
 network 192.168.20.0 255.255.255.0
 default-router 192.168.20.1
 dns-server 10.10.0.10
ip dhcp pool STUDENT
 network 192.168.30.0 255.255.255.0
 default-router 192.168.30.1
 dns-server 10.10.0.10
!
ip route 0.0.0.0 0.0.0.0 203.0.113.1
!
snmp-server community campuswatch-ro RO
end
write memory
```

**ISP-RTR** (optional)

```text
enable
configure terminal
hostname ISP-RTR
no ip domain-lookup
interface GigabitEthernet0/0
 ip address 203.0.113.1 255.255.255.252
 no shutdown
interface Loopback0
 description Simulated Internet host
 ip address 8.8.8.8 255.255.255.255
ip route 192.168.0.0 255.255.0.0 203.0.113.2
ip route 10.10.0.0 255.255.255.0 203.0.113.2
end
write memory
```

## 4. Switch configs

**CORE-SW-01**

```text
enable
configure terminal
hostname CORE-SW-01
no ip domain-lookup
vlan 10
 name ACADEMIC
vlan 20
 name ADMIN
vlan 30
 name STUDENT
vlan 100
 name DATACENTER
exit
interface GigabitEthernet0/1
 description Trunk to CORE-RTR-01
 switchport mode trunk
interface range FastEthernet0/1 - 3
 description Trunks to building switches
 switchport mode trunk
interface FastEthernet0/10
 description DC-SRV-01
 switchport mode access
 switchport access vlan 100
 spanning-tree portfast
interface Vlan100
 ip address 10.10.0.2 255.255.255.0
 no shutdown
exit
ip default-gateway 10.10.0.1
snmp-server community campuswatch-ro RO
end
write memory
```

**ACAD-SW-01** (for ADMIN-SW-01 and STU-SW-01, use the table below the block)

```text
enable
configure terminal
hostname ACAD-SW-01
no ip domain-lookup
vlan 10
 name ACADEMIC
exit
interface GigabitEthernet0/1
 description Uplink to CORE-SW-01
 switchport mode trunk
interface range FastEthernet0/1 - 24
 switchport mode access
 switchport access vlan 10
 spanning-tree portfast
interface Vlan10
 ip address 192.168.10.2 255.255.255.0
 no shutdown
exit
ip default-gateway 192.168.10.1
snmp-server community campuswatch-ro RO
end
write memory
```

| Switch | hostname | VLAN (id + name) | Vlan interface IP | default gateway |
|---|---|---|---|---|
| ADMIN-SW-01 | `ADMIN-SW-01` | `20` / `ADMIN` | `192.168.20.2` | `192.168.20.1` |
| STU-SW-01 | `STU-SW-01` | `30` / `STUDENT` | `192.168.30.2` | `192.168.30.1` |

Copy the ACAD block and replace those values (`vlan`, `switchport access vlan`, `interface VlanXX`, IP, gateway).

## 5. End devices

| Device | Where (Desktop → IP Configuration, or Config) | Settings |
|---|---|---|
| DC-SRV-01 | IP Configuration | `10.10.0.10` / `255.255.255.0`, gateway `10.10.0.1`, DNS `10.10.0.10` |
| DC-SRV-01 | Services → HTTP | On (optionally edit `index.html` to say "Campus LMS") |
| DC-SRV-01 | Services → DNS | On; add A record `lms.campus.local` → `10.10.0.10` |
| ACAD-LAB-PC-01 | IP Configuration | `192.168.10.50`, gateway `.1`, DNS `10.10.0.10` |
| ADMIN-WS-07 | IP Configuration | `192.168.20.57`, gateway `.1`, DNS `10.10.0.10` |
| ADMIN-PRN-01 | Config → FastEthernet0 | `192.168.20.40` / `255.255.255.0`; Config → Settings: gateway `192.168.20.1` |
| NOC-PC | IP Configuration | `192.168.20.60`, gateway `.1`, DNS `10.10.0.10` |
| ACAD-AP-01/02 | Config → Port 1 | SSID `CAMPUS-ACAD`, WPA2-PSK, passphrase `academic123` |
| ADMIN-AP-01 | Config → Port 1 | SSID `CAMPUS-ADMIN`, WPA2-PSK, passphrase `admin1234` |
| STU-AP-01/02/03 | Config → Port 1 | SSID `CAMPUS-STUDENT`, WPA2-PSK, passphrase `student123` |
| Laptops / phones | Config → Wireless0 | the area's SSID + WPA2-PSK passphrase; IP Configuration → **DHCP** |

AccessPoint-PT is a layer-2 bridge with no management IP in Packet Tracer, so the AP addresses shown in the
dashboard (`.11`, `.12`, `.13`) are inventory labels only. The passphrases are lab placeholders; change them.

## 6. Verify (show these in the presentation)

On **CORE-RTR-01** and the switches:

```text
show ip interface brief        ! all subinterfaces up/up
show vlan brief                ! access ports in the right VLAN
show interfaces trunk          ! trunks carry 10,20,30,100
show ip dhcp binding           ! laptops/phones received addresses
```

From end devices (Desktop → Command Prompt):

```text
ping 192.168.10.1              ! own gateway
ping 10.10.0.10                ! inter-VLAN routing to the server
ping 192.168.30.100            ! another area (first DHCP lease in Student Area)
ping 8.8.8.8                   ! "Internet" (if ISP-RTR is built)
```

Browser on any client: `http://lms.campus.local` (DNS + HTTP on DC-SRV-01).

**SNMP inside Packet Tracer:** NOC-PC → Desktop → **MIB Browser** → Advanced: address `192.168.10.2` (ACAD-SW-01),
read community `campuswatch-ro`, version v2c → OK. Expand the MIB tree to `system` → `sysName` / `sysUpTime` and
press **GET**. Repeat for `10.10.0.2` or `192.168.20.1`. What the MIB Browser exposes depends on the Packet Tracer
version, which is why CampusWatch's SNMP mode targets real or simulated agents outside Packet Tracer
(see the README's *SNMP lab simulator*).

**Traffic for the story:** switch to **Simulation** mode, filter ICMP/HTTP, and send pings or browser requests to
show packets crossing the trunk and being routed between VLANs.

## 7. Map to the dashboard

| Packet Tracer | CampusWatch demo device | Address |
|---|---|---|
| CORE-RTR-01 | CORE-RTR-01 (Data Center) | 10.10.0.1 (gateway of every VLAN) |
| DC-SRV-01 | DC-SRV-01 "LMS server" | 10.10.0.10 |
| ACAD-SW-01, ACAD-AP-01/02, ACAD-LAB-PC-01 | same names (Academic Block) | 192.168.10.2 / .11 / .12 / .50 |
| ADMIN-SW-01, ADMIN-AP-01, ADMIN-WS-07, ADMIN-PRN-01 | same names (Administration Block) | 192.168.20.2 / .11 / .57 / .40 |
| STU-SW-01, STU-AP-01/02/03 | same names (Student Area) | 192.168.30.2 / .11 / .12 / .13 |
| CORE-SW-01, ISP-RTR, NOC-PC | not in the demo inventory | 10.10.0.2, 203.0.113.1, 192.168.20.60 |
| (not built) | DC-FW-01 firewall | optional: Packet Tracer's ASA 5506-X between CORE-RTR-01 Gi0/0 and ISP-RTR |

Suggested flow: show the Packet Tracer topology, run the pings and the MIB Browser GET, then open CampusWatch.
Its front panel shows the same switches, APs and VLANs, with synthetic traffic, and says so on screen.

Save the file as `campus-topology.pkt` (File → Save As) in this `docs/` folder so it ships with the project.
