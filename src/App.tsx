// Force Sync: 2026-04-03T16:51:00Z
import React, { useState, useEffect, useCallback } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import { Radar, Target, MessageSquare, Plus, RefreshCw, DollarSign, Clock, MapPin, Loader2, LogIn, Sparkles, AlertCircle, Key, CheckCircle2, ShieldCheck, Lock, HelpCircle, Globe, UserCheck, Brain, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import axios from 'axios';
import { clsx } from 'clsx';
import type { ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { db, auth } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, onSnapshot, query, addDoc, serverTimestamp, updateDoc, doc, getDoc, where, getDocs, deleteDoc } from 'firebase/firestore';
import { Lead, LeadStatus } from './types';
import { seedInitialLeads } from './seed';
import { getCoachPrompts, validateGeminiConnection } from './services/coachService';
import { signIn, signOut } from './firebase';
import { CoachPanel } from './components/CoachPanel';
import { LeadGenerationModal } from './components/LeadGenerationModal';
import { LeadPipeline } from './components/LeadPipeline';
import { SettingsModal } from './components/SettingsModal';
import { Settings } from 'lucide-react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-100 p-10">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 p-8 rounded-2xl shadow-2xl">
            <h1 className="text-2xl font-bold text-red-500 mb-4">SYSTEM ERROR</h1>
            <p className="text-zinc-400 mb-6">The sales radar has encountered an unrecoverable failure.</p>
            <pre className="bg-black p-4 rounded-lg text-xs text-red-400 overflow-auto mb-6">
              {this.state.error?.message || 'Unknown Error'}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-zinc-100 text-zinc-950 rounded-xl font-bold hover:bg-white transition-colors"
            >
              RESTART SYSTEM
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';

const DEBUG_MODE = true;

const getLocalGeminiKey = () => localStorage.getItem('GEMINI_API_KEY') || '';
const getLocalMapsKey = () => localStorage.getItem('GOOGLE_MAPS_API_KEY') || '';

// Global error interception for Google Maps
if (typeof window !== 'undefined') {
  const originalError = console.error;
  console.error = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      try { return JSON.stringify(arg); } catch (e) { return String(arg); }
    }).join(' ');
    
    if (message.includes('ApiTargetBlockedMapError') || message.includes('gm_authFailure')) {
      (window as any).__google_maps_error = true;
    }
    originalError.apply(console, args);
  };

  (window as any).gm_authFailure = () => {
    console.error('Google Maps authentication failed (gm_authFailure)');
    (window as any).__google_maps_error = true;
  };
}

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isCoachOpen, setIsCoachOpen] = useState(false);
  const [radarLocation, setRadarLocation] = useState({ lat: 37.42, lng: -122.08 });
  
  // Onboarding & Auth State
  const [authStatus, setAuthStatus] = useState<{ 
    authenticated: boolean; 
    onboardingCompleted: boolean; 
    hasAccessToken: boolean; 
    expiryDate?: number;
    debug?: {
      sessionExists: boolean;
      tokensExist: boolean;
      redirectUri: string;
      appUrl: string;
      clientIdSet: boolean;
    }
  } | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [hasBeenAuthenticated, setHasBeenAuthenticated] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [radarStatus, setRadarStatus] = useState<string>('');
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [simulationMode, setSimulationMode] = useState(false);
  const [isGeneratingLeads, setIsGeneratingLeads] = useState(false);
  const [viewMode, setViewMode] = useState<'radar' | 'pipeline'>('pipeline');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [userGeminiKey, setUserGeminiKey] = useState(getLocalGeminiKey());
  const [userMapsKey, setUserMapsKey] = useState(getLocalMapsKey());

  const effectiveMapsKey = userMapsKey || GOOGLE_MAPS_API_KEY;
  
  const displayLeads = (DEBUG_MODE && leads.length === 0) ? [
    {
      id: 'debug-1',
      userId: 'debug',
      placeId: 'debug-place-1',
      source: {
        name: "Connect Coffee Co.",
        formattedAddress: "1600 Amphitheatre Pkwy, Mountain View, CA 94043",
        phoneNumber: "(650) 253-0000",
        rating: 4.8,
        userRatingCount: 412,
        location: { lat: 37.422, lng: -122.084 },
        lastSynced: new Date().toISOString()
      },
      crm: {
        ownerName: "John Coffee",
        managerName: "Jane Brew",
        email: "coffee@connect.com",
        notes: "Debug mode active.",
        status: 'new' as LeadStatus,
        tags: ["coffee"],
        interactionHistory: [],
        monetaryValue: 5000
      },
      compliance: {
        verifiedByEU: false,
        collectedAt: new Date().toISOString()
      }
    },
    {
      id: 'debug-2',
      userId: 'debug',
      placeId: 'debug-place-2',
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
        email: "auto@precision.com",
        notes: "Owner is looking for lead gen.",
        status: 'contacted' as LeadStatus,
        tags: ["auto"],
        interactionHistory: [],
        monetaryValue: 12000
      },
      compliance: {
        verifiedByEU: true,
        collectedAt: new Date().toISOString()
      }
    }
  ] : leads;

  const checkAuthStatus = useCallback(async (retries = 3) => {
    setIsCheckingAuth(true);
    console.log(`LOG: Checking auth status at /api/auth/status (Retries left: ${retries})`);
    try {
      const res = await axios.get('/api/auth/status', { withCredentials: true });
      console.log('LOG: Auth status response status:', res.status);
      const data = res.data;
      console.log('LOG: Auth status data:', data);
      if (data.debug) {
        console.log('DEBUG: Server Redirect URI:', data.debug.redirectUri);
        console.log('DEBUG: Server App URL:', data.debug.appUrl);
        console.log('DEBUG: Client ID Set:', data.debug.clientIdSet);
        
        if (data.debug.redirectUri && !data.debug.redirectUri.startsWith(window.location.origin)) {
          console.warn('WARNING: Server REDIRECT_URI mismatch with current origin:', window.location.origin);
        }
      }
      setAuthStatus(data);
      
      if (data.authenticated) {
        setHasBeenAuthenticated(true);
        if (data.onboardingCompleted) {
          setOnboardingStep(3); // Skip to Sales Radar
        } else {
          setOnboardingStep(2); // Go to Step 2 of onboarding
        }
      } else {
        console.log('LOG: User not authenticated.');
      }
    } catch (error: any) {
      console.error('ERROR: Failed to check auth status:', error);
      if (error.response) {
        console.error('ERROR: Response data:', error.response.data);
        console.error('ERROR: Response status:', error.response.status);
        
        // Break the loop if 401 (Unauthorized)
        if (error.response.status === 401) {
          console.warn('WARNING: 401 Unauthorized - Clearing session state.');
          setAuthStatus({ authenticated: false, onboardingCompleted: false, hasAccessToken: false });
          setHasBeenAuthenticated(false);
          return; // Stop retrying
        }
      } else if (error.request) {
        console.error('ERROR: Request made but no response received:', error.request);
      } else {
        console.error('ERROR: Error setting up request:', error.message);
      }
      
      if (retries > 0) {
        console.log('LOG: Retrying auth check in 2s...');
        setTimeout(() => checkAuthStatus(retries - 1), 2000);
      }
    } finally {
      setIsCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    console.log('Auth Status Changed:', authStatus);
  }, [authStatus]);

  useEffect(() => {
    console.log('Sales Radar Initializing...');
    console.log('API Key Status:', effectiveMapsKey ? `PRESENT (ends in ...${effectiveMapsKey.slice(-4)})` : 'MISSING');
    
    if (DEBUG_MODE) {
      setAuthStatus({ authenticated: true, onboardingCompleted: true, hasAccessToken: true });
      setOnboardingStep(3);
      setIsCheckingAuth(false);
    }
    checkAuthStatus();
    
    // Only validate once per session
    if (!sessionStorage.getItem('gemini_validated')) {
      validateGeminiConnection(userGeminiKey).then(success => {
        if (success) sessionStorage.setItem('gemini_validated', 'true');
      });
    }

    const authUnsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setIsAuthReady(true);
    });
    
    if (!effectiveMapsKey) {
      setMapError('ApiTargetBlockedMapError: Google Maps API Key is missing. Please add it in Connection Settings.');
      setSimulationMode(true);
    }

    // Catch Google Maps API errors
    const originalError = console.error;
    console.error = (...args) => {
      const message = args.map(arg => {
        if (typeof arg === 'string') return arg;
        try { return JSON.stringify(arg); } catch (e) { return String(arg); }
      }).join(' ');
      
      if (message.includes('ApiTargetBlockedMapError') || message.includes('gm_authFailure')) {
        const errorMsg = 'ApiTargetBlockedMapError: Maps JavaScript API is not authorized for this key.';
        setMapError(errorMsg);
        setSimulationMode(true); // Auto-switch to simulation immediately
      }
      originalError.apply(console, args);
    };

    // Standard Google Maps auth failure handler
    (window as any).gm_authFailure = () => {
      const errorMsg = 'ApiTargetBlockedMapError: Google Maps authentication failed. This usually means your API Key is restricted and doesn\'t allow the "Maps JavaScript API".';
      console.error('Google Maps authentication failed (gm_authFailure)');
      setMapError(errorMsg);
      setSimulationMode(false); // Don't auto-switch to simulation, show the error screen instead for better guidance
    };

    // Check for global error flag
    if ((window as any).__google_maps_error) {
      setMapError('ApiTargetBlockedMapError: Maps JavaScript API is not authorized for this key.');
      setSimulationMode(true);
    }

    // Global error listener for script loading issues
    const handleGlobalError = (event: ErrorEvent) => {
      if (event.message && (event.message.includes('ApiTargetBlockedMapError') || event.message.includes('gm_authFailure'))) {
        setMapError('ApiTargetBlockedMapError: Maps JavaScript API is not authorized for this key.');
        setSimulationMode(true);
      }
    };

    const handlePromiseRejection = (event: PromiseRejectionEvent) => {
      const reason = String(event.reason);
      if (reason.includes('ApiTargetBlockedMapError') || reason.includes('gm_authFailure')) {
        setMapError('ApiTargetBlockedMapError: Maps JavaScript API is not authorized for this key.');
        setSimulationMode(true);
      }
    };

    // Watch for Google Maps error overlay in the DOM
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            const text = node.innerText || '';
            if (text.includes('ApiTargetBlockedMapError') || text.includes('Google Maps JavaScript API error')) {
              setMapError('ApiTargetBlockedMapError: Maps JavaScript API is not authorized for this key.');
              setSimulationMode(true);
            }
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handlePromiseRejection);

    // Map loading timeout - much shorter for better UX
    const mapTimeout = setTimeout(() => {
      if (!simulationMode && !mapError && viewMode === 'radar') {
        console.warn('Map loading timeout - auto-switching to Simulation Mode');
        setSimulationMode(true);
      }
    }, 5000); // Reduced to 5s for snappier fallback

    const handleMessage = (event: MessageEvent) => {
      console.log('Received message from origin:', event.origin, 'Data:', event.data);
      
      // Validate origin is from AI Studio preview, localhost, or any Firebase Auth domain
      const origin = event.origin;
      const isAuthorizedOrigin = 
        origin.endsWith('.run.app') || 
        origin.includes('localhost') || 
        origin.includes('127.0.0.1') ||
        origin.endsWith('.firebaseapp.com') ||
        origin === 'https://connect.five24creativestudio.com';
      
      if (!isAuthorizedOrigin) {
        console.warn('Unauthorized message origin:', origin);
        return;
      }

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        console.log('ACCOUNT CONNECTED: Re-establishing connection in 1s...');
        setTimeout(() => {
          checkAuthStatus();
        }, 1000);
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR') {
        console.error('CONNECTION FAILED: Connection could not be established.', event.data.error);
        setIsCheckingAuth(false);
      }
    };
    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handlePromiseRejection);
      observer.disconnect();
      authUnsubscribe();
      console.error = originalError;
      clearTimeout(mapTimeout);
    };
  }, [checkAuthStatus, simulationMode, mapError, viewMode]);

  const handleSelectLead = useCallback((lead: Lead) => {
    setSelectedLead(lead);
    setIsCoachOpen(true);
  }, []);

  const handleUpdateLead = async (updatedLead: Lead) => {
    try {
      const leadRef = doc(db, 'leads', updatedLead.id);
      const { id, ...data } = updatedLead;
      await updateDoc(leadRef, { 
        ...data,
        "source.lastSynced": new Date().toISOString() // Optional: update sync time on any edit? Or keep separate.
      });
      setSelectedLead(updatedLead);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `leads/${updatedLead.id}`);
    }
  };

  const handleUpdateLeadStatus = async (leadId: string, status: LeadStatus) => {
    try {
      const leadRef = doc(db, 'leads', leadId);
      await updateDoc(leadRef, { 
        "crm.status": status,
        "crm.interactionHistory": [
          {
            id: `status-${Date.now()}`,
            type: 'status_change',
            content: `Status updated to ${status}`,
            timestamp: new Date().toISOString()
          },
          ...(leads.find(l => l.id === leadId)?.crm.interactionHistory || [])
        ]
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `leads/${leadId}`);
    }
  };

  const handleLeadConverted = (newLead: Lead) => {
    setLeads(prev => [newLead, ...prev]);
    setSelectedLead(newLead);
    setIsCoachOpen(true);
  };

  // Firestore Sync Effect
  useEffect(() => {
    if (!isAuthReady || !firebaseUser) {
      setLeads([]);
      return;
    }

    console.log('Syncing data for user:', firebaseUser.uid);
    seedInitialLeads(firebaseUser.uid);

    const q = query(collection(db, 'leads'), where('userId', '==', firebaseUser.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const leadsData = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        // Migration: If old structure, wrap in source/crm/compliance
        if (!data.source) {
          return {
            id: doc.id,
            userId: data.userId,
            placeId: data.placeId || `legacy-${doc.id}`,
            source: {
              name: data.name || 'Unknown Business',
              formattedAddress: data.formattedAddress || 'No Address',
              phoneNumber: data.phoneNumber || '',
              rating: data.rating,
              userRatingCount: data.userRatingCount,
              location: data.location || { lat: 0, lng: 0 },
              lastSynced: data.lastUpdated || new Date().toISOString()
            },
            crm: {
              ownerName: '',
              managerName: '',
              email: '',
              notes: data.notes || '',
              status: (data.status as LeadStatus) || 'new',
              tags: [],
              interactionHistory: [],
              monetaryValue: data.monetaryValue || 0
            },
            compliance: {
              verifiedByEU: data.verifiedByEU || false,
              collectedAt: data.collectedAt || new Date().toISOString()
            }
          } as Lead;
        }
        return {
          id: doc.id,
          ...data
        } as Lead;
      });
      setLeads(leadsData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'leads');
    });

    return () => unsubscribe();
  }, [isAuthReady, firebaseUser]);

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout', {}, { withCredentials: true });
      await auth.signOut();
      setAuthStatus(null);
      setHasBeenAuthenticated(false);
      setOnboardingStep(1);
      window.location.reload();
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleConnectAccount = async () => {
    console.log('LOG: Initiating account connection sequence...');
    
    try {
      // Step 1: Ensure Firebase Auth
      if (!auth.currentUser) {
        console.log('LOG: Step 1 - Firebase Auth Popup');
        try {
          await signIn();
          console.log('LOG: Firebase Auth successful. User should click again for Google link.');
          // We stop here to ensure the next window.open is a direct user gesture
          return;
        } catch (firebaseError: any) {
          if (firebaseError.code === 'auth/unauthorized-domain') {
            const domain = window.location.hostname;
            alert(`ERROR: Domain Unauthorized.\n\nPlease add "${domain}" to your Firebase Authorized Domains list in the Firebase Console.`);
          } else if (firebaseError.code === 'auth/popup-blocked') {
            alert('ERROR: Popup blocked. Please allow popups for this site to sign in.');
          } else {
            throw firebaseError;
          }
          return;
        }
      }

      // Step 2: Fetch Google OAuth URL
      console.log('LOG: Step 2 - Fetching Google OAuth URL...');
      const res = await fetch('/api/auth/url', { credentials: 'include' });
      const contentType = res.headers.get('content-type');
      
      if (!res.ok) {
        let errorMessage = `Server error (${res.status})`;
        if (contentType && contentType.includes('application/json')) {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } else {
          const text = await res.text();
          console.error('Non-JSON error response:', text.substring(0, 200));
        }
        throw new Error(errorMessage);
      }
      
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        console.error('Expected JSON but received:', text.substring(0, 200));
        throw new Error('Server returned non-JSON response. Check console for details.');
      }
      
      const { url, redirectUri } = await res.json();
      console.log('LOG: Redirect URI being used:', redirectUri);
      
      if (url && !url.includes('undefined')) {
        console.log('LOG: Opening Google OAuth popup...');
        const authWindow = window.open(
          url,
          'oauth_popup',
          'width=600,height=700'
        );
        if (!authWindow) {
          alert('ERROR: Popup blocked. Please allow popups for this site to connect your Google account.');
        }
      } else {
        throw new Error('Invalid OAuth URL received from server');
      }
    } catch (error: any) {
      console.error('ERROR: Account connection failed:', error);
      alert(`ERROR: Connection failed: ${error.message}`);
    }
  };

  const handleInitializeRadar = async () => {
    setIsInitializing(true);
    setInitializationError(null);
    setRadarStatus('Establishing Satellite Link...');
    
    try {
      // Status progression for long-running tasks
      const statusTimer1 = setTimeout(() => setRadarStatus('Enabling Maps & Places APIs...'), 3000);
      const statusTimer2 = setTimeout(() => setRadarStatus('Synching Database...'), 8000);
      
      const res = await fetch('/api/gcp/initialize', { 
        method: 'POST',
        credentials: 'include'
      });
      
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        console.error('Expected JSON but received:', text.substring(0, 200));
        throw new Error('Server returned non-JSON response. Check console for details.');
      }
      
      const data = await res.json();
      
      clearTimeout(statusTimer1);
      clearTimeout(statusTimer2);
      
      if (data.success) {
        setRadarStatus('Radar Active.');
        setOnboardingStep(3);
      } else {
        setInitializationError(data.error || 'Failed to initialize radar');
      }
    } catch (error) {
      setInitializationError('Connection failed. Check connection.');
    } finally {
      setIsInitializing(false);
    }
  };

  // Loading Environment Splash Screen
  if ((isCheckingAuth || isInitializing) && !DEBUG_MODE) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-zinc-100 font-sans p-6">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <div className="relative w-24 h-24 mx-auto mb-8">
            <motion.div 
              className="absolute inset-0 border-4 border-emerald-500/20 rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            />
            <motion.div 
              className="absolute inset-0 border-t-4 border-emerald-500 rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <Radar className="w-10 h-10 text-emerald-500" />
            </div>
          </div>
          <h2 className="text-xl font-bold tracking-widest uppercase italic mb-2">
            {isInitializing ? 'Initializing Radar' : 'Loading Environment'}
          </h2>
          <p className="text-zinc-500 text-[10px] uppercase tracking-[0.3em] font-bold animate-pulse">
            {isInitializing ? radarStatus : 'Establishing Secure Connection...'}
          </p>
        </motion.div>
      </div>
    );
  }

  // Landing Page (Login)
  if (!authStatus?.authenticated && !hasBeenAuthenticated && !DEBUG_MODE) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500/30">
        {/* Navigation */}
        <nav className="border-b border-slate-800/50 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
                <Radar className="w-6 h-6 text-emerald-500" />
              </div>
              <span className="text-xl font-black tracking-tighter uppercase italic text-slate-100">Connect.Five24</span>
            </div>
            <button 
              onClick={handleConnectAccount}
              className="px-6 py-2.5 bg-slate-100 text-slate-950 rounded-xl font-bold text-sm hover:bg-white transition-all shadow-lg shadow-white/5"
            >
              Sign In
            </button>
          </div>
        </nav>

        {/* Hero Section */}
        <main className="max-w-7xl mx-auto px-6 pt-20 pb-32">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-bold uppercase tracking-widest mb-6">
                <Sparkles className="w-3 h-3" />
                Next-Gen Sales Intelligence
              </div>
              <h1 className="text-6xl lg:text-7xl font-black tracking-tighter uppercase italic leading-[0.9] mb-8">
                Lead Radar & <br />
                <span className="text-emerald-500">Sales Coach.</span>
              </h1>
              <p className="text-slate-400 text-lg mb-10 max-w-lg leading-relaxed">
                Connect.Five24 transforms how you discover and engage leads. Real-time radar discovery meets AI-powered sales coaching to close deals faster.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <button 
                  onClick={handleConnectAccount}
                  className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-bold text-lg hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-900/20 flex items-center justify-center gap-3 group"
                >
                  Get Started Now
                  <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <div className="flex items-center gap-4 px-6 py-4 bg-slate-900/50 border border-slate-800 rounded-2xl">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                  <span className="text-xs font-medium text-slate-400">Enterprise-Grade Security</span>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative"
            >
              <div className="absolute -inset-4 bg-emerald-500/10 blur-3xl rounded-full" />
              <div className="relative bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] shadow-2xl">
                <div className="aspect-video bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden relative group">
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Radar className="w-20 h-20 text-emerald-500/20 animate-pulse" />
                  </div>
                  {/* Mock Radar UI */}
                  <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
                    <div className="space-y-1">
                      <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-emerald-500"
                          animate={{ width: ['0%', '100%'] }}
                          transition={{ duration: 2, repeat: Infinity }}
                        />
                      </div>
                      <p className="text-[8px] font-mono text-emerald-500 uppercase">Scanning Local Leads...</p>
                    </div>
                    <div className="w-12 h-12 rounded-full border-2 border-emerald-500/30 flex items-center justify-center">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Features */}
          <div className="grid md:grid-cols-3 gap-8 mt-32">
            {[
              {
                icon: Globe,
                title: "Map Discovery",
                desc: "Visualize your market with real-time geographic lead radar. Find opportunities where they live."
              },
              {
                icon: UserCheck,
                title: "EU Verification",
                desc: "Ensure compliance and data integrity with our built-in End-User verification workflow."
              },
              {
                icon: Brain,
                title: "AI Coaching",
                desc: "Get personalized sales strategies and scripts powered by Gemini 1.5 Pro intelligence."
              }
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + (i * 0.1) }}
                className="p-8 bg-slate-900/50 border border-slate-800 rounded-3xl hover:border-slate-700 transition-colors group"
              >
                <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-emerald-500/10 transition-colors">
                  <feature.icon className="w-6 h-6 text-slate-400 group-hover:text-emerald-500 transition-colors" />
                </div>
                <h3 className="text-xl font-bold mb-3 text-slate-100">{feature.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-800/50 py-12">
          <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-widest">
              <ShieldCheck className="w-4 h-4" />
              Secure Environment v2.0
            </div>
            <p className="text-slate-600 text-[10px] uppercase tracking-widest font-bold">
              © 2026 Connect.Five24. All Rights Reserved.
            </p>
          </div>
        </footer>
      </div>
    );
  }

  // Signal Lost Screen (Expired Session)
  if (!authStatus?.authenticated && hasBeenAuthenticated && !DEBUG_MODE) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-100 font-sans p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-lg bg-zinc-900 border border-zinc-800 p-10 rounded-3xl shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/20">
            <motion.div 
              className="h-full bg-emerald-500"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            />
          </div>
          
          <Radar className="w-16 h-16 text-emerald-500 mx-auto mb-8 animate-pulse" />
          <h2 className="text-3xl font-bold mb-4 tracking-tighter uppercase italic">Connection Required</h2>
          <p className="text-zinc-400 mb-10 text-sm leading-relaxed">
            Your account has been disconnected. Re-establish the link to resume radar features.
          </p>
          
          <button 
            onClick={handleConnectAccount}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-3 shadow-lg shadow-emerald-900/20"
          >
            <RefreshCw className="w-5 h-5" />
            RECONNECT WITH GOOGLE
          </button>
        </motion.div>
      </div>
    );
  }


  // Onboarding Overlay
  if (onboardingStep < 3 && !DEBUG_MODE) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-6">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="max-w-2xl w-full bg-slate-900 border border-slate-800 p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden"
        >
          {/* Privacy Shield Background Pattern */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 blur-3xl rounded-full -mr-32 -mt-32" />
          
          <div className="flex items-center gap-4 mb-10 relative">
            <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
              <ShieldCheck className="w-8 h-8 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter uppercase italic text-slate-100">Security First Setup</h1>
              <p className="text-slate-500 text-[10px] uppercase tracking-[0.3em] font-bold">Trust-Verified Environment</p>
            </div>
          </div>

          {/* Privacy Shield Component */}
          <div className="mb-10 p-6 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center shrink-0">
              <Lock className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-emerald-500 uppercase tracking-widest mb-1">Encryption Active</h4>
              <p className="text-slate-400 text-xs leading-relaxed">
                Your API keys are stored in your <span className="text-emerald-500 font-bold">Local Browser only</span>. They never touch our servers.
              </p>
            </div>
          </div>

          <div className="space-y-10 mb-12">
            {/* Step 1: Identity */}
            <div className={cn("flex gap-6 transition-all", onboardingStep !== 1 && "opacity-40 grayscale")}>
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shrink-0 border transition-all",
                onboardingStep >= 1 ? "bg-emerald-500 border-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20" : "bg-slate-800 border-slate-700 text-slate-500"
              )}>
                {onboardingStep > 1 ? <CheckCircle2 className="w-6 h-6" /> : "01"}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold mb-1 text-slate-100">Identity Verification</h3>
                <p className="text-slate-400 text-sm mb-4">Securely link your Google account to establish your workspace.</p>
                {onboardingStep === 1 && (
                  <button 
                    onClick={handleConnectAccount}
                    className="px-6 py-3 bg-slate-100 text-slate-950 rounded-xl font-bold hover:bg-white transition-all flex items-center gap-3 shadow-lg shadow-white/5"
                  >
                    <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="Google" />
                    Connect Google Account
                  </button>
                )}
              </div>
            </div>

            {/* Step 2: API Configuration */}
            <div className={cn("flex gap-6 transition-all", onboardingStep !== 2 && "opacity-40 grayscale")}>
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shrink-0 border transition-all",
                onboardingStep >= 2 ? "bg-emerald-500 border-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20" : "bg-slate-800 border-slate-700 text-slate-500"
              )}>
                {onboardingStep > 2 ? <CheckCircle2 className="w-6 h-6" /> : "02"}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold mb-1 text-slate-100">Secure Configuration</h3>
                <p className="text-slate-400 text-sm mb-6">Connect your intelligence engines to power the radar and coach.</p>
                
                {onboardingStep === 2 && (
                  <div className="space-y-6 bg-slate-950/50 p-6 rounded-3xl border border-slate-800">
                    {/* Gemini Key */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Gemini AI Key</label>
                        <button 
                          onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank')}
                          className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                        >
                          <HelpCircle className="w-3 h-3" />
                          Where do I find this?
                        </button>
                      </div>
                      <div className="relative">
                        <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                        <input 
                          type="password"
                          placeholder="AI Studio API Key..."
                          value={localStorage.getItem('GEMINI_API_KEY') || ''}
                          onChange={(e) => {
                            localStorage.setItem('GEMINI_API_KEY', e.target.value);
                            // Force re-render if needed or just let the save handle it
                          }}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-12 pr-4 text-sm focus:border-emerald-500/50 outline-none transition-all font-mono"
                        />
                      </div>
                    </div>

                    {/* Maps Key */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Google Maps Key</label>
                        <button 
                          onClick={() => window.open('https://console.cloud.google.com/google/maps-apis/credentials', '_blank')}
                          className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                        >
                          <HelpCircle className="w-3 h-3" />
                          Where do I find this?
                        </button>
                      </div>
                      <div className="relative">
                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                        <input 
                          type="password"
                          placeholder="Google Cloud API Key..."
                          value={localStorage.getItem('GOOGLE_MAPS_PLATFORM_KEY') || ''}
                          onChange={(e) => {
                            localStorage.setItem('GOOGLE_MAPS_PLATFORM_KEY', e.target.value);
                          }}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl py-3 pl-12 pr-4 text-sm focus:border-emerald-500/50 outline-none transition-all font-mono"
                        />
                      </div>
                    </div>

                    <div className="pt-4 flex gap-3">
                      <button 
                        onClick={handleInitializeRadar}
                        disabled={isInitializing}
                        className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
                      >
                        {isInitializing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                        Verify & Activate
                      </button>
                      <button 
                        onClick={() => {
                          setSimulationMode(true);
                          setOnboardingStep(3);
                        }}
                        className="px-6 py-3 bg-slate-800 text-slate-400 rounded-xl font-bold hover:bg-slate-700 transition-all"
                      >
                        Skip
                      </button>
                    </div>
                    {initializationError && (
                      <p className="text-red-400 text-xs font-medium text-center">{initializationError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-slate-800 flex justify-between items-center relative">
            <p className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">Secure Connection Required</p>
            {onboardingStep === 3 && (
              <button 
                onClick={() => setOnboardingStep(3)}
                className="px-8 py-3 bg-emerald-500 text-zinc-950 rounded-xl font-bold hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
              >
                START RADAR
              </button>
            )}
          </div>
        </motion.div>
      </div>
    );
  }

  const isExpired = (collectedAt: string) => {
    const date = new Date(collectedAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays >= 28;
  };

  const purgeOldLeads = useCallback(async () => {
    if (!auth.currentUser) return;
    try {
      const q = query(
        collection(db, 'leads'),
        where('userId', '==', auth.currentUser.uid),
        where('verifiedByEU', '==', false)
      );
      const snapshot = await getDocs(q);
      const now = new Date();
      const deletePromises = snapshot.docs
        .filter(doc => {
          const data = doc.data();
          const collectedAt = new Date(data.collectedAt);
          const diffTime = Math.abs(now.getTime() - collectedAt.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          return diffDays >= 28;
        })
        .map(doc => deleteDoc(doc.ref));
      
      if (deletePromises.length > 0) {
        console.log(`Purging ${deletePromises.length} unverified leads...`);
        await Promise.all(deletePromises);
      }
    } catch (error) {
      console.error('Failed to purge old leads:', error);
    }
  }, []);

  useEffect(() => {
    if (isAuthReady) {
      purgeOldLeads();
    }
  }, [isAuthReady, purgeOldLeads]);

  const handleSaveSettings = (gemini: string, maps: string, simulation: boolean) => {
    localStorage.setItem('GEMINI_API_KEY', gemini);
    localStorage.setItem('GOOGLE_MAPS_API_KEY', maps);
    setUserGeminiKey(gemini);
    setUserMapsKey(maps);
    setSimulationMode(simulation);
    
    // If we just added a maps key and simulation is off, try to clear errors
    if (maps && !simulation) {
      setMapError(null);
    }
  };

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar - Lead List */}
      <div className="w-80 border-r border-zinc-800 flex flex-col bg-zinc-900/50 backdrop-blur-xl">
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Radar className="w-6 h-6 text-emerald-500 animate-pulse" />
              <h1 className="text-xl font-bold tracking-tight">Five24 Connect</h1>
            </div>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-500 hover:text-zinc-300"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex flex-col gap-4">
            <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800">
              <button 
                onClick={() => setViewMode('radar')}
                className={cn(
                  "flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all",
                  viewMode === 'radar' ? "bg-zinc-800 text-emerald-500 shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                Radar View
              </button>
              <button 
                onClick={() => setViewMode('pipeline')}
                className={cn(
                  "flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all",
                  viewMode === 'pipeline' ? "bg-zinc-800 text-emerald-500 shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                Pipeline
              </button>
            </div>

            <button 
              onClick={() => setIsGeneratingLeads(true)}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-[10px] uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
            >
              <Sparkles className="w-4 h-4" />
              Generate New Leads
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-mono text-zinc-500 uppercase">Active Leads ({displayLeads.length})</span>
            <button className="p-1 hover:bg-zinc-800 rounded transition-colors">
              <Plus className="w-4 h-4 text-emerald-500" />
            </button>
          </div>
          
          {displayLeads.map((lead) => {
            const isLeadExpired = lead.compliance?.collectedAt ? isExpired(lead.compliance.collectedAt) : false;
            const isVerified = lead.compliance?.verifiedByEU || false;
            
            return (
              <motion.div
                key={lead.id}
                layoutId={lead.id}
                onClick={() => setSelectedLead(lead)}
                className={cn(
                  "p-4 rounded-xl border cursor-pointer transition-all duration-200 group",
                  selectedLead?.id === lead.id 
                    ? "bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.1)]" 
                    : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
                )}
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-sm truncate pr-2">{lead.source?.name || 'Unknown Business'}</h3>
                  {lead.source?.rating && (
                    <div className="flex items-center gap-1 text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-400">
                      <span>{lead.source.rating.toFixed(1)}</span>
                      <span className="text-emerald-500">★</span>
                    </div>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                  <div className="flex items-center gap-1 text-zinc-500">
                    <DollarSign className="w-3 h-3" />
                    <span className={lead.crm?.monetaryValue > 0 ? "text-emerald-400" : ""}>
                      ${(lead.crm?.monetaryValue || 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-zinc-500 justify-end">
                    <Clock className="w-3 h-3" />
                    <span className={isLeadExpired && !isVerified ? "text-rose-500" : "text-zinc-400"}>
                      {lead.compliance?.collectedAt ? new Date(lead.compliance.collectedAt).toLocaleDateString() : 'Unknown'}
                    </span>
                  </div>
                </div>
                
                <div className="mt-2 flex items-center justify-between">
                  <span className={cn(
                    "text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded",
                    lead.crm?.status === 'new' ? "bg-blue-500/10 text-blue-500" :
                    lead.crm?.status === 'contacted' ? "bg-amber-500/10 text-amber-500" :
                    lead.crm?.status === 'qualified' ? "bg-purple-500/10 text-purple-500" :
                    "bg-emerald-500/10 text-emerald-500"
                  )}>
                    {lead.crm?.status || 'new'}
                  </span>
                  {isLeadExpired && !isVerified && (
                    <div className="flex items-center gap-1 text-[9px] text-rose-500 uppercase font-bold tracking-tighter">
                      <RefreshCw className="w-2.5 h-2.5 animate-spin-slow" />
                      Purge
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Main View */}
      <div className="flex-1 relative flex flex-col">
        {viewMode === 'radar' ? (
          <div className="flex-1 relative">
            {simulationMode ? (
              <div className="w-full h-full bg-[#09090b] relative overflow-hidden flex items-center justify-center">
                {/* Simulation Radar Background */}
                <div className="absolute inset-0 opacity-20">
                  <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at center, #10b981 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-[300px] h-[300px] border border-emerald-500/30 rounded-full" />
                    <div className="w-[600px] h-[600px] border border-emerald-500/20 rounded-full absolute" />
                    <div className="w-[900px] h-[900px] border border-emerald-500/10 rounded-full absolute" />
                  </div>
                </div>

                {/* Simulation Sweep */}
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                  className="absolute w-[1000px] h-[1000px] origin-center pointer-events-none"
                  style={{ background: 'conic-gradient(from 0deg, #10b981 0%, transparent 20%)', opacity: 0.1 }}
                />

                {/* Simulation Markers */}
                {displayLeads.map((lead, idx) => (
                  <motion.div
                    key={lead.id}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: idx * 0.1 }}
                    onClick={() => handleSelectLead(lead)}
                    className="absolute cursor-pointer group"
                    style={{ 
                      left: `${50 + (idx % 2 === 0 ? 1 : -1) * (15 + idx * 5)}%`, 
                      top: `${50 + (idx % 3 === 0 ? 1 : -1) * (10 + idx * 8)}%` 
                    }}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 border-zinc-950 shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-transform group-hover:scale-125",
                      selectedLead?.id === lead.id ? "bg-emerald-500 scale-125" : "bg-zinc-800",
                      (lead.compliance?.collectedAt ? isExpired(lead.compliance.collectedAt) : false) && !lead.compliance?.verifiedByEU ? "bg-rose-500" : ""
                    )} />
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-zinc-900/80 backdrop-blur-sm border border-zinc-800 px-2 py-1 rounded text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                      {lead.source?.name || 'Unknown'}
                    </div>
                  </motion.div>
                ))}

                <div className="absolute bottom-6 right-6 flex flex-col items-end gap-3">
                  {mapError && (
                    <div className="bg-rose-500/90 backdrop-blur-md border border-rose-400/50 p-3 rounded-xl text-[10px] font-bold text-white flex items-center gap-2 shadow-2xl animate-in fade-in slide-in-from-bottom-4">
                      <AlertCircle className="w-3 h-3" />
                      RADAR OFFLINE: {mapError.split(':')[0]}
                    </div>
                  )}
                  <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-3 rounded-xl text-xs font-mono text-emerald-500 flex items-center gap-2 shadow-2xl">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    SIMULATION MODE ACTIVE
                  </div>
                </div>
              </div>
            ) : (!effectiveMapsKey || (mapError && !simulationMode)) ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950 p-10 text-center">
                <div className="max-w-md bg-zinc-900 border border-zinc-800 p-8 rounded-2xl shadow-2xl">
                  <MapPin className="w-12 h-12 text-rose-500 mx-auto mb-4 animate-bounce" />
                  <h3 className="text-xl font-bold mb-2 uppercase italic">Radar Offline</h3>
                  
                  <div className="text-left bg-zinc-950 p-4 rounded-xl border border-zinc-800 text-xs space-y-4 mb-6">
                    <div className="space-y-1">
                      <p className="font-bold text-rose-500 uppercase tracking-widest text-[10px]">Critical Error:</p>
                      <p className="text-zinc-400 font-mono break-all">{mapError || 'ApiTargetBlockedMapError: Maps JavaScript API is not authorized for this key.'}</p>
                    </div>

                    <div className="space-y-2">
                      <p className="font-bold text-emerald-500 uppercase tracking-widest text-[10px]">How to Fix:</p>
                      <ol className="list-decimal list-inside space-y-2 text-zinc-400">
                        <li>Go to <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" className="underline text-emerald-400 hover:text-emerald-300">Google Cloud Credentials</a></li>
                        <li>Click on your API Key to edit it.</li>
                        <li>Under <strong>API restrictions</strong>, select <strong>"Restrict key"</strong>.</li>
                        <li>In the dropdown, find and check <strong>"Maps JavaScript API"</strong> AND <strong>"Places API"</strong>.</li>
                        <li>Click <strong>Save</strong> and wait ~60 seconds for propagation.</li>
                      </ol>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button 
                      onClick={() => setIsSettingsOpen(true)}
                      className="w-full py-3 bg-emerald-500 text-zinc-950 rounded-xl font-bold hover:bg-emerald-400 transition-colors flex items-center justify-center gap-2"
                    >
                      <Key className="w-4 h-4" />
                      Update API Key
                    </button>

                    <button 
                      onClick={() => {
                        setMapError(null);
                        setSimulationMode(false);
                        // Force a reload if it's still stuck after a few seconds
                        setTimeout(() => {
                          if (!(window as any).google?.maps) {
                            window.location.reload();
                          }
                        }, 1000);
                      }}
                      className="w-full py-3 bg-zinc-100 text-zinc-950 rounded-xl font-bold hover:bg-white transition-colors flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Check Connection Now
                    </button>

                    <button 
                      onClick={() => {
                        setSimulationMode(true);
                        setMapError(null);
                      }}
                      className="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-500 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                    >
                      <Radar className="w-5 h-5" />
                      Launch Simulation Mode
                    </button>
                  </div>
                </div>
              </div>
            ) : ((window as any).google?.maps) ? (
              <APIProvider 
                apiKey={effectiveMapsKey} 
                version="weekly"
                onLoad={() => {
                  console.log('Maps API Loaded Successfully');
                  setMapError(null);
                }}
              >
                <Map
                  defaultCenter={radarLocation}
                  defaultZoom={13}
                  mapId="DEMO_MAP_ID"
                  className="w-full h-full"
                  disableDefaultUI={true}
                  styles={[
                    { elementType: "geometry", stylers: [{ color: "#18181b" }] },
                    { elementType: "labels.text.stroke", stylers: [{ color: "#18181b" }] },
                    { elementType: "labels.text.fill", stylers: [{ color: "#71717a" }] },
                    { featureType: "road", elementType: "geometry", stylers: [{ color: "#27272a" }] },
                    { featureType: "water", elementType: "geometry", stylers: [{ color: "#09090b" }] },
                  ]}
                >
                  {displayLeads.map((lead) => {
                    if (!lead.source?.location) return null;
                    
                    // Extra safety check for AdvancedMarker requirements
                    if (!(window as any).google?.maps?.marker) {
                      return null;
                    }
                    
                    const isLeadExpired = lead.compliance?.collectedAt ? isExpired(lead.compliance.collectedAt) : false;
                    const isVerified = lead.compliance?.verifiedByEU || false;

                    return (
                      <AdvancedMarker
                        key={lead.id}
                        position={lead.source.location}
                        onClick={() => handleSelectLead(lead)}
                      >
                        <div className={cn(
                          "relative flex items-center justify-center transition-transform hover:scale-110",
                          selectedLead?.id === lead.id ? "scale-125" : ""
                        )}>
                          <div className={cn(
                            "absolute w-8 h-8 rounded-full animate-ping opacity-20",
                            isLeadExpired && !isVerified ? "bg-rose-500" : "bg-emerald-500"
                          )} />
                          <div className={cn(
                            "w-4 h-4 rounded-full border-2 border-zinc-950 shadow-lg",
                            isLeadExpired && !isVerified ? "bg-rose-500" : "bg-emerald-500"
                          )} />
                        </div>
                      </AdvancedMarker>
                    );
                  })}
                </Map>
              </APIProvider>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-zinc-950">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-4" />
                  <p className="text-zinc-500 text-xs uppercase tracking-widest font-bold">Initializing Radar...</p>
                </div>
              </div>
            )}

            {/* Overlay Controls */}
            <div className="absolute top-6 left-6 flex flex-col gap-2">
              <div className="bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-3 rounded-xl flex items-center gap-3 shadow-2xl">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Radar Center</span>
                  <span className="text-sm font-mono">37.42° N, 122.08° W</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 bg-zinc-950 p-8 overflow-hidden flex flex-col">
            <div className="mb-8 flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-black tracking-tighter uppercase italic mb-1">Lead Pipeline</h2>
                <p className="text-zinc-500 text-xs uppercase tracking-[0.3em] font-bold">Strategic Lead Management</p>
              </div>
              <div className="flex gap-4">
                <div className="bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-xl flex items-center gap-3">
                  <div className="flex flex-col items-end">
                    <span className="text-[8px] text-zinc-500 uppercase font-bold tracking-widest">Active Leads</span>
                    <span className="text-sm font-mono text-blue-500">
                      {displayLeads.length}
                    </span>
                  </div>
                  <Target className="w-5 h-5 text-blue-500" />
                </div>
                <div className="bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-xl flex items-center gap-3">
                  <div className="flex flex-col items-end">
                    <span className="text-[8px] text-zinc-500 uppercase font-bold tracking-widest">Win Rate</span>
                    <span className="text-sm font-mono text-purple-500">
                      {displayLeads.length > 0 ? Math.round((displayLeads.filter(l => l.crm.status === 'closed').length / displayLeads.length) * 100) : 0}%
                    </span>
                  </div>
                  <CheckCircle2 className="w-5 h-5 text-purple-500" />
                </div>
                <div className="bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-xl flex items-center gap-3">
                  <div className="flex flex-col items-end">
                    <span className="text-[8px] text-zinc-500 uppercase font-bold tracking-widest">Pipeline Value</span>
                    <span className="text-sm font-mono text-emerald-500">
                      ${displayLeads.reduce((acc, l) => acc + l.crm.monetaryValue, 0).toLocaleString()}
                    </span>
                  </div>
                  <DollarSign className="w-5 h-5 text-emerald-500" />
                </div>
              </div>
            </div>
            
            <div className="flex-1 min-h-0">
              <LeadPipeline 
                leads={displayLeads}
                onUpdateStatus={handleUpdateLeadStatus}
                onSelectLead={handleSelectLead}
              />
            </div>
          </div>
        )}
      </div>

      {/* Coach Panel */}
      <CoachPanel 
        isOpen={isCoachOpen}
        onClose={() => setIsCoachOpen(false)}
        lead={selectedLead}
        onUpdateLead={handleUpdateLead}
        userGeminiKey={userGeminiKey}
      />

      <LeadGenerationModal 
        isOpen={isGeneratingLeads}
        onClose={() => setIsGeneratingLeads(false)}
        onLeadConverted={handleLeadConverted}
        isSimulationMode={simulationMode}
        mapError={mapError}
        userGeminiKey={userGeminiKey}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        geminiKey={userGeminiKey}
        mapsKey={userMapsKey}
        simulationMode={simulationMode}
        onSave={handleSaveSettings}
      />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .animate-spin-slow {
          animation: spin 3s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
