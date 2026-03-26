import { z } from "zod";

export const extNamesZ = z.union([
  // HTML extension names
  z.literal(".html"),
  z.literal(".htm"),
  z.literal(".xhtml"),

  // Markdown extension names
  z.literal(".md"),
  z.literal(".markdown"),

  // Text extension names
  z.literal(".txt"),
  z.literal(".log"),

  // Plain text storage extension names
  z.literal(".csv"),
  z.literal(".tsv"),
  z.literal(".json"),
  z.literal(".yaml"),
  z.literal(".yml"),
  z.literal(".xml"),
  z.literal(".toml"),

  // Code extension names
  z.literal(".js"),
  z.literal(".ts"),
  z.literal(".jsx"),
  z.literal(".tsx"),
  z.literal(".css"),
  z.literal(".scss"),
  z.literal(".sass"),
  z.literal(".less"),
  z.literal(".styl"),
  z.literal(".php"),
  z.literal(".py"),
  z.literal(".rb"),
  z.literal(".java"),
  z.literal(".c"),
  z.literal(".cpp"),
  z.literal(".h"),
  z.literal(".hpp"),
  z.literal(".cs"),
  z.literal(".fs"),
  z.literal(".fsx"),
  z.literal(".fsi"),
  z.literal(".go"),
  z.literal(".rs"),
  z.literal(".swift"),
  z.literal(".kt"),
  z.literal(".clj"),
  z.literal(".cljs"),
  z.literal(".cljc"),
  z.literal(".edn"),
  z.literal(".lua"),
  z.literal(".pl"),
  z.literal(".r"),
  z.literal(".sh"),
  z.literal(".bash"),
  z.literal(".zsh"),
  z.literal(".fish"),
  z.literal(".awk"),
  z.literal(".ps1"),
  z.literal(".bat"),
  z.literal(".cmd"),
  z.literal(".vbs"),

  // Audio MIME types
  z.literal(".mp3"),
  z.literal(".wav"),
  z.literal(".ogg"),
  z.literal(".flac"),
  z.literal(".aac"),

  // Image MIME types
  z.literal(".jpg"),
  z.literal(".jpeg"),
  z.literal(".png"),
  z.literal(".gif"),
  z.literal(".bmp"),
  z.literal(".webp"),
  z.literal(".svg"),
  z.literal(".tiff"),

  // Video MIME types
  z.literal(".mp4"),
  z.literal(".mov"),
  z.literal(".avi"),
  z.literal(".mkv"),
  z.literal(".webm"),
  z.literal(".flv"),
  z.literal(".wmv"),

  // Compressed types (optional for binary-focused purposes)
  z.literal(".zip"),
  z.literal(".rar"),
  z.literal(".7z"),

  // Other binary types
  z.literal(".pdf"),
  z.literal(".exe"),
  z.literal(".bin"),
  z.literal(".iso"),
]);

export type ExtName = z.infer<typeof extNamesZ>;
