"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { type RegistrationFields } from "@/services/auth/auth-validation";

// Tab-scoped storage key. sessionStorage (not localStorage) so the in-progress
// signup — including the password needed by the verify step — is cleared when
// the tab closes and never leaks across tabs.
const STORAGE_KEY = "signup_form";

const defaultForm: RegistrationFields = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
  termsAccepted: false,
  gender: "",
  nationality: "",
  dateOfBirth: "",
  fideId: "",
  mcfId: "",
  isOku: false,
};

// Read any in-progress signup back from storage. Runs on the server (where
// sessionStorage is undefined) and on the client, so it must be SSR-safe.
function readStoredForm(): RegistrationFields {
  if (typeof window === "undefined") return defaultForm;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) return { ...defaultForm, ...JSON.parse(stored) };
  } catch {
    // Ignore unavailable or malformed storage; fall back to defaults.
  }
  return defaultForm;
}

type SignUpContextType = {
  form: RegistrationFields;
  setForm: React.Dispatch<React.SetStateAction<RegistrationFields>>;
  clearForm: () => void;
};

const SignUpContext = createContext<SignUpContextType | null>(null);

export function SignUpProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializer rehydrates synchronously on mount so the multi-step flow
  // survives a page refresh, a direct navigation to /verify or /profile, or
  // following the email back — without a setState-in-effect.
  const [form, setForm] = useState<RegistrationFields>(readStoredForm);

  // Persist on every change so a later refresh can pick up where we left off.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // Ignore quota/availability errors — persistence is best-effort.
    }
  }, [form]);

  function clearForm() {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore unavailable storage.
    }
    setForm(defaultForm);
  }

  return (
    <SignUpContext.Provider value={{ form, setForm, clearForm }}>
      {children}
    </SignUpContext.Provider>
  );
}

export function useSignUpForm() {
  const ctx = useContext(SignUpContext);
  if (!ctx) throw new Error("useSignUpForm must be used within SignUpProvider");
  return ctx;
}
