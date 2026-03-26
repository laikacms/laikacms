import z from "zod";
import { pathCombine, pathToSegments } from "../../utils.js";

export const keyZ = z.string().regex(/^[a-zA-Z0-9_-]+$/).transform(val => pathCombine(...pathToSegments(val)));

export type Key = z.infer<typeof keyZ>;