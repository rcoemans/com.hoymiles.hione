I want to test the quality, skills and capabilities of Claude Code.
To do this I want you to completely rewrite the Homey App this repo is about.

Some important background documentation you should process for the best results:

Reports containing important background information: 'reports\'
Reference repo: 'reference-repo\homey-app-hoymiles-hione-main\'
Older reference documents, perhaps these provides meaningful background information: 'change_requests\'

Main changes I want compared to the current app:

1. I want to make use of the API end-points as much as possible during the device creation process, like for example:
  - To lists the plants belonging to the account
  - When a plant is selected, lists the devices bleonging to the plant, each of the devices should be able to be installed seperately
  - Pull in capabilities automatically where possibl, for example for retrieving the modes
2. Instead of a single device, I want to be able to create multiple devices as among others is explained in the document: 'change_requests\hoymiles_hione_homey_main_child_device_model.md'. like:
  - DTU / DTS
  - Inverter
  - Gateway
  - Batteries
3. Options to fill in Cloud API details and Local (LAN) details where both: Protobuf and Modbus are supported, this is for the DTU / DTS device as this is the device via which the information is retrieved. 
4. Option to select: Local (LAN), Hybrid (local + cloud) and Cloud only, remains but default will always be Cloud (in case of Hybrid or Cloud only) and fallback is Local (LAN).
5. For each device to be created the details like: Appliance, Model, Serial number, Firmware version and Hardware version needs to be filled in.
6. The child devices (Inverter, Gateway, Batteries) will make use of the DTU / DTS device for data.
7. I want to show a help text for API URL in which all endpoints are shown, the default endpoint for EU needs to be pre-filled in.
8. Each device will have its own settings like for example:
  - Name
  - Icon
  - Status indicator
  - Zone
  - Systeminfo
    - Appliance
    - Model
    - Serial number
    - Firmware version
    - Hardware version
  - Energy
  - Remarks
9. The DTU / DTS device also will have among others:
  - Connection mode:
    - Local (LAN)
    - Hybrid (local + cloud)
    - Cloud only
  - Local (LAN):
    - IP address
    - connection type:
      - Protobuf
      - Modbus
    - Port
    - Modbus Unit-ID (default 101)
  - Cloud:
    - Username
    - Password
    - API URL
  - Poll interval
10. Each device should have the relevant:
  - Sliders
  - Modes
  - Capabilities
  - Status indicators
  - Flow cards: When, And, Then
  - Logic
11. On app settings I want to have a very good utility for Diagnostics, this utility should be usefull for reverse engineering, should be able to be used for Protobug and Modbus, to correlate to Cloud API (as for the API we have the best information). It should be possible to select diagnostics output (CTRL+A, CTRL+C) but also having buttons like: Start, Stop, Export, Copy, Clear. If other tools are needed for reverse engineering or there is a better method, please advise. At the end it should simply work and be a clean and understanble tool or set of tools. Important: in order to prevent unnecessary processing these tools like: validations. diagnostics, logging should be either triggered manually or if they need to run, it needs to be able to manually start and stop them.

As mentioned the files under: 'reports\' contains lots of important information, which ideally already should allow you to nearly perfectly create the app.

Once done, do not forget to update README.md, README.txt and README.nl.txt.

Important: always check the Homet SDK v3 in order to stay on par with the Homey requirements for everything including: do's and don'ts for README.txt and README.nl.txt, do's and don'ts for images etc. etc.

Important: the 'plant' in total should be a battery device for Homey so it integrates with Homey Energy!

If there is anything I need to provide let me know.

Please act as a senior architect, tech lead, front-end developper and business anylist while doing your work!

***JUST FOR REFERENCE***

# HoyMile HiOne App

## App config

- S-Miles Cloud Username
- S-Miles Cloud Password
- Login/Logout
- Local (LAN):
  - IP address
  - connection type:
    - Proto...
    - Modbus
  - Port
  - Modbus Unit-ID (default 101)
- Cloud:
  - Username
  - Password
  - API URL
- Save 
- Validation tool

## Device settings fields

- Name
- Icon
- Status indicator
- Zone
- Connection mode:
  - Local (LAN)
  - Hybrid (local + cloud)
  - Cloud only
- Local (LAN):
  - IP address
  - connection type:
    - Protobuf
    - Modbus
  - Port
  - Modbus Unit-ID (default 101)
- Cloud:
  - Username
  - Password
  - API URL
- Poll interval
- Systeminfo
  - Appliance
  - Online/Offline
  - Model
  - Serial number
  - Firmware version
  - Hardware version
  - 
- Energy
- Remarks

## Status indicators

- Any Alarm
- Battery (Accuvermogen (+laden / -ontladen)
- Battery Power (Accustroom)
- Total Energy Generated
- Energy Charged (Accu geladen)
- Energy Discharged (Accu ontladen)
- Generic Alarm
- Last Update
- None (geen)

## Sliders

- Reserve SoC (Reserve laadniveau (ondergrens accu))
- Max SoC (Max laadniveau (bovengrens accu))
- Max Power (Max laadvermogen (Force Chager))
- (Max ontlaadvermogen (Force Discharge)))
- Grid Power Limit (Netvermoegensgrens (pieksturing))

## Modes

- Self-consumption (Eigen verbruik)
- Economy (Economie)
- Backup (Noodstroom)
- Off-Grid (Off-Grid)
- Self-Consumption + Max Power (Force Charge (geforceerd laden))?
- Backup + Max Power (Force Discharge (geforceerd ontladen))?
- Peak Shaving (Pieksturing)
- Time of Use (Tijdafhankelijk)

## Capabilities

- Battery Power (Accuvermoegen (+laden / -ontladen))
- (Accustroom)
- (Accu geladen)
- (Accu ontladen)
- Total Energy Generated ()
- Energy Charged ()
- Energy Discharged ()
- PV Power (Zonnepaneelvermogen)
- Grid Power (Netvermogen)
- Load Power (Belastingsvermogen)
- Daily Energy (Dagelijkse energy)
- Mobthly Energy (Maandelijkse energie)
- Yearly Energy (Jaarlijkse energie)
- Total Energy (Totale energie)
- CO2 Reduction (CO2 besparing)
- Profit Today (Besparing vandaag)
- Profit Total (Besparing totaal)
- Battery Charge Power ()
- Battery Discharge Power ()
- Grid Import Power ()
- Grid Export Power ()
- Battery State ()
- Grid State ()
- Generic Alarm ()
- Self-Powered ()
- Battery Runtime ()
- Time to Full ()
- Power Balance ()
- Energy Independence ()
- System State ()
- Connection Source ()
- Gateway Online ()
- Last Update ()

## Flow cards When

- The Power Changed
- Battery State of Charge becomes greather than
- Battery State of Charge becomes less than
- The battery level changed
- Battery Power becomes greather than
- Battery Power becomes less than
- Total Energy Generated becomes greather than
- Total Energy Generated becomes less than
- The power meter changed
- Energy Charged becomes greather than
- Energy Charged becomes less than
- Energy Discharged becomes greather than
- Energy Discharged becomes less than
- The generic alarm turned on
- The generic alarm turned off
- Battery mode changed
- Battery SoC rose above
- Battery SoC dropped below
- Battery SoC changed
- Battery started charging
- Battery started discharging
- Battery stopped charging
- Battery stopped discharging
- Connection source changed
- Gateway came online
- Gateway went offline
- Grid started exporting
- Grid started importing
- PV production started
- PV production stopped

## Flow cards And

- The generic alarm is on
- Battery is charging
- Battery is discharging
- Battery mode is
- Battery SoC is above
- Battery SoC is below
- Connection is local (LAN)
- Connection is cloud
- Gateway is online
- Grid is exporting power
- Grid is importing power
- Load power is above
- PV power is above

## Flow cards Then

- Disable cloud fallback
- Enable cloud fallback
- Prefer cloud connection
- Prefer local connection
- Disable local fallback
- Enable local fallback
- Refresh data now
- Set battery mode to
- Set grid power limit to
- Turn inverter
- Set max charge/discharge power to
- Set max SoC to
- Set Peak Shaving reerve
- Set Inverter power limit to
- Turn relay
- Set reserve SoC to
- Set Time of Use charge from ... to ... at ...

## Logic

- Battery State of Charge
- Battery Power
- Total Energy Generated
- Energy Charged
- Energy Discharged
- PV Power
- Battery Power
- Grid Power
- Load Power
- Reserve SoC
- Max SoC
- Max Power
- Grid Power Limit
- Daily Energy
- Monthly Energy
- Yearly Energy
- Total Energy
- CO2 Reduction
- Profit Today
- Profit Total
- Battery Charge Power
- Battery Discharge Power
- Grid Import Power
- Grid Export Power
- Self-Powered
- Battery Runtime
- Time to Full
- Power Balance
