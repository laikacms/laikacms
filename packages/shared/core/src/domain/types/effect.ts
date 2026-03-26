import type { Stream } from "effect/Stream";
import type { Result } from "effect/Result";
import { LaikaError } from "../entities";

export type LaikaResult<T> = Result<T, LaikaError>;
