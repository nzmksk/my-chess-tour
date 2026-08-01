"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  BasicInfoData,
  FeesData,
  FormatData,
  PersistedState,
  PrizesData,
  WizardStep,
} from "../types";

export const WIZARD_STEPS: WizardStep[] = [
  { id: "basic-info", label: "Basic Info" },
  { id: "format", label: "Format" },
  { id: "fees", label: "Fees" },
  { id: "prizes", label: "Prizes" },
  { id: "review", label: "Review" },
];

const initialBasicInfo: BasicInfoData = {
  name: "",
  description: "",
  venueName: "",
  venueState: "",
  venueAddress: "",
};

const initialFeesData: FeesData = {
  standardFee: "",
  tiers: [],
};

const initialPrizesData: PrizesData = {
  categories: [],
  specialPrizes: [],
};

const initialFormatData: FormatData = {
  formatType: "",
  system: "",
  rounds: "",
  baseTime: "",
  increment: 0,
  delay: 0,
  startDate: "",
  endDate: "",
  registrationDeadline: "",
  maxParticipants: "",
  fideRated: false,
  mcfRated: false,
  restrictions: [],
};

function storageKey(orgId: string, suffix?: string) {
  return `tournament-wizard-${orgId}${suffix ? `-${suffix}` : ""}`;
}

function loadFromStorage(
  orgId: string,
  suffix?: string,
): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(orgId, suffix));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function saveToStorage(
  orgId: string,
  state: PersistedState,
  suffix?: string,
): void {
  try {
    sessionStorage.setItem(storageKey(orgId, suffix), JSON.stringify(state));
  } catch {}
}

interface TournamentWizardContextType {
  currentStepIndex: number;
  completedSteps: Set<number>;
  goNext: () => void;
  goBack: () => void;
  goToStep: (index: number) => void;
  markStepDone: (index: number) => void;
  basicInfoData: BasicInfoData;
  setBasicInfoData: React.Dispatch<React.SetStateAction<BasicInfoData>>;
  formatData: FormatData;
  setFormatData: React.Dispatch<React.SetStateAction<FormatData>>;
  feesData: FeesData;
  setFeesData: React.Dispatch<React.SetStateAction<FeesData>>;
  prizesData: PrizesData;
  setPrizesData: React.Dispatch<React.SetStateAction<PrizesData>>;
  tournamentId: string | null;
  setTournamentId: React.Dispatch<React.SetStateAction<string | null>>;
  registerStepHandler: (index: number, handler: () => Promise<void>) => void;
  triggerStepHandler: (index: number) => Promise<void>;
  clearWizardStorage: () => void;
  excludeId: string | null;
  isHydrated: boolean;
}

const TournamentWizardContext =
  createContext<TournamentWizardContextType | null>(null);

export function TournamentWizardProvider({
  orgId,
  children,
  initialData,
  storageKeySuffix,
  excludeId = null,
}: {
  orgId: string;
  children: React.ReactNode;
  initialData?: PersistedState;
  storageKeySuffix?: string;
  excludeId?: string | null;
}) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [basicInfoData, setBasicInfoData] =
    useState<BasicInfoData>(initialBasicInfo);
  const [formatData, setFormatData] = useState<FormatData>(initialFormatData);
  const [feesData, setFeesData] = useState<FeesData>(initialFeesData);
  const [prizesData, setPrizesData] = useState<PrizesData>(initialPrizesData);
  const [tournamentId, setTournamentId] = useState<string | null>(null);

  // isHydrated gates the persist effect so it never runs before the load
  // effect has restored data from sessionStorage.
  const [isHydrated, setIsHydrated] = useState(false);

  const orgIdRef = useRef(orgId);
  const storageKeySuffixRef = useRef(storageKeySuffix);
  const initialDataRef = useRef(initialData);
  const stepHandlers = useRef<Record<number, () => Promise<void>>>({});

  // Restore persisted state once on mount (client-only, no SSR sessionStorage).
  useEffect(() => {
    const saved =
      loadFromStorage(orgIdRef.current, storageKeySuffixRef.current) ??
      initialDataRef.current ??
      null;
    // One-time hydration from sessionStorage on mount — sessionStorage is
    // unavailable during SSR, so restoring this state synchronously in the
    // mount effect is intentional and runs exactly once.
    if (saved) {
      setBasicInfoData(saved.basicInfoData ?? initialBasicInfo);
      setFormatData(saved.formatData ?? initialFormatData);
      setFeesData(saved.feesData ?? initialFeesData);
      setPrizesData(saved.prizesData ?? initialPrizesData);
      setTournamentId(saved.tournamentId ?? null);
      setCurrentStepIndex(saved.currentStepIndex ?? 0);
      if (saved.completedSteps) {
        setCompletedSteps(new Set(saved.completedSteps));
      }
    }
    setIsHydrated(true);
  }, []); // intentionally empty — runs once on mount

  // Persist all wizard state to sessionStorage after every state change,
  // but only after the initial load has completed.
  useEffect(() => {
    if (!isHydrated) return;
    saveToStorage(
      orgId,
      {
        basicInfoData,
        formatData,
        feesData,
        prizesData,
        tournamentId,
        currentStepIndex,
        completedSteps: [...completedSteps],
      },
      storageKeySuffix,
    );
  }, [
    isHydrated,
    orgId,
    storageKeySuffix,
    basicInfoData,
    formatData,
    feesData,
    prizesData,
    tournamentId,
    currentStepIndex,
    completedSteps,
  ]);

  const clearWizardStorage = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey(orgId, storageKeySuffix));
    } catch {}
  }, [orgId, storageKeySuffix]);

  const registerStepHandler = useCallback(
    (index: number, handler: () => Promise<void>) => {
      stepHandlers.current[index] = handler;
    },
    [],
  );

  const triggerStepHandler = useCallback(async (index: number) => {
    const handler = stepHandlers.current[index];
    if (handler) {
      await handler();
    } else {
      setCurrentStepIndex((prev) => {
        const next = Math.min(prev + 1, WIZARD_STEPS.length - 1);
        setCompletedSteps((done) => new Set(done).add(prev));
        return next;
      });
    }
  }, []);

  const markStepDone = useCallback((index: number) => {
    setCompletedSteps((prev) => new Set(prev).add(index));
  }, []);

  const goNext = useCallback(() => {
    setCurrentStepIndex((prev) => {
      const next = Math.min(prev + 1, WIZARD_STEPS.length - 1);
      setCompletedSteps((done) => new Set(done).add(prev));
      return next;
    });
  }, []);

  const goBack = useCallback(() => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const goToStep = useCallback(
    (index: number) => {
      if (index < currentStepIndex || completedSteps.has(index)) {
        setCurrentStepIndex(index);
      }
    },
    [currentStepIndex, completedSteps],
  );

  return (
    <TournamentWizardContext.Provider
      value={{
        currentStepIndex,
        completedSteps,
        goNext,
        goBack,
        goToStep,
        markStepDone,
        basicInfoData,
        setBasicInfoData,
        formatData,
        setFormatData,
        feesData,
        setFeesData,
        prizesData,
        setPrizesData,
        tournamentId,
        setTournamentId,
        registerStepHandler,
        triggerStepHandler,
        clearWizardStorage,
        excludeId,
        isHydrated,
      }}
    >
      {children}
    </TournamentWizardContext.Provider>
  );
}

export function useTournamentWizard() {
  const ctx = useContext(TournamentWizardContext);
  if (!ctx) {
    throw new Error(
      "useTournamentWizard must be used within TournamentWizardProvider",
    );
  }
  return ctx;
}
