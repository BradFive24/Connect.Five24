import { db } from './firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { Lead } from './types';

const SEED_LEADS: Omit<Lead, 'id' | 'userId'>[] = [
  {
    name: "Tactical Coffee Co.",
    placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    rating: 4.8,
    userRatingCount: 412,
    location: { lat: 37.422, lng: -122.084 },
    formattedAddress: "1600 Amphitheatre Pkwy, Mountain View, CA 94043",
    monetaryValue: 0,
    bornOn: new Date().toISOString(),
    lastUpdated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago (Expired)
    industry: "Coffee Shop",
    notes: "High foot traffic, needs better CRM."
  },
  {
    name: "Precision Auto Repair",
    placeId: "ChIJ_8_8_8_8_8_8_8_8_8_8_8",
    rating: 4.5,
    userRatingCount: 128,
    location: { lat: 37.415, lng: -122.075 },
    formattedAddress: "800 N Shoreline Blvd, Mountain View, CA 94043",
    monetaryValue: 0,
    bornOn: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    industry: "Automotive",
    notes: "Owner is looking for lead gen."
  }
];

export async function seedInitialLeads(userId: string) {
  const q = query(collection(db, 'leads'), where('userId', '==', userId));
  const snapshot = await getDocs(q);
  
  if (snapshot.empty) {
    console.log("Seeding initial leads for user:", userId);
    for (const lead of SEED_LEADS) {
      await addDoc(collection(db, 'leads'), { ...lead, userId });
    }
  }
}
