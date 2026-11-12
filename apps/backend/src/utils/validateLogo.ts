const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

export function validateLogo(logoUrl?: string | null): { valid: boolean; error?: string } {
  if (!logoUrl) return { valid: true };

  const trimmed = logoUrl.trim();
  if (!trimmed) return { valid: true };

  // Explicitly reject SVG to prevent SVG-based XSS attacks
  if (
    trimmed.toLowerCase().includes('image/svg+xml') ||
    trimmed.toLowerCase().endsWith('.svg') ||
    trimmed.toLowerCase().includes('<svg')
  ) {
    return {
      valid: false,
      error: 'SVG images are not allowed for security reasons. Please upload PNG, JPG, or WebP.',
    };
  }

  // Validate HTTPS URL
  if (trimmed.startsWith('https://')) {
    return { valid: true };
  }

  // Validate Data URL: data:image/(png|jpeg|jpg|webp);base64,...
  const dataUrlRegex = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/;
  const match = trimmed.match(dataUrlRegex);
  if (!match) {
    return {
      valid: false,
      error: 'Logo must be a valid HTTPS URL or base64 data URL (image/png, image/jpeg, or image/webp).',
    };
  }

  // Check base64 byte size
  const base64Data = match[2];
  // A base64 string whose length is 1 mod 4 cannot be decoded. This is the
  // signature of an image that was previously truncated mid-payload.
  if (base64Data.length % 4 === 1) {
    return {
      valid: false,
      error: 'The image data is incomplete or corrupted. Please upload the image again.',
    };
  }
  const approximateBytes = Math.ceil((base64Data.length * 3) / 4);
  if (approximateBytes > MAX_LOGO_BYTES) {
    return {
      valid: false,
      error: 'Logo image exceeds the maximum permitted size of 2 MB.',
    };
  }

  return { valid: true };
}

