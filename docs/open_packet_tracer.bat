@echo off
set "PT_PATH=C:\Program Files\Cisco Packet Tracer 9.0.0\bin\PacketTracer.exe"
set "PKT_FILE=%~dp0campus-topology.pkt"

if not exist "%PT_PATH%" (
    echo [ERROR] Cisco Packet Tracer executable not found at "%PT_PATH%"
    pause
    exit /b 1
)

if exist "%PKT_FILE%" (
    echo Launching Cisco Packet Tracer with %PKT_FILE%...
    start "" "%PT_PATH%" "%PKT_FILE%"
) else (
    echo Launching Cisco Packet Tracer...
    echo (Once built, save your project as: %PKT_FILE%)
    start "" "%PT_PATH%"
)
