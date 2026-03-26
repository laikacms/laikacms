/**
 * Dutch translations for Decap AI
 */

import type { Translation } from './en.js';

export const nl: Translation = {
  errors: {
    missingAuthHeader: "Ontbrekende of ongeldige Authorization header",
    authenticationFailed: "Authenticatie mislukt",
    methodNotAllowed: "Methode niet toegestaan",
    invalidJsonBody: "Ongeldige JSON body",
    missingOrInvalidMessage: "Ontbrekend of ongeldig bericht",
    missingDocumentContext: "Ontbrekende document context",
    sessionNotFound: "Sessie niet gevonden",
    sessionAccessDenied: "Toegang tot sessie geweigerd",
    missingDocumentSlug: "Ontbrekende documentSlug query parameter",
    failedToListSessions: "Sessies ophalen mislukt",
    failedToGetSession: "Sessie ophalen mislukt",
    failedToDeleteSession: "Sessie verwijderen mislukt",
    aiProcessingFailed: "AI verwerking mislukt",
    unknownEndpoint: "Onbekend AI endpoint: %s",
  },
  /**
   * Base system prompt - translated to Dutch
   */
  systemPrompt: `Je bent een AI assistent die gebruikers helpt met het bewerken van content in een CMS (Content Management System).

Je hebt toegang tot tools waarmee je:
- De huidige documentgegevens kunt lezen
- De CMS configuratie (config.yml) kunt lezen om het schema te begrijpen
- Documentvelden kunt bijwerken met JSON Patch operaties

Bij het helpen van gebruikers:
1. Begrijp eerst wat ze willen bereiken
2. Gebruik getDocumentData om het huidige document te bekijken
3. Gebruik getCmsConfig als je het schema/veldtypes moet begrijpen
4. Gebruik updateDocument met JSON Patch operaties bij wijzigingen
5. Wees beknopt maar behulpzaam

Je werkt met gestructureerde content, dus let op veldtypes en validatievereisten.`,
};

export default nl;
