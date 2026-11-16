# Read or set the Windows Mobile Hotspot the board joins.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows-hotspot.ps1 -Action state
#   ... -Action on
#   ... -Action off
#
# Windows exposes the hotspot through the NetworkOperatorTetheringManager WinRT
# API, not through `netsh wlan`, which is why this is PowerShell and why it
# needs the System.Runtime.WindowsRuntime assembly to await the async calls.
#
# Why it matters: the board has ONE network credential (the hotspot's SSID), so
# if the hotspot is switched off the board has no network at all -- its WiFi is
# not "down", there is simply nothing to join.  In this project that is the
# single failure that looks exactly like a dead board: no 192.168.137.x address
# on Windows, no ARP entry, nothing answering on the subnet.
#
# `state` is what scripts/relay.sh uses to say WHICH of the two it is: the
# hotspot is off (one toggle) or the hotspot is up and the board is not on it.

param(
    [ValidateSet('state', 'on', 'off')]
    [string]$Action = 'state'
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType=WindowsRuntime]
$null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType=WindowsRuntime]

$profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
if (-not $profile) {
    # No uplink to share.  The hotspot cannot be started in this state either.
    'hotspot=NoInternetProfile'
    exit 3
}

$manager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
$state = [string]$manager.TetheringOperationalState

function Await-Tethering($operation, $resultType) {
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
            $_.Name -eq 'AsTask' -and
            $_.GetParameters().Count -eq 1 -and
            $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
        })[0]
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
    # Bounded: a tethering operation that never completes must not hang a script
    # that an app start-up is waiting on.
    if (-not $task.Wait(20000)) { return $null }
    return $task.Result
}

switch ($Action) {
    'state' {
        "hotspot=$state"
        exit 0
    }
    'on' {
        if ($state -eq 'On') { 'hotspot=On'; exit 0 }
        $result = Await-Tethering $manager.StartTetheringAsync() ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
        if ($null -eq $result) {
            "hotspot_start=timeout hotspot=$([string]$manager.TetheringOperationalState)"
            exit 4
        }
        "hotspot_start=$($result.Status) $($result.AdditionalErrorMessage)"
        Start-Sleep -Seconds 2
        "hotspot=$([string]$manager.TetheringOperationalState)"
        exit 0
    }
    'off' {
        if ($state -eq 'Off') { 'hotspot=Off'; exit 0 }
        $result = Await-Tethering $manager.StopTetheringAsync() ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
        if ($null -eq $result) {
            "hotspot_stop=timeout hotspot=$([string]$manager.TetheringOperationalState)"
            exit 4
        }
        "hotspot_stop=$($result.Status)"
        Start-Sleep -Seconds 2
        "hotspot=$([string]$manager.TetheringOperationalState)"
        exit 0
    }
}
