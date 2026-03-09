Monitor en bedien je Hoymiles HiOne all-in-one batterijopslagsysteem vanuit Homey.

FUNCTIES
- Realtime monitoring: PV-vermogen, batterij laadniveau, batterij laad-/ontlaadvermogen, netimport/-export en thuisverbruik
- Energietotalen: dagopbrengst en totaalopbrengst
- Berekende inzichten: zelfvoorzieningspercentage, batterijlooptijd/laadtijd-schattingen, vermogensbalans, energieonafhankelijkheid
- Batterijmodusbesturing via Flows: Eigen verbruik, Economie, Noodstroom, Off-Grid, Pieksturing, Tijdafhankelijk
- Flow triggers: batterij laden/ontladen statuswijzigingen, SoC-drempels, netstatus wijzigingen, PV-productie, gatewaystatus, verbindingsbron wijzigingen
- Flow condities: batterij laden/ontladen, SoC boven/onder drempel, PV-/belastingsvermogen drempels, net importeren/exporteren, batterijmodus, gateway online, verbinding lokaal
- Flow acties: batterijmodus instellen, data vernieuwen, voorkeur lokaal/cloud, cloud-fallback in-/uitschakelen
- Drie verbindingsmodi: Lokaal (LAN), Lokaal + Cloud (aanbevolen), of alleen Cloud

VEREISTEN
- Homey Pro (2019 of 2023) met firmware >= 10.0.0
- Hoymiles HiOne all-in-one BESS met HiBox-63T-G3 gateway
- Voor cloud/hybride modus: een actief S-Miles Cloud account
- Voor lokale modus: het IP-adres van de HiBox gateway op je LAN

APPARAAT TOEVOEGEN
1. Open de Homey app en ga naar Apparaten
2. Tik op + en zoek naar "Hoymiles HiOne"
3. Selecteer HiOne Station
4. Kies je verbindingsmodus:
   - Lokaal (LAN): voer het IP-adres van je HiBox gateway in
   - Lokaal + Cloud: voer het gateway IP in en log daarna in met je S-Miles Cloud inloggegevens
   - Alleen Cloud: log in met je S-Miles Cloud e-mail en wachtwoord
5. Selecteer je station uit de lijst
6. Data wordt elke 60 seconden vernieuwd

HIBOX IP-ADRES VINDEN
Controleer de beheerpagina van je router onder verbonden apparaten. Zoek naar een apparaat genaamd DTUBI-... of HiBox.
Tip: gebruik Lokaal + Cloud voor de beste ervaring.

FLOW CARDS
Acties:
- Batterijmodus instellen (Eigen verbruik, Economie, Noodstroom, Off-Grid, Pieksturing, Tijdafhankelijk)
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

DISCLAIMER
Dit is een onofficiële, door de community ontwikkelde integratie. Niet gelieerd aan of goedgekeurd door Hoymiles Power Electronics Inc. Maakt gebruik van de reverse-engineered S-Miles Cloud API en/of lokale DTU-communicatie. Hoymiles kan deze interfaces op elk moment wijzigen. Gebruik op eigen risico.
