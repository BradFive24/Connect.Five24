export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'proposal' | 'closed' | 'lost' | 'rejected';

export interface Interaction {
  id: string;
  type: 'call' | 'visit' | 'note' | 'status_change' | 'email' | 'appointment' | 'reminder';
  content: string;
  timestamp: string;
  dueDate?: string; // For appointments and reminders
  completed?: boolean;
}

export interface Lead {
  id: string;
  userId: string;
  placeId: string;
  source: {
    name: string;
    formattedAddress: string;
    phoneNumber: string;
    rating?: number;
    userRatingCount?: number;
    location: {
      lat: number;
      lng: number;
    };
    lastSynced: string;
  };
  crm: {
    ownerName: string;
    managerName: string;
    email: string;
    notes: string;
    status: LeadStatus;
    tags: string[];
    interactionHistory: Interaction[];
    nextStep?: string;
    lastContacted?: string;
  };
  compliance: {
    verifiedByEU: boolean;
    collectedAt: string;
  };
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
}
