# Operation and the exhibition

## Startup order

1. Power the router (the local Wi-Fi network; internet is optional).
2. Put the reservoir water in place, with the probes at the minimum level and
   the pump intake under water.
3. Power the ESP32 from the 5 V power bank. The serial log prints its IP.
4. Start the laptop:
   ```bash
   ./scripts/launch.sh
   ```
5. Open the printed URL, usually <http://127.0.0.1:8010/>.
6. Check the **Setup** checklist before the audience arrives.

During the exhibition, do not change Wi-Fi modes or power-cycle the router.

### Powering the board without the laptop

The USB cable is only power once the image is flashed. To free the laptop:

- use a **phone charger or 5 V power bank** into the board's USB port, or
- feed a regulated **5 V** into `VIN`/`5V` and `GND`.

Never put 5 V on the `3V3` pin, and never feed external 5 V while the USB data
cable is also plugged into the laptop. If the router gives the board a different
address after a reboot, update `VILLAGE_DEVICE_URL` in `.env` and restart the
backend; Windows can also resolve `village.local`.

Firmware can be updated over Wi-Fi once the board is on the network — see
`docs/installation.md` (“Updating firmware without the USB cable”).

## What the dashboard shows

- **What the village is doing and why** — the controller's own reason, such as
  “Soil is dry and water is available. Watering for a short pulse.” or
  “Irrigation blocked: reservoir water is low.”
- **Soil moisture** — a calibrated relative percentage, state and age.
- **Reservoir** — Available / Low only. It is not a tank gauge.
- **Pump** — commanded state, mode, session reason and cumulative runtime.
- **Streetlights** — mode, Bright/Dark and commanded state.
- **Bins** — estimated fill height and state; unavailable stays unavailable.
- **Connection** — live, stale, disconnected, last update and last error.
- **AI services** — whether Whisper and the waste model are ready.
- **Recent activity** — commands, recognitions, alerts and connection events.

A green “accepted” means the controller decided. It does **not** prove that
water physically flowed. The dashboard keeps the two statements separate.

## The safe demonstration sequence

1. **Dashboard.** Point out the reason panel, then the soil, reservoir and bin
   cards. Say clearly that the tank has two probes, not a level sensor.
2. **Streetlights.** Show **Auto**, cover the LDR (or press the demo Night
   button in Demo mode) and watch the state change after the stable delay.
   Show Manual On and Off, then return to Auto.
3. **Irrigation.** Press **Start irrigation** only if the soil is dry and the
   reservoir is available. The controller may refuse with a reason — that is a
   feature, not a failure. Point out the pulse → soak → re-check sequence.
   Press **Stop irrigation** to show the immediate stop.
4. **Waste camera.** Hold a plastic item in front of the camera. The stable
   prediction lights the plastic LED. Move it away; show that repeated frames
   do not count as new items. Point out that recognition is not proof of
   disposal.
5. **Voice.** Press the microphone, speak one command, show the recognised text
   and the matched command. Try “do not start irrigation” to show that a
   negated request is refused without action.
6. **Activity.** Show the command log and the recognition event.
7. **Demo mode (optional).** Turn it on for a fast scenario demonstration:
   Dry soil, Low water, Night, Fill a bin. The banner says simulated data and
   physical controls are disabled. Never leave Demo mode on for the real
   hardware part of the talk.

## Buttons and what they mean

| Control | Effect |
| --- | --- |
| Start irrigation | Sends `IRRIGATION_REQUEST`; the controller applies every safety check. |
| Stop irrigation | Sends `IRRIGATION_STOP`; the pump stops immediately. Always visible during a session. |
| Lights Auto / On / Off | Sends `LIGHTS_AUTO`, `LIGHTS_ON` or `LIGHTS_OFF`. Auto uses the LDR. |
| Voice command | Push-to-talk, maximum 10 seconds. |
| Waste camera | Opens the local camera classifier. |
| Demo mode | Simulated readings and simulated commands only. |

## Voice commands

Supported in English, Malayalam and Hindi:

- village status
- lights on
- lights off
- automatic lights
- soil moisture
- start irrigation
- stop irrigation
- water availability
- bin status
- help

Push-to-talk is deliberate: the app does not listen continuously. It rejects
unsupported, ambiguous and negated phrases with the exact support sentence.
Whisper is speech-to-text only; replies are prepared text, optional local
recordings, or the browser's own voice. If a language voice is unavailable,
the app says so rather than using a remote service.

Malayalam and Hindi recognition must be tested with the child's actual speech.
The phrase dictionary is `shared/intents.json`; add the words the child really
uses, then re-run the backend.

## Shutdown

```bash
./scripts/stop.sh
```

This stops only the PIDs recorded by `launch.sh`. Then power off the ESP32 and
the router. The ESP32 starts with the pump OFF next time; it never resumes an
interrupted session.

## Honest data

The village does not measure tank percentage, litres, household consumption,
pump pressure, flow, battery charge, solar/wind generation or energy savings.
Those figures never appear. The solar panels, windmill and model buildings are
static display models.
