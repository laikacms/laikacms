/**
 * Dutch translations for core i18n
 */

import type { Translation } from './en.js';

export const nl: Translation = {
  ok: 'OK',
  cancel: 'Annuleren',
  save: 'Opslaan',
  delete: 'Verwijderen',
  edit: 'Bewerken',
  create: 'Aanmaken',
  loading: 'Laden...',
  error: 'Fout',
  success: 'Gelukt',
  confirm: 'Bevestigen',
  back: 'Terug',
  next: 'Volgende',
  previous: 'Vorige',
  search: 'Zoeken',
  filter: 'Filteren',
  sort: 'Sorteren',
  refresh: 'Vernieuwen',
  close: 'Sluiten',
  open: 'Openen',
  yes: 'Ja',
  no: 'Nee',
  notFound: 'Niet gevonden',
  unauthorized: 'Niet geautoriseerd',
  forbidden: 'Verboden',
  serverError: 'Serverfout',
  networkError: 'Netwerkfout',
  validationError: 'Validatiefout',
  unknownError: 'Onbekende fout',
  login: 'Inloggen',
  logout: 'Uitloggen',
  register: 'Registreren',
  forgotPassword: 'Wachtwoord vergeten?',
  resetPassword: 'Wachtwoord resetten',
  email: 'E-mail',
  password: 'Wachtwoord',
  confirmPassword: 'Wachtwoord bevestigen',
  rememberMe: 'Onthoud mij',
  required: 'Dit veld is verplicht',
  minLength: 'Moet minimaal {{min}} tekens bevatten',
  maxLength: 'Mag maximaal {{max}} tekens bevatten',
  invalidEmail: 'Moet een geldig e-mailadres zijn',
  invalidUrl: 'Moet een geldige URL zijn',
  noPermissionAccessDocument: 'U heeft geen toestemming om dit document te openen',

  // Recoverable-warning translation keys — see
  // docs/concepts/recoverable-warning-translations.md for the naming convention.
  // storage-fs (reference implementation, LCMS-471)
  'storage.fs.fileNotFound': 'Het opgevraagde bestand kon niet worden gevonden.',
  'storage.fs.directoryNotFound': 'De opgevraagde map kon niet worden gevonden.',
  'storage.fs.permissionDenied': 'U heeft niet de benodigde bestandssysteemrechten voor deze bewerking.',
  'storage.fs.directoryNotEmpty': 'De map kon niet worden verwijderd omdat deze nog items bevat.',
  'storage.fs.expectedFileFoundDirectory': 'Hier werd een bestand verwacht, maar er is een map gevonden.',
  'storage.fs.expectedDirectoryFoundFile': 'Hier werd een map verwacht, maar er is een bestand gevonden.',
  'storage.fs.entryTypeUnsupported': 'Hier kunnen alleen bestanden en mappen worden beheerd.',
  'storage.fs.pathTraversalRejected': 'Het opgevraagde pad valt buiten de toegestane opslaglocatie.',
  'storage.fs.entryAlreadyExists': 'Er bestaat al een item met deze sleutel.',
  'storage.fs.contentRequired': 'Inhoud is vereist om dit item aan te maken.',
  'storage.fs.invalidRequest': 'Het verzoek kon niet worden verwerkt.',
  'storage.fs.failedToReadFile': 'Het bestand kon niet worden gelezen.',
  'storage.fs.failedToGetFileMetadata': 'De bestandsmetadata kon niet worden opgehaald.',
  'storage.fs.failedToGetDirectoryMetadata': 'De mapmetadata kon niet worden opgehaald.',
  'storage.fs.failedToListDirectory': 'De mapinhoud kon niet worden weergegeven.',
  'storage.fs.failedToListDrives': 'De beschikbare stations konden niet worden weergegeven.',
  'storage.fs.unexpectedFileSystemError': 'Er is een onverwachte bestandssysteemfout opgetreden.',

  // storage-r2 (LCMS-547)
  'storage.r2.fileNotFound': 'Het opgevraagde bestand kon niet worden gevonden.',
  'storage.r2.directoryNotFound': 'De opgevraagde map kon niet worden gevonden.',
  'storage.r2.entryAlreadyExists': 'Er bestaat al een item met deze sleutel.',
  'storage.r2.contentRequired': 'Inhoud is vereist om dit item aan te maken.',
  'storage.r2.invalidRequest': 'Het verzoek kon niet worden verwerkt.',
  'storage.r2.failedToReadObject': 'De inhoud van het object kon niet worden gelezen.',
  'storage.r2.failedToDeleteObject': 'Het object kon niet worden verwijderd.',
  'storage.r2.failedToGetObjectMetadata': 'De objectmetadata kon niet worden opgehaald.',
  'storage.r2.failedToGetDirectoryMetadata': 'De mapmetadata kon niet worden opgehaald.',
  'storage.r2.failedToListDirectory': 'De mapinhoud kon niet worden weergegeven.',
  'storage.r2.failedToCreateOrUpdateObject': 'Het object kon niet worden aangemaakt of bijgewerkt.',

  // storage-drizzle (LCMS-547)
  'storage.drizzle.fileNotFound': 'Het opgevraagde object kon niet worden gevonden.',
  'storage.drizzle.directoryNotFound': 'De opgevraagde map kon niet worden gevonden.',
  'storage.drizzle.atomNotFound': 'Er is geen item gevonden op deze sleutel.',
  'storage.drizzle.entryAlreadyExists': 'Er bestaat al een item met deze sleutel.',
  'storage.drizzle.contentRequired': 'Inhoud is vereist om dit item aan te maken.',
  'storage.drizzle.invalidJsonContent': 'De opgeslagen inhoud is geen geldige JSON.',
  'storage.drizzle.cannotRemoveFolderKey': 'Deze sleutel kan niet worden verwijderd omdat het een map met items is.',
  'storage.drizzle.failedToRemoveAtom': 'Het item kon niet worden verwijderd.',

  // storage-webdav (LCMS-547)
  'storage.webdav.fileNotFound': 'Het opgevraagde bestand kon niet worden gevonden.',
  'storage.webdav.directoryNotFound': 'De opgevraagde map kon niet worden gevonden.',
  'storage.webdav.atomNotFound': 'Er is geen item gevonden op deze sleutel.',
  'storage.webdav.entryAlreadyExists': 'Er bestaat al een item met deze sleutel.',
  'storage.webdav.contentRequired': 'Inhoud is vereist om dit item aan te maken.',
  'storage.webdav.directoryNotEmpty': 'De map kon niet worden verwijderd omdat deze nog items bevat.',
  'storage.webdav.invalidRequest': 'Het verzoek kon niet worden verwerkt.',
  'storage.webdav.authenticationFailed': 'Authenticatie bij de WebDAV-server is mislukt.',
  'storage.webdav.permissionDenied': 'U heeft niet de benodigde rechten voor deze bewerking.',
  'storage.webdav.resourceNotFound': 'De opgevraagde bron kon niet worden gevonden.',
  'storage.webdav.methodNotAllowed': 'De WebDAV-server staat deze bewerking niet toe.',
  'storage.webdav.conflict': 'Het verzoek is in strijd met de huidige staat van de WebDAV-server.',
  'storage.webdav.resourceLocked': 'De bron is vergrendeld en kan nu niet worden gewijzigd.',
  'storage.webdav.tooManyRequests':
    'De WebDAV-server beperkt momenteel het aantal verzoeken. Probeer het later opnieuw.',
  'storage.webdav.serviceUnavailable': 'De WebDAV-server is momenteel niet beschikbaar.',
  'storage.webdav.serverUnreachable': 'De WebDAV-server kon niet worden bereikt.',
  'storage.webdav.fetchImplementationMissing':
    'Er is geen netwerkclient beschikbaar om met de WebDAV-server te communiceren.',
  'storage.webdav.unexpectedError': 'Er is een onverwachte fout opgetreden bij het communiceren met de WebDAV-server.',

  // documents-jsonapi-proxy (LCMS-547)
  'documentsJsonapiProxy.invalidResponse': 'Het antwoord van de upstream-server kon niet worden verwerkt.',
  'documentsJsonapiProxy.lockAttributesMissing':
    'De upstream-server heeft een onvolledige vergrendeling geretourneerd.',
  'documentsJsonapiProxy.lockTimestampInvalid':
    'De upstream-server heeft een vergrendeling met een ongeldige tijdstempel geretourneerd.',
  'documentsJsonapiProxy.networkError': 'De upstream-server kon niet worden bereikt.',
  'documentsJsonapiProxy.syncTokenMissing': 'De upstream-server heeft geen synchronisatietoken geretourneerd.',
  'documentsJsonapiProxy.unknownRecordType': 'De upstream-server heeft een record van een onbekend type geretourneerd.',

  // assets-obsidian (LCMS-547)
  'assetsObsidian.fileNotFound': 'Het opgevraagde asset kon niet worden gevonden in de vault.',
  'assetsObsidian.directoryNotFound': 'De opgevraagde map kon niet worden gevonden in de vault.',
  'assetsObsidian.atomNotFound': 'Er is geen asset of map gevonden op deze sleutel.',
  'assetsObsidian.filesystemError': 'Er is een bestandssysteemfout in de vault opgetreden.',
  'assetsObsidian.pathTraversalRejected': 'Het opgevraagde pad valt buiten de toegestane vault-locatie.',
  'assetsObsidian.expectedAssetFoundDocument': 'Deze sleutel hoort bij een document, niet bij een asset.',
  'assetsObsidian.expectedFileFoundDirectory': 'Hier werd een bestand verwacht, maar er is een map gevonden.',
  'assetsObsidian.updateUnsupported':
    'Assets in een Obsidian-vault hebben geen metadata om bij te werken; vervang het bestand in plaats daarvan.',

  // documents-obsidian (LCMS-547)
  'documentsObsidian.notPublished': 'Deze notitie bestaat, maar is geen gepubliceerd document.',
  'documentsObsidian.notUnpublished': 'Deze notitie bestaat, maar is gepubliceerd en dus geen conceptversie.',
  'documentsObsidian.revisionsUnsupported':
    'De Obsidian-backend heeft geen versiegeschiedenis; revisies worden niet ondersteund.',
};

export default nl;
