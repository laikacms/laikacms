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
};

export default nl;
