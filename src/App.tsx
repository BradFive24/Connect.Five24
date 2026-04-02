import React, { useState, useEffect, useCallback } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import { Radar, Target, MessageSquare, Plus, RefreshCw, DollarSign, Clock, MapPin, Loader2, LogIn, Sparkles, AlertCircle } from 'lucide-react';
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
  const [viewMode, setViewMode] = useState<'radar' | 'pipeline'>('radar');
  
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
    console.log('API Key Status:', GOOGLE_MAPS_API_KEY ? `PRESENT (ends in ...${GOOGLE_MAPS_API_KEY.slice(-4)})` : 'MISSING');
    
    if (DEBUG_MODE) {
      setAuthStatus({ authenticated: true, onboardingCompleted: true, hasAccessToken: true });
      setOnboardingStep(3);
      setIsCheckingAuth(false);
    }
    checkAuthStatus();
    
    // Only validate once per session
    if (!sessionStorage.getItem('gemini_validated')) {
      validateGeminiConnection().then(success => {
        if (success) sessionStorage.setItem('gemini_validated', 'true');
      });
    }

    const authUnsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setIsAuthReady(true);
    });
    
    if (!GOOGLE_MAPS_API_KEY) {
      setMapError('ApiTargetBlockedMapError: Google Maps API Key is missing. Please add it to your environment variables.');
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
      const errorMsg = 'ApiTargetBlockedMapError: Authentication failed. Please check your API key restrictions in Google Cloud Console.';
      console.error('Google Maps authentication failed (gm_authFailure)');
      setMapError(errorMsg);
      setSimulationMode(true); // Auto-switch to simulation immediately
    };

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

  // Login Screen (Initial)
  if (!authStatus?.authenticated && !hasBeenAuthenticated && !DEBUG_MODE) {
    const isFirebaseAuthed = !!firebaseUser;
    
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950 text-zinc-100 font-sans p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md w-full bg-zinc-900 border border-zinc-800 p-12 rounded-[2.5rem] shadow-2xl"
        >
          <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <Radar className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-4xl font-black mb-4 tracking-tighter uppercase italic">Five24 Connect</h1>
          <p className="text-zinc-500 mb-12 text-sm font-medium leading-relaxed">
            {isFirebaseAuthed 
              ? "Firebase link established. Now connect your Google account to access the radar."
              : "The ultimate radar for high-stakes lead generation. Sign in to get started."}
          </p>
          
          <button 
            onClick={handleConnectAccount}
            className="w-full py-5 bg-white text-zinc-950 rounded-2xl font-black text-lg hover:bg-zinc-200 transition-all flex items-center justify-center gap-4 shadow-xl shadow-white/5 group"
          >
            <img src="https://www.google.com/favicon.ico" className="w-6 h-6 group-hover:scale-110 transition-transform" alt="Google" />
            {isFirebaseAuthed ? "CONNECT GOOGLE ACCOUNT" : "SIGN IN WITH GOOGLE"}
          </button>
          
          <div className="mt-6 flex flex-col gap-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
              Trouble signing in?
            </p>
            <button
              onClick={() => window.open(window.location.href, '_blank')}
              className="w-full py-3 bg-zinc-800 text-zinc-100 rounded-xl text-xs font-bold hover:bg-zinc-700 transition-colors flex items-center justify-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              OPEN IN NEW TAB
            </button>
            
            <button
              onClick={handleLogout}
              className="w-full py-3 border border-zinc-800 text-zinc-500 rounded-xl text-[10px] font-bold hover:bg-zinc-900 transition-colors uppercase tracking-widest"
            >
              Clear Session & Sign Out
            </button>
          </div>
          
          {authStatus && !authStatus.authenticated && (
            <div className="mt-8 p-4 bg-zinc-950/50 rounded-2xl border border-zinc-800 text-left">
              <p className="text-[9px] text-zinc-600 uppercase tracking-widest font-bold mb-2">Diagnostic Data</p>
              <div className="space-y-1 font-mono text-[8px] text-zinc-500 break-all">
                <p>Session: {authStatus.debug?.sessionExists ? 'ACTIVE' : 'MISSING'}</p>
                <p>Tokens: {authStatus.debug?.tokensExist ? 'PRESENT' : 'NONE'}</p>
                <p>Firebase: {firebaseUser ? 'CONNECTED' : 'DISCONNECTED'}</p>
                <p>Origin: {window.location.origin}</p>
                <p>Redirect: {authStatus.debug?.redirectUri}</p>
              </div>
              <button 
                onClick={() => checkAuthStatus()}
                className="mt-3 w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-colors"
              >
                Retry Auth Check
              </button>
            </div>
          )}
          
          {isFirebaseAuthed && (
            <button
              onClick={() => auth.signOut()}
              className="mt-6 text-xs text-zinc-600 hover:text-zinc-400 transition-colors uppercase tracking-widest font-bold"
            >
              Sign Out of Firebase
            </button>
          )}
          
          <button
            onClick={() => window.location.reload()}
            className="mt-4 text-xs text-zinc-600 hover:text-zinc-400 transition-colors flex items-center justify-center gap-1 mx-auto"
          >
            <RefreshCw className="w-3 h-3" />
            FORCE REFRESH
          </button>
          
          <p className="mt-10 text-[10px] text-zinc-600 uppercase tracking-[0.2em] font-bold">Secure Environment v2.0</p>
        </motion.div>
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/90 backdrop-blur-md p-6">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="max-w-2xl w-full bg-zinc-900 border border-zinc-800 p-10 rounded-3xl shadow-2xl"
        >
          <div className="flex items-center gap-4 mb-8">
            <div className="p-3 bg-emerald-500/10 rounded-2xl">
              <Radar className="w-8 h-8 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight uppercase tracking-widest">GETTING STARTED</h1>
              <p className="text-zinc-500 text-xs uppercase tracking-widest font-bold">Project: Five24 Connect</p>
            </div>
          </div>

          <div className="space-y-8 mb-12">
            {/* Step 1 */}
            <div className={cn("flex gap-6 transition-opacity", onboardingStep !== 1 && "opacity-40")}>
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0 transition-colors",
                onboardingStep >= 1 ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-500"
              )}>1</div>
              <div>
                <h3 className="text-lg font-bold mb-1">Connect Account</h3>
                <p className="text-zinc-400 text-sm mb-4">Link your Google account to authorize radar features.</p>
                {onboardingStep === 1 && (
                  <button 
                    onClick={handleConnectAccount}
                    className="px-6 py-2.5 bg-zinc-100 text-zinc-950 rounded-lg font-bold hover:bg-white transition-colors flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Connect Google Account
                  </button>
                )}
              </div>
            </div>

            {/* Step 2 */}
            <div className={cn("flex gap-6 transition-opacity", onboardingStep !== 2 && "opacity-40")}>
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0 transition-colors",
                onboardingStep >= 2 ? "bg-emerald-500 text-zinc-950" : "bg-zinc-800 text-zinc-500"
              )}>2</div>
              <div>
                <h3 className="text-lg font-bold mb-1">Initialize Radar</h3>
                <p className="text-zinc-400 text-sm mb-4">Provision Maps & Places APIs on your project.</p>
                {onboardingStep === 2 && (
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <button 
                        onClick={handleInitializeRadar}
                        disabled={isInitializing}
                        className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-500 disabled:opacity-50 transition-colors flex items-center gap-2"
                      >
                        {isInitializing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Initialize Radar Services
                      </button>
                      <button 
                        onClick={() => {
                          setSimulationMode(true);
                          setOnboardingStep(3);
                        }}
                        className="px-6 py-2.5 bg-zinc-800 text-zinc-400 rounded-lg font-bold hover:bg-zinc-700 transition-colors"
                      >
                        Skip to Simulation
                      </button>
                    </div>
                    {initializationError && (
                      <p className="text-red-400 text-xs font-medium">{initializationError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-zinc-800 flex justify-between items-center">
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

  return (
    <APIProvider 
      apiKey={GOOGLE_MAPS_API_KEY} 
      version="weekly"
      onLoad={() => {
        console.log('Maps API Loaded Successfully');
        setMapError(null);
      }}
    >
      <div className="flex h-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
      {/* Sidebar - Lead List */}
      <div className="w-80 border-r border-zinc-800 flex flex-col bg-zinc-900/50 backdrop-blur-xl">
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Radar className="w-6 h-6 text-emerald-500 animate-pulse" />
              <h1 className="text-xl font-bold tracking-tight">Five24 Connect</h1>
            </div>
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
          
          {displayLeads.map((lead) => (
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
                  <span className={lead.crm.monetaryValue > 0 ? "text-emerald-400" : ""}>
                    ${lead.crm.monetaryValue.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-zinc-500 justify-end">
                  <Clock className="w-3 h-3" />
                  <span className={isExpired(lead.compliance.collectedAt) && !lead.compliance.verifiedByEU ? "text-rose-500" : "text-zinc-400"}>
                    {new Date(lead.compliance.collectedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              
              <div className="mt-2 flex items-center justify-between">
                <span className={cn(
                  "text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded",
                  lead.crm.status === 'new' ? "bg-blue-500/10 text-blue-500" :
                  lead.crm.status === 'contacted' ? "bg-amber-500/10 text-amber-500" :
                  lead.crm.status === 'qualified' ? "bg-purple-500/10 text-purple-500" :
                  "bg-emerald-500/10 text-emerald-500"
                )}>
                  {lead.crm.status}
                </span>
                {isExpired(lead.compliance.collectedAt) && !lead.compliance.verifiedByEU && (
                  <div className="flex items-center gap-1 text-[9px] text-rose-500 uppercase font-bold tracking-tighter">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin-slow" />
                    Purge
                  </div>
                )}
              </div>
            </motion.div>
          ))}
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
                      isExpired(lead.compliance?.collectedAt || new Date().toISOString()) && !lead.compliance?.verifiedByEU ? "bg-rose-500" : ""
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
            ) : (!GOOGLE_MAPS_API_KEY || (mapError && !simulationMode)) ? (
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
            ) : (
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
                {displayLeads.map((lead) => (
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
                        isExpired(lead.compliance.collectedAt) && !lead.compliance.verifiedByEU ? "bg-rose-500" : "bg-emerald-500"
                      )} />
                      <div className={cn(
                        "w-4 h-4 rounded-full border-2 border-zinc-950 shadow-lg",
                        isExpired(lead.compliance.collectedAt) && !lead.compliance.verifiedByEU ? "bg-rose-500" : "bg-emerald-500"
                      )} />
                    </div>
                  </AdvancedMarker>
                ))}
              </Map>
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
      />

      <LeadGenerationModal 
        isOpen={isGeneratingLeads}
        onClose={() => setIsGeneratingLeads(false)}
        onLeadConverted={handleLeadConverted}
        isSimulationMode={simulationMode}
        mapError={mapError}
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
    </APIProvider>
  );
}
