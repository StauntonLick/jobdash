/**
 * location-constants.ts
 *
 * Pure constants — no Node.js imports — so this file can be safely consumed
 * by both server-side modules (user-config.ts) and client components (page.tsx).
 */

export const INDEED_COUNTRIES = [
  "Argentina",
  "Australia",
  "Austria",
  "Bahrain",
  "Belgium",
  "Brazil",
  "Canada",
  "Chile",
  "China",
  "Colombia",
  "Costa Rica",
  "Czech Republic",
  "Denmark",
  "Ecuador",
  "Egypt",
  "Finland",
  "France",
  "Germany",
  "Greece",
  "Hong Kong",
  "Hungary",
  "India",
  "Indonesia",
  "Ireland",
  "Israel",
  "Italy",
  "Japan",
  "Kuwait",
  "Luxembourg",
  "Malaysia",
  "Mexico",
  "Morocco",
  "Netherlands",
  "New Zealand",
  "Nigeria",
  "Norway",
  "Oman",
  "Pakistan",
  "Panama",
  "Peru",
  "Philippines",
  "Poland",
  "Portugal",
  "Qatar",
  "Romania",
  "Saudi Arabia",
  "Singapore",
  "South Africa",
  "South Korea",
  "Spain",
  "Sweden",
  "Switzerland",
  "Taiwan",
  "Thailand",
  "Turkey",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Uruguay",
  "Venezuela",
  "Vietnam",
] as const;

export type IndeedCountry = (typeof INDEED_COUNTRIES)[number];

// ---------------------------------------------------------------------------
// LocationSuggestion — shared type for both the static list and the Photon
// API route. Carries everything needed to populate the city input and derive
// the correct country_indeed value for JobSpy.
// ---------------------------------------------------------------------------

export type LocationSuggestion = {
  /** Text shown in the dropdown, e.g. "Edinburgh, UK". */
  display: string;
  /** City name passed to JobSpy as `location`, e.g. "Edinburgh". */
  city: string;
  /** Full country name accepted by JobSpy's country_indeed param, e.g. "United Kingdom". */
  countryIndeed: string;
};

// Short display names used in dropdown labels (UK, US, UAE are commonly abbreviated).
// All other country names are shown in full.
export const COUNTRY_DISPLAY: Record<string, string> = {
  "United Kingdom": "UK",
  "United States": "US",
  "United Arab Emirates": "UAE",
};

/** Returns the short display label for a country_indeed string. */
export function toCountryDisplay(countryIndeed: string): string {
  return COUNTRY_DISPLAY[countryIndeed] ?? countryIndeed;
}

// ---------------------------------------------------------------------------
// ISO 3166-1 alpha-2 → JobSpy country_indeed string
// Used by the Photon API route to convert geocoding results into values that
// JobSpy's Country.from_string() will accept.
// Covers all countries present in INDEED_COUNTRIES.
// ---------------------------------------------------------------------------

export const ISO_TO_INDEED_COUNTRY: Record<string, string> = {
  AR: "Argentina",
  AU: "Australia",
  AT: "Austria",
  BH: "Bahrain",
  BE: "Belgium",
  BR: "Brazil",
  CA: "Canada",
  CL: "Chile",
  CN: "China",
  CO: "Colombia",
  CR: "Costa Rica",
  CZ: "Czech Republic",
  DK: "Denmark",
  EC: "Ecuador",
  EG: "Egypt",
  FI: "Finland",
  FR: "France",
  DE: "Germany",
  GR: "Greece",
  HK: "Hong Kong",
  HU: "Hungary",
  IN: "India",
  ID: "Indonesia",
  IE: "Ireland",
  IL: "Israel",
  IT: "Italy",
  JP: "Japan",
  KW: "Kuwait",
  LU: "Luxembourg",
  MY: "Malaysia",
  MX: "Mexico",
  MA: "Morocco",
  NL: "Netherlands",
  NZ: "New Zealand",
  NG: "Nigeria",
  NO: "Norway",
  OM: "Oman",
  PK: "Pakistan",
  PA: "Panama",
  PE: "Peru",
  PH: "Philippines",
  PL: "Poland",
  PT: "Portugal",
  QA: "Qatar",
  RO: "Romania",
  SA: "Saudi Arabia",
  SG: "Singapore",
  ZA: "South Africa",
  KR: "South Korea",
  ES: "Spain",
  SE: "Sweden",
  CH: "Switzerland",
  TW: "Taiwan",
  TH: "Thailand",
  TR: "Turkey",
  UA: "Ukraine",
  AE: "United Arab Emirates",
  GB: "United Kingdom",
  US: "United States",
  UY: "Uruguay",
  VE: "Venezuela",
  VN: "Vietnam",
};

// ---------------------------------------------------------------------------
// Popular cities — static list of ~100 major employment hubs.
// These load instantly (no network call) and cover the cities most users
// are likely to search. The Photon API fills in anything not found here.
// ---------------------------------------------------------------------------

function popularCity(city: string, countryIndeed: string): LocationSuggestion {
  return {
    display: `${city}, ${toCountryDisplay(countryIndeed)}`,
    city,
    countryIndeed,
  };
}

export const POPULAR_CITIES: LocationSuggestion[] = [
  // United Kingdom
  popularCity("London", "United Kingdom"),
  popularCity("Edinburgh", "United Kingdom"),
  popularCity("Manchester", "United Kingdom"),
  popularCity("Birmingham", "United Kingdom"),
  popularCity("Glasgow", "United Kingdom"),
  popularCity("Leeds", "United Kingdom"),
  popularCity("Bristol", "United Kingdom"),
  popularCity("Liverpool", "United Kingdom"),
  popularCity("Sheffield", "United Kingdom"),
  popularCity("Cardiff", "United Kingdom"),
  popularCity("Newcastle upon Tyne", "United Kingdom"),
  popularCity("Nottingham", "United Kingdom"),
  popularCity("Leicester", "United Kingdom"),
  popularCity("Brighton", "United Kingdom"),
  popularCity("Oxford", "United Kingdom"),
  popularCity("Cambridge", "United Kingdom"),
  // Ireland
  popularCity("Dublin", "Ireland"),
  popularCity("Cork", "Ireland"),
  // Germany
  popularCity("Berlin", "Germany"),
  popularCity("Munich", "Germany"),
  popularCity("Hamburg", "Germany"),
  popularCity("Frankfurt", "Germany"),
  popularCity("Cologne", "Germany"),
  popularCity("Stuttgart", "Germany"),
  popularCity("Düsseldorf", "Germany"),
  popularCity("Leipzig", "Germany"),
  // France
  popularCity("Paris", "France"),
  popularCity("Lyon", "France"),
  popularCity("Marseille", "France"),
  popularCity("Toulouse", "France"),
  popularCity("Bordeaux", "France"),
  // Netherlands
  popularCity("Amsterdam", "Netherlands"),
  popularCity("Rotterdam", "Netherlands"),
  popularCity("The Hague", "Netherlands"),
  // Belgium
  popularCity("Brussels", "Belgium"),
  popularCity("Antwerp", "Belgium"),
  // Spain
  popularCity("Madrid", "Spain"),
  popularCity("Barcelona", "Spain"),
  popularCity("Valencia", "Spain"),
  popularCity("Seville", "Spain"),
  // Italy
  popularCity("Rome", "Italy"),
  popularCity("Milan", "Italy"),
  popularCity("Turin", "Italy"),
  popularCity("Naples", "Italy"),
  // Austria
  popularCity("Vienna", "Austria"),
  // Switzerland
  popularCity("Zurich", "Switzerland"),
  popularCity("Geneva", "Switzerland"),
  popularCity("Basel", "Switzerland"),
  // Scandinavia
  popularCity("Stockholm", "Sweden"),
  popularCity("Gothenburg", "Sweden"),
  popularCity("Copenhagen", "Denmark"),
  popularCity("Oslo", "Norway"),
  popularCity("Helsinki", "Finland"),
  // Eastern Europe
  popularCity("Warsaw", "Poland"),
  popularCity("Kraków", "Poland"),
  popularCity("Prague", "Czech Republic"),
  popularCity("Budapest", "Hungary"),
  popularCity("Bucharest", "Romania"),
  // Iberian Peninsula
  popularCity("Lisbon", "Portugal"),
  popularCity("Porto", "Portugal"),
  // Greece
  popularCity("Athens", "Greece"),
  // United States
  popularCity("New York", "United States"),
  popularCity("Los Angeles", "United States"),
  popularCity("San Francisco", "United States"),
  popularCity("Chicago", "United States"),
  popularCity("Seattle", "United States"),
  popularCity("Boston", "United States"),
  popularCity("Austin", "United States"),
  popularCity("Dallas", "United States"),
  popularCity("Houston", "United States"),
  popularCity("Atlanta", "United States"),
  popularCity("Miami", "United States"),
  popularCity("Denver", "United States"),
  popularCity("Washington", "United States"),
  popularCity("Philadelphia", "United States"),
  popularCity("Portland", "United States"),
  // Canada
  popularCity("Toronto", "Canada"),
  popularCity("Vancouver", "Canada"),
  popularCity("Montreal", "Canada"),
  popularCity("Calgary", "Canada"),
  popularCity("Ottawa", "Canada"),
  // Australia
  popularCity("Sydney", "Australia"),
  popularCity("Melbourne", "Australia"),
  popularCity("Brisbane", "Australia"),
  popularCity("Perth", "Australia"),
  popularCity("Adelaide", "Australia"),
  // New Zealand
  popularCity("Auckland", "New Zealand"),
  popularCity("Wellington", "New Zealand"),
  // Asia-Pacific
  popularCity("Singapore", "Singapore"),
  popularCity("Tokyo", "Japan"),
  popularCity("Osaka", "Japan"),
  popularCity("Hong Kong", "Hong Kong"),
  popularCity("Seoul", "South Korea"),
  popularCity("Taipei", "Taiwan"),
  popularCity("Bangkok", "Thailand"),
  popularCity("Kuala Lumpur", "Malaysia"),
  popularCity("Manila", "Philippines"),
  // India
  popularCity("Bangalore", "India"),
  popularCity("Mumbai", "India"),
  popularCity("Delhi", "India"),
  // Middle East
  popularCity("Dubai", "United Arab Emirates"),
  popularCity("Abu Dhabi", "United Arab Emirates"),
  popularCity("Riyadh", "Saudi Arabia"),
  popularCity("Doha", "Qatar"),
  // Africa
  popularCity("Johannesburg", "South Africa"),
  popularCity("Cape Town", "South Africa"),
  popularCity("Lagos", "Nigeria"),
  // South America
  popularCity("São Paulo", "Brazil"),
  popularCity("Rio de Janeiro", "Brazil"),
  popularCity("Buenos Aires", "Argentina"),
  popularCity("Bogotá", "Colombia"),
  popularCity("Lima", "Peru"),
  popularCity("Santiago", "Chile"),
];
