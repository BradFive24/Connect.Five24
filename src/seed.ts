import { db } from './firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { Lead } from './types';

const SEED_LEADS: Omit<Lead, 'id' | 'userId'>[] = [
  {
    placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    source: {
      name: "Tactical Coffee Co.",
      formattedAddress: "1600 Amphitheatre Pkwy, Mountain View, CA 94043",
      phoneNumber: "(650) 253-0000",
      rating: 4.8,
      userRatingCount: 412,
      location: { lat: 37.422, lng: -122.084 },
      lastSynced: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    },
    crm: {
      ownerName: "John Smith",
      managerName: "Jane Doe",
      email: "tactical@coffee.com",
      notes: "High foot traffic, needs better CRM.",
      status: 'new',
      tags: ["coffee", "retail"],
      interactionHistory: [],
    },
    compliance: {
      verifiedByEU: false,
      collectedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days ago (Expired)
    }
  },
  {
    placeId: "ChIJ_8_8_8_8_8_8_8_8_8_8_8",
    source: {
      name: "Precision Auto Repair",
      formattedAddress: "800 N Shoreline Blvd, Mountain View, CA 94043",
      phoneNumber: "(650) 555-0199",
      rating: 4.5,
      userRatingCount: 128,
      location: { lat: 37.415, lng: -122.075 },
      lastSynced: new Date().toISOString()
    },
    crm: {
      ownerName: "Mike Mechanic",
      managerName: "Sarah Service",
      email: "precision@auto.com",
      notes: "Owner is looking for lead gen.",
      status: 'new',
      tags: ["auto", "service"],
      interactionHistory: [],
    },
    compliance: {
      verifiedByEU: true,
      collectedAt: new Date().toISOString()
    }
  },
  {
    placeId: "ChIJ_rejected_seed_lead",
    source: {
      name: "Old School Diner",
      formattedAddress: "123 Main St, Anytown, USA",
      phoneNumber: "(555) 012-3456",
      rating: 3.2,
      userRatingCount: 45,
      location: { lat: 37.4, lng: -122.1 },
      lastSynced: new Date().toISOString()
    },
    crm: {
      ownerName: "Bob Burger",
      managerName: "Linda Burger",
      email: "bob@diner.com",
      notes: "Not interested in digital marketing at this time.",
      status: 'rejected',
      tags: ["food", "diner"],
      interactionHistory: [
        {
          id: "int-rejected-1",
          type: 'call',
          content: "Spoke with Bob, he's very traditional and doesn't want to change.",
          timestamp: new Date().toISOString()
        }
      ],
    },
    compliance: {
      verifiedByEU: false,
      collectedAt: new Date().toISOString()
    }
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
