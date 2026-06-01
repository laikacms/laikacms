module default {
  # LaikaCMS content schema for Gel.
  #
  # Apply with: gel migration apply
  #
  # The `constraint exclusive` on `path` surfaces ConstraintViolationError
  # on duplicate-key inserts, which GelStorageRepository maps to
  # EntryAlreadyExistsError — the same error all other backends produce.

  type LaikaFile {
    required path: str {
      constraint exclusive;
    };
    required parent: str;
    required name: str;
    required extension: str;
    content: str;
    required createdAt: str;
    required updatedAt: str;

    # Index on (parent, name) makes folder listing a single index scan.
    index on ((.parent, .name));
  }

  type LaikaFolder {
    required path: str {
      constraint exclusive;
    };
    required parent: str;
    required name: str;
    required createdAt: str;
    required updatedAt: str;

    index on (.parent);
  }
}
