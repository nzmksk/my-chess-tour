import { describe, expect, it } from "vitest";

import {
  checkPasswordRequirements,
  getPasswordStrength,
  isLoginFormSubmittable,
  isRegistrationFormSubmittable,
  validateEmail,
  validateForgotPasswordForm,
  validateLoginForm,
  validateRegistrationForm,
  validateUpdatePasswordForm,
} from "../auth-validation";

describe("validateEmail", () => {
  it("accepts a standard email address", () => {
    expect(validateEmail("user@example.com")).toBe(true);
  });

  it("accepts an email with subdomains", () => {
    expect(validateEmail("user@mail.example.co.uk")).toBe(true);
  });

  it("rejects an email without @", () => {
    expect(validateEmail("userexample.com")).toBe(false);
  });

  it("rejects an email without domain", () => {
    expect(validateEmail("user@")).toBe(false);
  });

  it("rejects an email without local part", () => {
    expect(validateEmail("@example.com")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateEmail("")).toBe(false);
  });

  it("rejects an email with spaces", () => {
    expect(validateEmail("user @example.com")).toBe(false);
  });
});

describe("checkPasswordRequirements", () => {
  it("detects password meeting no requirements", () => {
    const reqs = checkPasswordRequirements("");
    expect(reqs).toEqual({
      minLength: false,
      hasUppercase: false,
      hasLowercase: false,
      hasNumber: false,
      hasSymbol: false,
    });
  });

  it("detects minLength requirement", () => {
    expect(checkPasswordRequirements("abcdefgh").minLength).toBe(true);
    expect(checkPasswordRequirements("abcdefg").minLength).toBe(false);
  });

  it("detects uppercase requirement", () => {
    expect(checkPasswordRequirements("A").hasUppercase).toBe(true);
    expect(checkPasswordRequirements("abc").hasUppercase).toBe(false);
  });

  it("detects lowercase requirement", () => {
    expect(checkPasswordRequirements("a").hasLowercase).toBe(true);
    expect(checkPasswordRequirements("ABC").hasLowercase).toBe(false);
  });

  it("detects number requirement", () => {
    expect(checkPasswordRequirements("1").hasNumber).toBe(true);
    expect(checkPasswordRequirements("abc").hasNumber).toBe(false);
  });

  it("detects symbol requirement", () => {
    expect(checkPasswordRequirements("!").hasSymbol).toBe(true);
    expect(checkPasswordRequirements("abc123").hasSymbol).toBe(false);
  });

  it("detects all requirements met for a strong password", () => {
    const reqs = checkPasswordRequirements("Secure1!");
    expect(reqs).toEqual({
      minLength: true,
      hasUppercase: true,
      hasLowercase: true,
      hasNumber: true,
      hasSymbol: true,
    });
  });
});

describe("getPasswordStrength", () => {
  it("returns 0 for an empty password", () => {
    expect(getPasswordStrength("")).toBe(0);
  });

  it("returns 5 for a password meeting all requirements", () => {
    expect(getPasswordStrength("Secure1!")).toBe(5);
  });

  it("returns the count of requirements met", () => {
    // "abc123": lowercase=true, number=true, minLength=false (6 chars), uppercase=false, symbol=false → 2
    expect(getPasswordStrength("abc123")).toBe(2);
  });

  it("increases strength as more requirements are satisfied", () => {
    const weak = getPasswordStrength("abc");
    const medium = getPasswordStrength("abcABC1");
    const strong = getPasswordStrength("abcABC1!");
    expect(weak).toBeLessThan(medium);
    expect(medium).toBeLessThan(strong);
  });
});

describe("validateRegistrationForm", () => {
  const validFields = {
    firstName: "Ahmad",
    lastName: "Razif",
    email: "ahmad@example.com",
    password: "Secure1!x",
    confirmPassword: "Secure1!x",
    termsAccepted: true,
  };

  it("returns isValid true for valid fields", () => {
    const { isValid } = validateRegistrationForm(validFields);
    expect(isValid).toBe(true);
  });

  it("returns no errors for valid fields", () => {
    const { errors } = validateRegistrationForm(validFields);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("returns firstName error when first name is empty", () => {
    const { errors } = validateRegistrationForm({ ...validFields, firstName: "" });
    expect(errors.firstName).toBeDefined();
  });

  it("returns lastName error when last name is empty", () => {
    const { errors } = validateRegistrationForm({ ...validFields, lastName: "" });
    expect(errors.lastName).toBeDefined();
  });

  it("returns email error for invalid email", () => {
    const { errors } = validateRegistrationForm({ ...validFields, email: "not-valid" });
    expect(errors.email).toBeDefined();
  });

  it("returns email error for empty email", () => {
    const { errors } = validateRegistrationForm({ ...validFields, email: "" });
    expect(errors.email).toBeDefined();
  });

  it("returns password error for weak password", () => {
    const { errors } = validateRegistrationForm({ ...validFields, password: "weak", confirmPassword: "weak" });
    expect(errors.password).toBeDefined();
  });

  it("returns confirmPassword error when passwords do not match", () => {
    const { errors } = validateRegistrationForm({ ...validFields, confirmPassword: "different" });
    expect(errors.confirmPassword).toBeDefined();
  });

  it("returns terms error when terms not accepted", () => {
    const { errors } = validateRegistrationForm({ ...validFields, termsAccepted: false });
    expect(errors.terms).toBeDefined();
  });

  it("returns isValid false when any field is invalid", () => {
    const { isValid } = validateRegistrationForm({ ...validFields, email: "bad" });
    expect(isValid).toBe(false);
  });
});

describe("isRegistrationFormSubmittable", () => {
  const validFields = {
    firstName: "Ahmad",
    lastName: "Razif",
    email: "ahmad@example.com",
    password: "Secure1!x",
    confirmPassword: "Secure1!x",
    termsAccepted: true,
  };

  it("returns true for valid complete fields", () => {
    expect(isRegistrationFormSubmittable(validFields)).toBe(true);
  });

  it("returns false when first name is empty", () => {
    expect(isRegistrationFormSubmittable({ ...validFields, firstName: "" })).toBe(false);
  });

  it("returns false when email is invalid", () => {
    expect(isRegistrationFormSubmittable({ ...validFields, email: "bad" })).toBe(false);
  });

  it("returns false when password requirements are not met", () => {
    expect(isRegistrationFormSubmittable({ ...validFields, password: "weak", confirmPassword: "weak" })).toBe(false);
  });

  it("returns false when passwords do not match", () => {
    expect(isRegistrationFormSubmittable({ ...validFields, confirmPassword: "different" })).toBe(false);
  });

  it("returns false when terms not accepted", () => {
    expect(isRegistrationFormSubmittable({ ...validFields, termsAccepted: false })).toBe(false);
  });
});

describe("validateLoginForm", () => {
  const validFields = {
    email: "ahmad@example.com",
    password: "anypassword",
    keepSignedIn: true,
  };

  it("returns isValid true for valid fields", () => {
    const { isValid } = validateLoginForm(validFields);
    expect(isValid).toBe(true);
  });

  it("returns no errors for valid fields", () => {
    const { errors } = validateLoginForm(validFields);
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("returns email error when email is empty", () => {
    const { errors } = validateLoginForm({ ...validFields, email: "" });
    expect(errors.email).toBeDefined();
  });

  it("returns email error when email is invalid", () => {
    const { errors } = validateLoginForm({ ...validFields, email: "not-valid" });
    expect(errors.email).toBeDefined();
  });

  it("returns password error when password is empty", () => {
    const { errors } = validateLoginForm({ ...validFields, password: "" });
    expect(errors.password).toBeDefined();
  });

  it("returns isValid false when any field is invalid", () => {
    const { isValid } = validateLoginForm({ ...validFields, email: "bad" });
    expect(isValid).toBe(false);
  });

  it("accepts keepSignedIn as false", () => {
    const { isValid } = validateLoginForm({ ...validFields, keepSignedIn: false });
    expect(isValid).toBe(true);
  });
});

describe("isLoginFormSubmittable", () => {
  const validFields = {
    email: "ahmad@example.com",
    password: "anypassword",
    keepSignedIn: true,
  };

  it("returns true for valid complete fields", () => {
    expect(isLoginFormSubmittable(validFields)).toBe(true);
  });

  it("returns false when email is invalid", () => {
    expect(isLoginFormSubmittable({ ...validFields, email: "bad" })).toBe(false);
  });

  it("returns false when email is empty", () => {
    expect(isLoginFormSubmittable({ ...validFields, email: "" })).toBe(false);
  });

  it("returns false when password is empty", () => {
    expect(isLoginFormSubmittable({ ...validFields, password: "" })).toBe(false);
  });
});

describe("validateForgotPasswordForm", () => {
  it("returns isValid true for a valid email", () => {
    const { isValid } = validateForgotPasswordForm("user@example.com");
    expect(isValid).toBe(true);
  });

  it("returns no errors for a valid email", () => {
    const { errors } = validateForgotPasswordForm("user@example.com");
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it("returns email error when email is empty", () => {
    const { errors } = validateForgotPasswordForm("");
    expect(errors.email).toBeDefined();
  });

  it("returns email error when email is invalid", () => {
    const { errors } = validateForgotPasswordForm("not-valid");
    expect(errors.email).toBeDefined();
  });

  it("returns isValid false when email is invalid", () => {
    const { isValid } = validateForgotPasswordForm("not-valid");
    expect(isValid).toBe(false);
  });
});

describe("validateUpdatePasswordForm", () => {
  it("returns error when password is empty", () => {
    const { errors } = validateUpdatePasswordForm("", "");
    expect(errors.password).toBeDefined();
  });

  it("returns error when password does not meet requirements", () => {
    const { errors } = validateUpdatePasswordForm("weak", "weak");
    expect(errors.password).toBeDefined();
  });

  it("returns error when confirmPassword is empty but password is strong", () => {
    const { errors } = validateUpdatePasswordForm("Strong1!", "");
    expect(errors.confirmPassword).toBeDefined();
  });

  it("returns error when passwords do not match", () => {
    const { errors } = validateUpdatePasswordForm("Strong1!", "Different1!");
    expect(errors.confirmPassword).toBeDefined();
  });

  it("returns isValid=true when password meets all requirements and confirmPassword matches", () => {
    const { isValid } = validateUpdatePasswordForm("Strong1!", "Strong1!");
    expect(isValid).toBe(true);
  });

  it("returns no errors when all requirements met", () => {
    const { errors } = validateUpdatePasswordForm("Strong1!", "Strong1!");
    expect(Object.keys(errors)).toHaveLength(0);
  });
});
