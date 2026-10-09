// National number length per dial code; other codes fall back to the generic 6-14 digit rule.
const NATIONAL_LENGTH: Record<string, number> = { '+91': 10 };

export const isValidNationalNumber = (countryCode: string, mobile: string): boolean => {
  const length = NATIONAL_LENGTH[countryCode];
  return length === undefined || mobile.length === length;
};

// Phones are stored as E.164 in app_user.phone, e.g. +919876543210.
export const toE164 = (countryCode: string, mobile: string): string => `${countryCode}${mobile}`;
