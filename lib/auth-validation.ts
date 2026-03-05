export type PasswordRequirements = {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
};

export type PasswordStrength = 0 | 1 | 2 | 3 | 4 | 5;

export function checkPasswordRequirements(password: string): PasswordRequirements {
  return {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSymbol: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };
}

export function getPasswordStrength(password: string): PasswordStrength {
  const reqs = checkPasswordRequirements(password);
  const met = Object.values(reqs).filter(Boolean).length as PasswordStrength;
  return met;
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export type RegistrationErrors = {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
};

export type RegistrationFields = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  termsAccepted: boolean;
};

export function validateRegistrationForm(
  fields: RegistrationFields,
): { errors: RegistrationErrors; isValid: boolean } {
  const errors: RegistrationErrors = {};

  if (!fields.firstName.trim()) {
    errors.firstName = "First name is required";
  }
  if (!fields.lastName.trim()) {
    errors.lastName = "Last name is required";
  }
  if (!fields.email.trim()) {
    errors.email = "Email address is required";
  } else if (!validateEmail(fields.email)) {
    errors.email = "Please enter a valid email address";
  }

  const reqs = checkPasswordRequirements(fields.password);
  const allReqsMet = Object.values(reqs).every(Boolean);
  if (!fields.password) {
    errors.password = "Password is required";
  } else if (!allReqsMet) {
    errors.password = "Password does not meet the requirements";
  }

  if (!fields.confirmPassword) {
    errors.confirmPassword = "Please confirm your password";
  } else if (fields.password !== fields.confirmPassword) {
    errors.confirmPassword = "Passwords do not match";
  }

  if (!fields.termsAccepted) {
    errors.terms = "You must accept the Terms of Service and Privacy Policy";
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function isRegistrationFormSubmittable(fields: RegistrationFields): boolean {
  const reqs = checkPasswordRequirements(fields.password);
  const allReqsMet = Object.values(reqs).every(Boolean);
  return (
    fields.firstName.trim().length > 0 &&
    fields.lastName.trim().length > 0 &&
    validateEmail(fields.email) &&
    allReqsMet &&
    fields.password === fields.confirmPassword &&
    fields.termsAccepted
  );
}
