I want to test the quality, skills and capabilities of Claude Code.
To do this I want you to fix all the issues/changes described in this document for the Homey App this repo is about.
Make sure to track so that you will work an all points!

Some important background documentation you should process for the best results:

Reports containing important background information: 'reports\'
Reference repo: 'reference-repo\homey-app-hoymiles-hione-main\'
Older reference documents, perhaps these provides meaningful background information: 'change_requests\'

## Overal

1. Make sure to privide help texts where needed, for example 'DTU Serial' is unclear so help text is welcome. Same for 'Modbus Unit-Id' and all other elements which needs explanation.

2. Make sure that everything is translated in the supported languages NL and EN.

## App Settings

1. There is no option to switch between NL and EN languages, this needs to be added.

2. There is an option for testing the Cloud Login, which works, but I also want to keep these settings (save) so when installing the main device 'station' there is no need to provide these details (username and password) again. Also I want to be able to logoff here.

3. I want to be able to overwrite the Hoymiles API (neapi.homymiles.com), for example when I want to use enapi.hoymiles.com api instead.

4. The diagnostics section allows me to provide: Gateway IP, Interval (sec), Modbus unit-id and DTU serial, but also here there is no option to store these setting s (save).

5. I want to be able to overwrite the Modbus (502) and Protobuf (10081) ports.

6. The snapshot shows 'protocol: null', this needs to be fixed.

7. The snapshot shows the gatewayIp but not the Modbus and Protobuf ports used, this needs to be added.

8. The snapshot contains many Modbus connect timeouts and Econnrefused. This needs to be analyzed and fixed.

9. I am not able to copy the exported snapshots, this copy button needs to be added.

10. I want a diagnostics report to be added which will be based on the collected snapshots. I think about som table which lists all fields retrieved via the API and then has columns for Modbus and Protobuf where it tries to map the API fields to the Modbus and Protobuf fields. Also columns needs to be added like: number of snapshots for this field, the latest values for API, Modbus and Protobuf, the differences, the likelyhood the mapping is correct in percentage etc. Please think about something meaningful yourself. Goal for this report is to have a tool which helos to reverse engineer the Modbus and Protobuf interfaces.

## Creating devices

1. Currently all availble Hoymiles HiOne devices are having the save Hoymiles logo as the image, I want to have different and meaningful images for each of the devices:
- HiOne Battery
- HiOne Gateway
- HiOne Inverter
- HiOne Station

## Creating HiOne Station

1. Most buttons are grey but I want all buttons to be green when you are good to continue, for example:
- In the login screen when Email address and Password has been given, the 'Log in' button needs to become green.
- In the select station screen once a station has been selected, the 'Next' button needs to become green.
- In the Local LAN Configuration screen the same logic needs to be applied. Be aware that based on 16. the logic for making the button green could be a bit more complex as also the connection mode needs to be checked.

2. Although in the login screen there is a button to switch between NL and EN, in the select station screen this button is not there and it always defaults to EN. I need to be able to switch language in all screens.

3. In local lan configuration screen I need to choose between Modbus or Protobuf but I am not sure if this is the correct approach, based on your advice and what can be seen in the reports under 'reports\', it could make more sense that in case local lan is used (in modes: Hybrid (Cloud + Local) and Local Only) that Modbus and Protobuf works together in order to be able to retrieve all required data locally.

4. Although here I can overwrite the port, in case we will decide to use Modbus and Protobuf together, I need to be able to see and overwrite the ports for both.

5. I don't like the option 'Skip (Cloud Only)', I rather want to have the Local LAN section to be shown only in case for 'Connection Mode' either Hybrid (Cloud + Local) or Local Only is selected.

6. Currently it is not possible at all to continue (Next) in case of Hybrid (Cloud + Local) or Local Only has been selected for connection mode, even though all required fields are having a value, this seems to be an issue which has to be fixed.

7. In the README's (README.md, README.txt and README.nl.txt(, which by the way you also have to update accordingly at the end, it is described (at least in the README.md) that in hybrid mode, the primairy source is Modbus/Protobuf and the fallback is API, this needs to be the other way arround, by defualt fetch all data using API and only when API is unavailable the fallback to Modbus/Protobuf.

8. When the device is created it simply says 'Coemans' which is the name of my plant. Instead I want to have the ID being added e.g. '{plant name} ({id})' > 'Coemans (14076570)'

## Creating HiOne Battery, HiOne Gateway or HiOne Inverter

1. This is not possible, it does find my parent station but when selecting the station and select 'Next', the error is shown: 'No new devices have been found.', likely there is an issue with the API endpoint used to pull in the devices, please consult the documents under 'reports\' to get this fixed.

2. Not sure what the names currently are for these devices when being added but do note that I have multiple batteries thus adding some identifier like the serial number, seems to make sense.

## Using the created HiOne Station

1. The 'System info' section does not contain data for the fields: Model, Serial Number, Firmware version, Hardware version. Likely there is an issue with the API endpoint for getting these details, also I can imagine this approach (seperated fields for all data elements) is not the most convenient as for the other HoyMiles HiOne devices, we might have other system details we want to show. Going forward make it a single multiline field similar to 'Connected devices' where all the system details for the device are added.

2. I don't see energy options like 'Exclude from ...' or 'Constant power usage (Watt)', not sure if this is needed but please check against the Homey SDK and fix if needed.

3. Not all data is retrieved, for exmaple the battery SoC is not shown (which is the most important aspect of a battery). You cna check the reference code to see how it was done here: 'reference-repo\homey-app-hoymiles-hione-main\'

4. The whole connection section needs to be revised and matching the device creation wizzard. I can agree with the fact that the API username and password not shown here, as this can be done at app level. But it should take over the gateway IP from either app level or what was given during the app creation. Also here if we decide that Modbus and Protobuf will be used together, this also needs to be reflected here. On app level there is a field for 'DTU Serial' which is missing here.

5. The sliders (e.g. Reserve SoC, Max SoC, Max Power Charge, Max Discharge Power and Grid Power Limit) are not showing the current values, which makes it hard to use these sliders in order to adjust the current values.

6. Currently all 8 modes (e.g. Self-consumption, Economy, Backup, Off-Grid, Self-Consumption, Backup + Max Power, Peak Shaving, Time of Use) are shown, likely this is hardcoded. Instead of hardcoding this I want you to use the API endpoint to retrieve the supported modes for the station.

7. The current mode is not highlighted, likely as this data element is not retrieved.

8. For the capabilities I wnt you to check if a) we have all and b) if there is room to add new 'derived' ones. Please be creative, think what is relevant and add these. Please also check against the list below if we have all. Please check the reports under 'reports\' and the reference repo to make sure all these capabilities will work:
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

9. Please check if we have these status indicators:
- Any Alarm
- Battery (Accuvermogen (+laden / -ontladen)
- Battery Power (Accustroom)
- Total Energy Generated
- Energy Charged (Accu geladen)
- Energy Discharged (Accu ontladen)
- Generic Alarm
- Last Update
- None (geen)

10. I want to understand what alarm turned on, currently I only see the When flow cards 'The generic alarm turned on' and 'The generic alarm turned off', but I would like to know what the error is by either a tag being part of these flow cards or by some logic. Please check if this can be retrieved, if not then do not add functionality for it as it will not work.

11. Check below if we have all the flow cards:

### Flow cards When

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

### Flow cards And

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

### Flow cards Then

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

12. Check below if we have all the logic elements:

### Logic

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
