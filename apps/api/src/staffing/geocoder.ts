/**
 * Geocoding for the "city or radius" filter (decided 26 Sep 2026). A named interface so a real geocoder
 * (e.g. Google Geocoding) can replace the offline table later. Unknown cities return null: callers must treat
 * that as "cannot be evaluated", never guess.
 */
export interface GeoPoint {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface Geocoder {
  lookup(city: string): Promise<GeoPoint | null>;
}

// Major cities (city centre coordinates, 4 d.p.). [name, ISO country, lat, lng]
const CITIES: [string, string, number, number][] = [
  ['London', 'GB', 51.5074, -0.1278], ['Manchester', 'GB', 53.4808, -2.2426], ['Birmingham', 'GB', 52.4862, -1.8904],
  ['Edinburgh', 'GB', 55.9533, -3.1883], ['Glasgow', 'GB', 55.8642, -4.2518], ['Leeds', 'GB', 53.8008, -1.5491],
  ['Bristol', 'GB', 51.4545, -2.5879], ['Belfast', 'GB', 54.5973, -5.9301], ['Dublin', 'IE', 53.3498, -6.2603],
  ['Cork', 'IE', 51.8985, -8.4756], ['Paris', 'FR', 48.8566, 2.3522], ['Berlin', 'DE', 52.52, 13.405],
  ['Frankfurt', 'DE', 50.1109, 8.6821], ['Munich', 'DE', 48.1351, 11.582], ['Amsterdam', 'NL', 52.3676, 4.9041],
  ['Brussels', 'BE', 50.8503, 4.3517], ['Luxembourg', 'LU', 49.6116, 6.1319], ['Zurich', 'CH', 47.3769, 8.5417],
  ['Geneva', 'CH', 46.2044, 6.1432], ['Madrid', 'ES', 40.4168, -3.7038], ['Barcelona', 'ES', 41.3874, 2.1686],
  ['Lisbon', 'PT', 38.7223, -9.1393], ['Milan', 'IT', 45.4642, 9.19], ['Rome', 'IT', 41.9028, 12.4964],
  ['Vienna', 'AT', 48.2082, 16.3738], ['Warsaw', 'PL', 52.2297, 21.0122], ['Stockholm', 'SE', 59.3293, 18.0686],
  ['Copenhagen', 'DK', 55.6761, 12.5683], ['Oslo', 'NO', 59.9139, 10.7522], ['Helsinki', 'FI', 60.1699, 24.9384],
  ['New York', 'US', 40.7128, -74.006], ['Chicago', 'US', 41.8781, -87.6298], ['San Francisco', 'US', 37.7749, -122.4194],
  ['Los Angeles', 'US', 34.0522, -118.2437], ['Boston', 'US', 42.3601, -71.0589], ['Charlotte', 'US', 35.2271, -80.8431],
  ['Toronto', 'CA', 43.6532, -79.3832], ['Montreal', 'CA', 45.5017, -73.5673], ['Mexico City', 'MX', 19.4326, -99.1332],
  ['São Paulo', 'BR', -23.5505, -46.6333], ['Mumbai', 'IN', 19.076, 72.8777], ['Bengaluru', 'IN', 12.9716, 77.5946],
  ['Delhi', 'IN', 28.7041, 77.1025], ['Hyderabad', 'IN', 17.385, 78.4867], ['Chennai', 'IN', 13.0827, 80.2707],
  ['Pune', 'IN', 18.5204, 73.8567], ['Kolkata', 'IN', 22.5726, 88.3639], ['Singapore', 'SG', 1.3521, 103.8198],
  ['Hong Kong', 'HK', 22.3193, 114.1694], ['Tokyo', 'JP', 35.6762, 139.6503], ['Sydney', 'AU', -33.8688, 151.2093],
  ['Melbourne', 'AU', -37.8136, 144.9631], ['Kuala Lumpur', 'MY', 3.139, 101.6869], ['Manila', 'PH', 14.5995, 120.9842],
  ['Jakarta', 'ID', -6.2088, 106.8456], ['Dubai', 'AE', 25.2048, 55.2708], ['Abu Dhabi', 'AE', 24.4539, 54.3773],
  ['Riyadh', 'SA', 24.7136, 46.6753], ['Doha', 'QA', 25.2854, 51.531], ['Johannesburg', 'ZA', -26.2041, 28.0473],
  ['Cape Town', 'ZA', -33.9249, 18.4241], ['Lagos', 'NG', 6.5244, 3.3792], ['Nairobi', 'KE', -1.2921, 36.8219],
  ['Cairo', 'EG', 30.0444, 31.2357],
];
const ALIASES: Record<string, string> = { bangalore: 'bengaluru', 'new delhi': 'delhi', nyc: 'new york', 'sao paulo': 'são paulo', bombay: 'mumbai' };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** v1 stub: an offline table of major cities. Accepts "City" or "City, CC". */
export class OfflineGeocoder implements Geocoder {
  private readonly byName = new Map<string, GeoPoint[]>();

  constructor() {
    for (const [name, country, latitude, longitude] of CITIES) {
      const list = this.byName.get(norm(name)) ?? [];
      list.push({ name, country, latitude, longitude });
      this.byName.set(norm(name), list);
    }
  }

  async lookup(city: string): Promise<GeoPoint | null> {
    const [rawName, rawCountry] = city.split(',').map((s) => s.trim());
    const name = norm(rawName ?? '');
    const hits = this.byName.get(ALIASES[name] ?? name) ?? [];
    const country = rawCountry?.toUpperCase();
    return (country ? hits.find((h) => h.country === country) : hits[0]) ?? null;
  }
}

/** Great-circle distance in km (haversine, mean Earth radius). */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}
