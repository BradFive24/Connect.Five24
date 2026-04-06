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
  },
  {
    placeId: "ChIJ_contacted_seed_lead",
    source: {
      name: "Urban Yoga Studio",
      formattedAddress: "456 Zen Way, San Francisco, CA 94103",
      phoneNumber: "(415) 555-0123",
      rating: 4.9,
      userRatingCount: 89,
      location: { lat: 37.7749, lng: -122.4194 },
      lastSynced: new Date().toISOString()
    },
    crm: {
      ownerName: "Sarah Peace",
      managerName: "Tom Calm",
      email: "hello@urbanyoga.com",
      notes: "Initial call went well. They are interested in a new website.",
      status: 'contacted',
      tags: ["wellness", "yoga"],
      interactionHistory: [
        {
          id: "int-contacted-1",
          type: 'call',
          content: "Introductory call. Sarah is the decision maker.",
          timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
        }
      ],
    },
    compliance: {
      verifiedByEU: true,
      collectedAt: new Date().toISOString()
    }
  },
  {
    placeId: "ChIJ_qualified_seed_lead",
    source: {
      name: "Green Leaf Landscaping",
      formattedAddress: "789 Garden Ln, Austin, TX 78701",
      phoneNumber: "(512) 555-0456",
      rating: 4.2,
      userRatingCount: 56,
      location: { lat: 30.2672, lng: -97.7431 },
      lastSynced: new Date().toISOString()
    },
    crm: {
      ownerName: "Gary Green",
      managerName: "Linda Leaf",
      email: "info@greenleaf.com",
      notes: "Qualified for the premium SEO package. Budget confirmed.",
      status: 'qualified',
      tags: ["landscaping", "service"],
      interactionHistory: [
        {
          id: "int-qualified-1",
          type: 'visit',
          content: "On-site consultation. They have a $2k/mo budget.",
          timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
        }
      ],
    },
    compliance: {
      verifiedByEU: true,
      collectedAt: new Date().toISOString()
    }
  },
  {
    placeId: "ChIJ_proposal_seed_lead",
    source: {
      name: "Skyline Architecture",
      formattedAddress: "101 Tower Blvd, Chicago, IL 60601",
      phoneNumber: "(312) 555-0789",
      rating: 4.7,
      userRatingCount: 120,
      location: { lat: 41.8781, lng: -87.6298 },
      lastSynced: new Date().toISOString()
    },
    crm: {
      ownerName: "Arthur Arch",
      managerName: "Diane Design",
      email: "contact@skylinearch.com",
      notes: "Proposal sent for full brand identity redesign.",
      status: 'proposal',
      tags: ["architecture", "design"],
      interactionHistory: [
        {
          id: "int-proposal-1",
          type: 'note',
          content: "Sent comprehensive proposal PDF via email.",
          timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
        }
      ],
    },
    compliance: {
      verifiedByEU: true,
      collectedAt: new Date().toISOString()
    }
  },
  {
    placeId: "ChIJ_closed_seed_lead",
    source: {
      name: "Main St. Bakery",
      formattedAddress: "202 Flour St, Seattle, WA 98101",
      phoneNumber: "(206) 555-0202",
      rating: 4.6,
      userRatingCount: 230,
      location: { lat: 47.6062, lng: -122.3321 },
      lastSynced: new Date().toISOString()
    },
    crm: {
      ownerName: "Baker Bill",
      managerName: "Pastry Pam",
      email: "bill@mainstbakery.com",
      notes: "Contract signed! Starting implementation next week.",
      status: 'closed',
      tags: ["bakery", "food"],
      interactionHistory: [
        {
          id: "int-closed-1",
          type: 'note',
          content: "Contract signed and deposit received.",
          timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
        }
      ],
    },
    compliance: {
      verifiedByEU: true,
      collectedAt: new Date().toISOString()
    }
  },
  {
    placeId: "ChIJ_lost_seed_lead",
    source: {
      name: "Tech Solutions Inc.",
      formattedAddress: "303 Silicon Way, San Jose, CA 95113",
      phoneNumber: "(408) 555-0303",
      rating: 4.0,
      userRatingCount: 15,
      location: { lat: 37.3382, lng: -121.8863 },
      lastSynced: new Date().toISOString()
    },
    crm: {
      ownerName: "Tom Tech",
      managerName: "Siri Solution",
      email: "tom@techsolutions.com",
      notes: "Went with a competitor due to pricing.",
      status: 'lost',
      tags: ["tech", "b2b"],
      interactionHistory: [
        {
          id: "int-lost-1",
          type: 'call',
          content: "Follow up call. They chose a cheaper local agency.",
          timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
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
