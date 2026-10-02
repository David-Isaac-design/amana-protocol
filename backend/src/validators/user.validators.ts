import { z } from "zod";

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .min(2, "Display name must be at least 2 characters")
    .max(32, "Display name must be 32 characters or fewer")
    .regex(/^[a-zA-Z0-9 _-]+$/, "Display name contains invalid characters")
    .optional(),
  avatarUrl: z.string().url("Invalid URL").optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Normalize a user-supplied display name: strip HTML tags and control / zero-width
 * characters, then collapse runs of whitespace.
 */
export function sanitizeDisplayName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/<[^>]*>/g, "")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

export const patchDisplayNameSchema = z
  .object({
    displayName: z
      .string()
      .transform(sanitizeDisplayName)
      .pipe(
        z
          .string()
          .min(DISPLAY_NAME_MIN, `Display name must be at least ${DISPLAY_NAME_MIN} characters`)
          .max(DISPLAY_NAME_MAX, `Display name must be ${DISPLAY_NAME_MAX} characters or fewer`),
      ),
  })
  .strict();

export type PatchDisplayNameInput = z.infer<typeof patchDisplayNameSchema>;
