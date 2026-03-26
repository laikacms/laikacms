import z from "zod";

/**
 * 
 * @param params 
 * @returns 
 */
export const isoDateWithFallbackZ = (params?: string | z.core.$ZodISODateTimeParams | undefined) => {
  return z.string().transform(x => new Date(x).toISOString()).pipe(z.iso.datetime(params))
}

