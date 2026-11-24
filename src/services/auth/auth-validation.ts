import {
  UNDER_18_SELF_ACCOUNT_MESSAGE,
  isUnderAdultAge,
} from "@/lib/auth/adult-age";
import { getTodayInTimeZone } from "@/lib/tournaments/datetime";

export type PasswordRequirements = {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
};

export type PasswordStrength = 0 | 1 | 2 | 3 | 4 | 5;

export function checkPasswordRequirements(
  password: string,
): PasswordRequirements {
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
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email.trim());
}

export const NAME_PATTERN = /^[a-zA-ZÀ-ɏ\s'.\-/]+$/;

export function nameCharactersError(field: "First name" | "Last name"): string {
  return `${field} can only contain letters, spaces, hyphens, apostrophes, full stops and slashes`;
}

export type RegistrationErrors = {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
  dateOfBirth?: string;
};

export type RegistrationFields = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  termsAccepted: boolean;
  dateOfBirth: string;
};

const OLDEST_PLAUSIBLE_AGE = 120;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

export function invalidDateOfBirthError(
  dateOfBirth: string,
  today: string = getTodayInTimeZone(),
): string | undefined {
  if (!dateOfBirth) return "Date of birth is required";
  const oldest = `${Number(today.slice(0, 4)) - OLDEST_PLAUSIBLE_AGE}${today.slice(4)}`;
  if (
    !isCalendarDate(dateOfBirth) ||
    dateOfBirth > today ||
    dateOfBirth < oldest
  ) {
    return "Please enter a valid date of birth";
  }
  return undefined;
}

function dateOfBirthError(
  dateOfBirth: string,
  today: string = getTodayInTimeZone(),
): string | undefined {
  const invalid = invalidDateOfBirthError(dateOfBirth, today);
  if (invalid) return invalid;
  return isUnderAdultAge(dateOfBirth, today)
    ? UNDER_18_SELF_ACCOUNT_MESSAGE
    : undefined;
}

export function validateRegistrationForm(fields: RegistrationFields): {
  errors: RegistrationErrors;
  isValid: boolean;
} {
  const errors: RegistrationErrors = {};

  if (!fields.firstName.trim()) {
    errors.firstName = "First name is required";
  } else if (!NAME_PATTERN.test(fields.firstName.trim())) {
    errors.firstName = nameCharactersError("First name");
  }
  if (!fields.lastName.trim()) {
    errors.lastName = "Last name is required";
  } else if (!NAME_PATTERN.test(fields.lastName.trim())) {
    errors.lastName = nameCharactersError("Last name");
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

  const dobError = dateOfBirthError(fields.dateOfBirth);
  if (dobError) {
    errors.dateOfBirth = dobError;
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function isRegistrationFormSubmittable(
  fields: RegistrationFields,
): boolean {
  const reqs = checkPasswordRequirements(fields.password);
  const allReqsMet = Object.values(reqs).every(Boolean);
  return (
    fields.firstName.trim().length > 0 &&
    fields.lastName.trim().length > 0 &&
    validateEmail(fields.email) &&
    allReqsMet &&
    fields.password === fields.confirmPassword &&
    fields.termsAccepted &&
    dateOfBirthError(fields.dateOfBirth) === undefined
  );
}

export type LoginFields = {
  email: string;
  password: string;
  keepSignedIn: boolean;
};

export type LoginErrors = {
  email?: string;
  password?: string;
};

export function validateLoginForm(fields: LoginFields): {
  errors: LoginErrors;
  isValid: boolean;
} {
  const errors: LoginErrors = {};

  if (!fields.email.trim()) {
    errors.email = "Email address is required";
  } else if (!validateEmail(fields.email)) {
    errors.email = "Please enter a valid email address";
  }

  if (!fields.password) {
    errors.password = "Password is required";
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export function isLoginFormSubmittable(fields: LoginFields): boolean {
  return validateEmail(fields.email) && fields.password.length > 0;
}

export type UpdatePasswordErrors = {
  password?: string;
  confirmPassword?: string;
};

export function validateUpdatePasswordForm(
  password: string,
  confirmPassword: string,
): { errors: UpdatePasswordErrors; isValid: boolean } {
  const errors: UpdatePasswordErrors = {};

  const reqs = checkPasswordRequirements(password);
  const allReqsMet = Object.values(reqs).every(Boolean);
  if (!password) {
    errors.password = "Password is required";
  } else if (!allReqsMet) {
    errors.password = "Password does not meet the requirements";
  }

  if (!confirmPassword) {
    errors.confirmPassword = "Please confirm your password";
  } else if (password !== confirmPassword) {
    errors.confirmPassword = "Passwords do not match";
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}

export type ForgotPasswordErrors = {
  email?: string;
};

export function validateForgotPasswordForm(email: string): {
  errors: ForgotPasswordErrors;
  isValid: boolean;
} {
  const errors: ForgotPasswordErrors = {};

  if (!email.trim()) {
    errors.email = "Email address is required";
  } else if (!validateEmail(email)) {
    errors.email = "Please enter a valid email address";
  }

  return { errors, isValid: Object.keys(errors).length === 0 };
}
