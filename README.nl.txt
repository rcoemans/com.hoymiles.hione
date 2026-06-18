Monitor en beheer je Hoymiles HiOne batterijsysteem via Cloud, Modbus TCP en Protobuf.

FUNCTIES
- Multi-apparaat architectuur: Station, Omvormer, Gateway en Batterij worden elk als apart Homey-apparaat weergegeven
- Realtime monitoring: PV-vermogen, batterij SoC, laad-/ontlaadvermogen, netimport/-export, thuisverbruik
- Energietotalen: dag, maand, jaar en levenslang
- Financieel en milieu: winst vandaag/totaal, CO2-reductie
- Instelbare parameters: Batterijmodus, Reserve SoC, Max SoC, Max Laad-/Ontlaadvermogen, Netlimiet
- Berekende inzichten: zelfvoorzieningspercentage, accurestduur, tijd tot vol, vermogensbalans
- Batterijmodi: Eigen verbruik, Economie, Noodstroom, Off-Grid, Geforceerd laden, Geforceerd ontladen, Pieksturing, Tijdafhankelijk
- Drie verbindingsmodi: Alleen Cloud, Hybride (Cloud + Lokaal LAN), Alleen lokaal
- Lokale protocollen: Protobuf (poort 10081) en Modbus TCP (poort 502)
- Homey Energy integratie: homeBattery met meter_power.charged/discharged
- Diagnostiek: Modbus/Protobuf snapshot-verzamelaar voor datacorrelatie en registerontdekking
- Flow triggers, condities en acties voor volledige automatisering

VEREISTEN
- Homey Pro (2019 of 2023) met firmware >= 12.0.0
- Hoymiles HiOne BESS met HiBox of DTS gateway
- Voor cloud/hybride modus: een actief S-Miles Cloud account
- Voor lokale modus: het IP-adres van de gateway op je LAN

APPARATEN TOEVOEGEN
1. Open Homey en ga naar Apparaten
2. Tik op + en zoek naar "Hoymiles HiOne"
3. Voeg eerst "HiOne Station" toe — log in met je S-Miles Cloud inloggegevens
4. Selecteer je station uit de lijst
5. Configureer optioneel de lokale LAN-verbinding
6. Na het toevoegen van het Station kun je Omvormer/Gateway/Batterij apparaten toevoegen die gekoppeld zijn aan dat station
7. Data wordt elke 60 seconden vernieuwd (instelbaar 30-300s)

AUTHENTICATIE
Inloggen gebruikt de moderne tweestaps v3 S-Miles Cloud flow: pre-inspectie (nonce) + credential hash. Drie clientprofielen worden automatisch geprobeerd (Web, S-Miles Installer, S-Miles Home). Argon2id gezouten accounts en legacy v0 MD5-terugval worden ondersteund. Wachtwoorden worden client-side gehasht — ruwe wachtwoorden worden nooit verzonden.

APPARAATINSTELLINGEN
Verbindingsmodus, gateway IP, protocol, poort, poll-interval en cloud API URL kunnen allemaal in de Station-apparaatinstellingen gewijzigd worden zonder opnieuw te koppelen. Standaard cloud API URL is https://neapi.hoymiles.com (automatisch gedetecteerd tijdens inloggen; S-Miles Home consumentenaccounts authenticeren via euapi.hoymiles.com). Systeeminfo (model, serienummer, firmware) wordt als alleen-lezen labels weergegeven.

APP-INSTELLINGEN
De app-instellingenpagina (Homey > Apps > Hoymiles HiOne > Instellingen) biedt een cloud login-test en diagnostiektools voor Modbus TCP- en Protobuf-datacorrelatie. Start/Stop/Exporteer/Wis snapshot-verzameling voor registerontdekking en data-analyse.

TAAL
De app ondersteunt Engels en Nederlands. De taal wordt automatisch ingesteld op basis van je Homey-systeemtaal.

DISCLAIMER
Dit is een onofficiële, door de community ontwikkelde integratie. Niet gelieerd aan of goedgekeurd door Hoymiles Power Electronics Inc. Gebruik op eigen risico.
