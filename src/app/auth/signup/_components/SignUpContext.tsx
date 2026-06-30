"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { type RegistrationFields } from "@/services/auth/auth-validation";
import { SIGNUP_FORM_STORAGE_KEY as STORAGE_KEY } from "@/lib/signup-storage";

// Persisted in sessionStorage (not localStorage) so the in-progress signup is
// cleared when the tab closes and never leaks across tabs. The password and
// confirmPassword are deliberately NOT persisted — they live only in in-memory
// React state and are sent straight to create-account, so the cleartext
// password never touches browser storage.

const defaultForm: RegistrationFields = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
  termsAccepted: false,
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

  // Persist on every change so a later refresh can pick up where we left off —
  // but never write the password fields to storage (cleartext credential leak).
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, confirmPassword, ...persisted } = form;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
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
