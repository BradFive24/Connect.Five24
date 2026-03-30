export interface Lead {
  id: string;
  name: string;
  placeId?: string;
  rating?: number;
  userRatingCount?: number;
  location: {
    lat: number;
    lng: number;
  };
  formattedAddress?: string;
  monetaryValue: number;
  bornOn: string;
  lastUpdated: string;
  industry?: string;
  notes?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
}
