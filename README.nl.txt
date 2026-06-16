Monitor en bedien je Hoymiles HiOne all-in-one batterijopslagsysteem vanuit Homey.

FUNCTIES
- Realtime monitoring: PV-vermogen, batterij laadniveau, batterij laad-/ontlaadvermogen, netimport/-export (gesigneerd en gesplitst), thuisverbruik, systeemalarmen
- Energietotalen: dag-, maand-, jaaropbrengst en totaalopbrengst
- Financieel & milieu: winst vandaag/totaal, CO2-reductie
- Instelbare batterijparameters: Reserve SoC, Max SoC, Max vermogen, Netlimiet schuifregelaars op apparaatkaart
- Berekende inzichten: zelfvoorzieningspercentage, batterijlooptijd/laadtijd-schattingen, vermogensbalans, energieonafhankelijkheid
- Batterijmodusbesturing via Flows: Eigen verbruik, Economie, Noodstroom, Off-Grid, Eigen verbruik + Max vermogen, Noodstroom + Max vermogen, Pieksturing, Tijdafhankelijk
- Flow triggers: batterij laden/ontladen statuswijzigingen, SoC-drempels, netstatus wijzigingen, PV-productie, gatewaystatus, verbindingsbron wijzigingen
- Flow condities: batterij laden/ontladen, SoC boven/onder drempel, PV-/belastingsvermogen drempels, net importeren/exporteren, batterijmodus, gateway online, verbinding lokaal
- Flow acties: batterijmodus instellen, reserve SoC, max SoC, max vermogen, netlimiet, pieksturing, tijdafhankelijke periode, vermogenslimiet, omvormerstatus, relais, data vernieuwen, voorkeur lokaal/cloud, cloud-fallback in-/uitschakelen
- Drie verbindingsmodi: Lokaal (LAN), Lokaal + Cloud (aanbevolen), of alleen Cloud
- Modbus TCP-ondersteuning voor DTS-G3 sticks (poort 502) — automatische terugval wanneer protobuf niet beschikbaar is (alleen PV-vermogen + gevalideerde energie; ESS-registers niet in kaart gebracht, onbetrouwbare data wordt overgeslagen om cloudwaarden te behouden)
- Homey Energy integratie: homeBattery met meter_power.charged en meter_power.discharged voor batterij-energietracking
- Cloud-login afgehard: wachttijd na mislukte pogingen (tot 12 uur bij accountblokkade) om je S-Miles-account te beschermen
- Diagnostiek: Quick Scan (bekende blokken), Deep Scan (volledig 0x0000–0xFFFF), ESS Probe (experimentele batterijregister-ontdekking)

VEREISTEN
- Homey Pro (2019 of 2023) met firmware >= 10.0.0
- Hoymiles HiOne all-in-one BESS met HiBox-63T-G3 gateway (of DTS-G3 stick voor Modbus TCP)
- Voor cloud/hybride modus: een actief S-Miles Cloud account
- Voor lokale modus: het IP-adres van de HiBox gateway op je LAN

APPARAAT TOEVOEGEN
1. Open de Homey app en ga naar Apparaten
2. Tik op + en zoek naar "Hoymiles HiOne"
3. Selecteer HiOne Station
4. Kies je verbindingsmodus:
   - Lokaal (LAN): voer het IP-adres en de poort (standaard 10081) van je HiBox gateway in
   - Lokaal + Cloud: voer het gateway IP en de poort in en log daarna in met je S-Miles Cloud inloggegevens
   - Alleen Cloud: log in met je S-Miles Cloud e-mail en wachtwoord
5. Selecteer je station uit de lijst
6. Data wordt elke 60 seconden vernieuwd

HIBOX IP-ADRES VINDEN
Controleer de beheerpagina van je router onder verbonden apparaten. Zoek naar een apparaat genaamd DTUBI-... of HiBox.
De lokale verbinding gebruikt standaard TCP-poort 10081 (configureerbaar tijdens koppeling en in apparaatinstellingen).
Tip: gebruik Lokaal + Cloud voor de beste ervaring.

APPARAATNAAM
De apparaatnaam weerspiegelt de verbindingsmodus:
  Lokaal:  {Plantnaam} (Local {IP})    bijv. Coemans (Local 192.168.1.116)
  Hybride: {Plantnaam} (Hybrid {IP})   bijv. Coemans (Hybrid 192.168.1.116)
  Cloud:   {Plantnaam} (Cloud)          bijv. Coemans (Cloud)

APPARAATINSTELLINGEN
Na het koppelen kun je de verbindingsmodus (Lokaal, Hybride of alleen Cloud), S-Miles Cloud e-mail en wachtwoord, gateway IP/poort en poll-interval bekijken en wijzigen in het apparaatinstellingen-scherm — opnieuw koppelen is niet nodig. De verbindingsmodus bepaalt welke databron het apparaat gebruikt. Apparaatinfo-secties (DTU, Omvormer, Gateway/HiBox, Batterij) tonen serienummer, model, firmware- en hardwareversie (alleen-lezen, gevuld vanuit cloud API en/of lokale gateway). Het apparaat tolereert tot 2 opeenvolgende fouten voordat het als niet-beschikbaar wordt gemarkeerd (met de specifieke foutreden), en herstelt automatisch wanneer de verbinding terugkomt.

APP-INSTELLINGEN
De app-instellingenpagina (Homey > Apps > Hoymiles HiOne > Instellingen) laat je app-brede standaardinstellingen configureren en diagnostische logs bekijken. De logging-sectie toont de laatste 200 logregels met knoppen om te vernieuwen, kopiëren en wissen. De diagnostiek-sectie bevat drie Modbus TCP-tools (gebruikt het app-niveau Gateway IP):
  Quick Scan: controleert bekende DTU-Pro registerblokken + ESS-kandidaatblokken
  Deep Scan: test alle 65.536 registers met ASCII-decodering, signed-interpretatie en FC03/FC04-testen
  ESS Probe: test kandidaat-batterij/net-registerblokken met strikte plausibiliteitsvalidatie
Opmerking: Modbus TCP levert alleen bevestigd PV-vermogen en gevalideerde energiedata. De HiBox gateway volgt NIET de DTU-Pro registerindeling — onbetrouwbare energiewaarden worden automatisch gedetecteerd en overgeslagen om clouddata te behouden. Batterij, net, belasting en modus vereisen protobuf of cloud.

CLOUD DATA MAPPING
De S-Miles Cloud API retourneert realtime data in reflux_station_data:
  pv_power = PV-vermogen (W), bms_power = Batterijvermogen (W), bms_soc = Batterij SoC (%),
  grid_power = Netvermogen (W), load_power = Huisbelasting (W).
Energie: today_eq = Dagelijkse energie (Wh geheel getal → kWh), total_eq = Totale energie (Wh geheel getal → kWh).
Batterijmodus: tou_mode (1=Eigen verbruik, 2=Economie, 3=Noodstroom, 4=Off-Grid, 5=Eigen verbruik + Max vermogen, 6=Noodstroom + Max vermogen, 7=Pieksturing, 8=Tijdafhankelijk).
Apparatenlijst: /pvm/api/0/dev/select_by_page geeft DTU, omvormer, gateway en batterij-info per station.

FLOW CARDS
Acties:
- Batterijmodus instellen (Eigen verbruik, Economie, Noodstroom, Off-Grid, Eigen verbruik + Max vermogen, Noodstroom + Max vermogen, Pieksturing, Tijdafhankelijk)
- Reserve SoC, max SoC, max vermogen, netlimiet instellen
- Pieksturing parameters instellen (reserve SoC + max SoC + netlimiet)
- Tijdafhankelijke periode instellen (laadschema)
- Omvormer vermogenslimiet instellen (2-100%, EEPROM-schrijfbewerking)
- Omvormerstatus instellen (aan/uit)
- Relais instellen (droogcontact in-/uitschakelen)
- Data nu vernieuwen
- Voorkeur lokaal/cloud verbinding
- Cloud-fallback in-/uitschakelen

Condities:
- Batterij is/is niet aan het laden of ontladen
- Batterij SoC is/is niet boven of onder drempel
- Net is/is niet aan het importeren of exporteren
- PV-/belastingsvermogen is/is niet boven drempel
- Batterijmodus is/is niet een specifieke modus
- Gateway is/is niet online
- Verbinding is/is niet lokaal (LAN)

LET OP
Bestaande apparaten migreren automatisch nieuwe mogelijkheden bij een app-update. Opnieuw koppelen is alleen nodig als de apparaatklasse wijzigt.

DISCLAIMER
Dit is een onofficiële, door de community ontwikkelde integratie. Niet gelieerd aan of goedgekeurd door Hoymiles Power Electronics Inc. Maakt gebruik van de reverse-engineered S-Miles Cloud API en/of lokale DTU-communicatie. Hoymiles kan deze interfaces op elk moment wijzigen. Gebruik op eigen risico.
