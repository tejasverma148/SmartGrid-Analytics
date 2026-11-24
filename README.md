# SmartGrid Analytics — Multi-Profile Energy Management Prototype (v7)

**Final academic prototype | Backend, native analytics and responsive web interface**

SmartGrid Analytics demonstrates editable energy monitoring for two property types:

- **Campus / College:** laboratories, classrooms, library, administration, hostels, canteen, auditorium, sports and common areas.
- **Residential / Home:** living room, bedrooms, kitchen, work/study area, bathrooms, laundry and outdoor/shared spaces.

Both profiles share the same calculation, monitoring, analytics and simulation engine.

## Prototype boundary

All readings, area energy figures, equipment allocations and tariffs are simulated. There is no physical smart meter, IoT device, appliance connection or MITS infrastructure integration. This is not a certified electrical protection system. Edits are held in server memory for the current run and reset when the server restarts.

## What can be edited

### Areas & equipment

Select an area and change all three values:

1. **Daily energy (kWh):** affects daily property energy, projected monthly units and the estimated bill.
2. **Peak power (W):** changes the area's peak input and the total capacity used to generate the demand sample series.
3. **Area warning threshold (W):** compared directly with the area's entered peak power. If peak power exceeds this threshold, an area-level alert is raised.

Saving an area updates the server state, regenerates the demand sample series without unexpectedly resetting a selected scenario, reruns analytics and redraws the interface. The frontend no longer refreshes the entire page every five seconds, so form values are not overwritten while editing.

### Tariff & thresholds

- **Tariff (₹/kWh):** changes the estimated bill, not consumption.
- **Normal threshold (W):** upper limit of the normal band.
- **Overload threshold (W):** readings above this value are classified as potential overload. It must be greater than the normal threshold.

Readings at or below the normal threshold are Normal. Readings above Normal and at or below Overload are High Consumption. Readings above Overload are Potential Overload. Saving settings immediately reclassifies the current readings and updates the alerts, counts and analytics.

## Simulation Lab: how the controls work

The four preset buttons are controlled **input patterns**, not manual alert toggles. They create sample power readings:

- **Normal usage:** stable baseline pattern.
- **High consumption:** sustained elevated demand.
- **Power spike:** one sharp high point in the sample series.
- **Potential overload:** repeated high demand points.

After a pattern is applied, the analytics system automatically compares every reading with the saved thresholds. The system then changes the detected condition, dashboard status, reading table, graph, peak/average, trend and active alerts. The selected pattern is simply a way to create test data for demonstrating the detection workflow.

The **Add a simulated load** control adds a chosen wattage to the sample readings and calculates extra daily energy as:

`Added energy (kWh/day) = watts × operating hours ÷ 1,000`

This additional energy is included in the monthly estimate and estimated bill. It is a what-if demonstration, not a live appliance measurement.

## Automatic alerts

The Alerts page now contains only active conditions:

- An overall high or overload alert when the generated readings cross the profile thresholds.
- An area-level warning when an area's entered peak power exceeds its editable area warning threshold.
- A rising-trend warning when the average of the second half of the sample series is more than 5% above the first half.

When no condition is active, the page explicitly displays **No active alerts**. Informational notes and the largest-area insight are not counted as active alerts.

## Analytics and trend output

The C++ module calculates average power, peak power, first/second-half average, trend and demand-band counts. It also provides a **next-sample estimate** using a simple linear-regression projection of the short sample series. This is a basic statistical estimate, not a trained appliance-recognition ML model or a long-term energy forecast.

If the C++ executable cannot be started, the Java backend calculates the same core indicators using a fallback implementation. This avoids hiding trend analysis just because the native executable is unavailable. The response identifies which analysis path was used.

## Why this is not yet Sense-style machine learning

Sense-like appliance identification is a Non-Intrusive Load Monitoring (NILM) problem. It relies on electrical signatures and repeated operating patterns, often using much higher-resolution current/voltage measurements than the 12 aggregate sample points used here. A credible implementation would need suitable meter/sensor data, timestamped history, device labels or validation data, model training and measured accuracy. This prototype has none of those ingredients, so it does not claim to identify appliances with ML. It is a future extension, not an implemented feature.

## Technology and data flow

1. The browser edits a profile or starts a simulation.
2. The Java HTTP server validates and stores the updated in-memory profile, calculates energy/bill estimates and generates sample demand readings.
3. Java passes the readings and saved thresholds to the C++ executable.
4. C++ calculates statistics, threshold-band counts, trend and next-sample estimate.
5. The browser refreshes the dashboard, graphs, analytics and active alerts from the updated response.

## APIs

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Backend health and version |
| `/api/state` | GET | Active profile, areas, thresholds, readings and derived totals |
| `/api/profile?id=campus` or `home` | POST | Switch active profile |
| `/api/area?id=...&dailyKWh=...&peakW=...&thresholdW=...` | POST | Edit area energy, peak power and area warning threshold |
| `/api/settings?tariff=...&normal=...&overload=...` | POST | Update tariff and overall demand thresholds |
| `/api/scenario?mode=...` | POST | Generate a preset sample input pattern |
| `/api/simulate?watts=...&hours=...` | POST | Add a simulated load and operating hours |
| `/api/analytics` | GET | Run C++ analytics or Java fallback |
| `/api/metrics` | GET | Lightweight server request and runtime metrics |

## Run on Windows

1. Extract the complete ZIP into a normal folder.
2. Double-click `RUN_ON_WINDOWS.bat`.
3. The script compiles the C++ program and Java backend, then starts the server.
4. Open `http://localhost:8080`.
5. Keep the command window open. Press `Ctrl+C` to stop the server.
6. To run automated tests, stop the server and double-click `RUN_TESTS_WINDOWS.bat`.

JDK 17+ and GCC/G++ C++17 are required. The batch files include the previously configured MSYS2 UCRT64 path `C:\msys64\ucrt64\bin`.

## Mobile access

With the computer and phone on the same trusted Wi-Fi network, find the computer's local IPv4 address using `ipconfig` and open `http://COMPUTER-IP:8080` on the phone. Allow Java through Windows Firewall on a Private network only if prompted. Do not expose this academic demo to a public network.

## Test status

The included test suite has **34 automated checks** and is run with `RUN_TESTS_LINUX.sh` in the development environment. It verifies Java/C++ compilation, C++ analytics, Java fallback analytics, profile changes, all three area inputs, tariff and thresholds, scenario-triggered automatic detection, custom load calculations, endpoint validation and frontend files. Windows laptop and physical mobile-browser verification still need to be performed on the target devices.


## Open on a phone (same Wi-Fi)

The server listens on all network interfaces so another device on the same local network can reach it.

1. Connect the Windows computer and phone to the same Wi-Fi network.
2. On the computer, open Command Prompt and run `ipconfig`.
3. Under the active Wi-Fi adapter, note the `IPv4 Address` (often similar to `192.168.1.5`). Do not use `127.0.0.1` or `localhost` on the phone.
4. On the phone, open `http://YOUR-IP:8080`, replacing `YOUR-IP` with the computer's IPv4 address.
5. If Windows asks, allow Java on **Private networks**. If it does not ask and the page cannot load, a Windows Firewall inbound rule for TCP port 8080 on Private networks may be required.

Both devices must be on the same local network; guest Wi-Fi, mobile data, VPNs or router client-isolation can prevent access. This is local-network access only, not a public internet link.

## User display name

Click the profile identity at the bottom of the sidebar to edit the displayed name. It is stored in that browser's local storage and does not change the Campus/Home property profile or any project data.


### Final interface polish

- The name at the bottom of the sidebar is editable. Click it to change the displayed user name; it is saved in that browser and does not change the active property profile.
- Demand charts colour each segment according to the corresponding reading classification and display normal/overload threshold guides.
- Trend analysis explains the percentage difference between the first-half and second-half averages.
- The configuration page is named **Tariff & thresholds**.


## 3D Digital Twin upgrade

The web interface now includes a dedicated **3D Digital Twin** navigation page. It renders a roof-open property model from 3D room, wall, floor and equipment geometry in the browser, without requiring a separate package installation or external CDN. Room colours reflect each area's configured peak threshold; animated energy pulses run from the simulated meter hub to each room.

**Controls:** drag the model to rotate, scroll to zoom, click a room to inspect its daily energy, peak demand, status and equipment allocation. Use **Reset view** to restore the camera. The model updates when the Campus / Residential profile or editable area values change. All values remain simulated academic-prototype data.

For the 3D Digital Twin controls and technical details, see `docs/3D_DIGITAL_TWIN_GUIDE.md`.
The untouched source archive supplied for this upgrade is retained at `backup/Original_Milestone_5_Pristine.zip`.
