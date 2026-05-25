"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

export type WizardStepId =
  | "basic-info"
  | "format"
  | "fees"
  | "prizes"
  | "review";

export interface WizardStep {
  id: WizardStepId;
  label: string;
}

export const WIZARD_STEPS: WizardStep[] = [
  { id: "basic-info", label: "Basic Info" },
  { id: "format", label: "Format" },
  { id: "fees", label: "Fees" },
  { id: "prizes", label: "Prizes" },
  { id: "review", label: "Review" },
];

export interface BasicInfoData {
  name: string;
  description: string;
  venueName: string;
  venueState: string;
  venueAddress: string;
  posterFile: File | null;
}

const initialBasicInfo: BasicInfoData = {
  name: "",
  description: "",
  venueName: "",
  venueState: "",
  venueAddress: "",
  posterFile: null,
};

interface TournamentWizardContextType {
  currentStepIndex: number;
  completedSteps: Set<number>;
  goNext: () => void;
  goBack: () => void;
  goToStep: (index: number) => void;
  markStepDone: (index: number) => void;
  basicInfoData: BasicInfoData;
  setBasicInfoData: React.Dispatch<React.SetStateAction<BasicInfoData>>;
  registerStepHandler: (index: number, handler: () => Promise<void>) => void;
  triggerStepHandler: (index: number) => Promise<void>;
}

const TournamentWizardContext =
  createContext<TournamentWizardContextType | null>(null);

export function TournamentWizardProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(
    new Set(),
  );
  const [basicInfoData, setBasicInfoData] =
    useState<BasicInfoData>(initialBasicInfo);

  const stepHandlers = useRef<Record<number, () => Promise<void>>>({});

  const registerStepHandler = useCallback(
    (index: number, handler: () => Promise<void>) => {
      stepHandlers.current[index] = handler;
    },
    [],
  );

  const triggerStepHandler = useCallback(
    async (index: number) => {
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
    },
    [],
  );

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
        registerStepHandler,
        triggerStepHandler,
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
