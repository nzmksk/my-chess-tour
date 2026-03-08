"use client";

import { createContext, useContext, useState } from "react";
import { type RegistrationFields } from "@/lib/auth-validation";

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
  state: "",
  fideId: "",
  mcfId: "",
  isOku: false,
};

type SignUpContextType = {
  form: RegistrationFields;
  setForm: React.Dispatch<React.SetStateAction<RegistrationFields>>;
};

const SignUpContext = createContext<SignUpContextType | null>(null);

export function SignUpProvider({ children }: { children: React.ReactNode }) {
  const [form, setForm] = useState<RegistrationFields>(defaultForm);
  return (
    <SignUpContext.Provider value={{ form, setForm }}>
      {children}
    </SignUpContext.Provider>
  );
}

export function useSignUpForm() {
  const ctx = useContext(SignUpContext);
  if (!ctx) throw new Error("useSignUpForm must be used within SignUpProvider");
  return ctx;
}
