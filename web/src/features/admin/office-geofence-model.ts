export interface OfficeGeofenceDraft {
  latitude: string;
  longitude: string;
  radiusMeters: string;
}

export interface OfficeGeofenceInput {
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
}

export type OfficeGeofenceFieldErrors = Partial<Record<keyof OfficeGeofenceDraft, string>>;

export function parseOfficeGeofenceDraft(draft: OfficeGeofenceDraft): {
  input?: OfficeGeofenceInput;
  errors: OfficeGeofenceFieldErrors;
} {
  const errors: OfficeGeofenceFieldErrors = {};
  const latitude = parseCoordinate(draft.latitude, -90, 90, "Latitude", errors, "latitude");
  const longitude = parseCoordinate(draft.longitude, -180, 180, "Longitude", errors, "longitude");
  const radiusText = draft.radiusMeters.trim();
  const radius = Number(radiusText);

  if (!radiusText || !Number.isFinite(radius) || !Number.isInteger(radius) || radius < 10 || radius > 100000) {
    errors.radiusMeters = "Enter a whole-number radius from 10 to 100,000 metres.";
  }

  if (Object.keys(errors).length || latitude === undefined || longitude === undefined) {
    return { errors };
  }

  return {
    input: { latitude, longitude, geofenceRadiusMeters: radius },
    errors,
  };
}

function parseCoordinate(
  rawValue: string,
  minimum: number,
  maximum: number,
  label: string,
  errors: OfficeGeofenceFieldErrors,
  field: "latitude" | "longitude",
): number | undefined {
  const valueText = rawValue.trim();
  const value = Number(valueText);
  const stepValue = value * 100000;
  const matchesFiveDecimalStep = Math.abs(stepValue - Math.round(stepValue)) < 1e-7;

  if (!valueText || !Number.isFinite(value) || value < minimum || value > maximum || !matchesFiveDecimalStep) {
    errors[field] = `${label} must be between ${minimum} and ${maximum}, using at most five decimal places.`;
    return undefined;
  }
  return value;
}
