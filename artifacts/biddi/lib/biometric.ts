import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const BIO_TOKEN_KEY = "biddi.bioToken";
const BIO_ENABLED_KEY = "biddi.bioEnabled";
const BIO_LABEL_KEY = "biddi.bioLabel";
const BIO_PROMPT_SHOWN_KEY = "biddi.bioPromptShown";

/** Whether we've already asked this user (on this device) to enable biometric
 * sign-in after a successful authentication. We only want to nudge once so it
 * never feels nagging. */
export async function wasBiometricPromptShown(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(BIO_PROMPT_SHOWN_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function markBiometricPromptShown(): Promise<void> {
  try {
    await SecureStore.setItemAsync(BIO_PROMPT_SHOWN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export interface BiometricCapability {
  available: boolean;
  enrolled: boolean;
  label: "face" | "fingerprint" | "iris" | "biometric";
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  if (Platform.OS === "web") {
    return { available: false, enrolled: false, label: "biometric" };
  }
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    let label: BiometricCapability["label"] = "biometric";
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      label = "face";
    } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      label = "fingerprint";
    } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      label = "iris";
    }
    return { available: compatible, enrolled, label };
  } catch {
    return { available: false, enrolled: false, label: "biometric" };
  }
}

export async function promptBiometric(reason: string): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
    });
    return r.success;
  } catch {
    return false;
  }
}

/** Persist the auth token behind a biometric-locked SecureStore entry. We
 * also write a separate "enabled" flag so we can render the login screen's
 * biometric button without unlocking the keychain on every app launch. */
export async function enableBiometricLogin(token: string, label: string): Promise<void> {
  await SecureStore.setItemAsync(BIO_TOKEN_KEY, token, {
    requireAuthentication: true,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.setItemAsync(BIO_ENABLED_KEY, "1");
  await SecureStore.setItemAsync(BIO_LABEL_KEY, label);
}

export async function disableBiometricLogin(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(BIO_TOKEN_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(BIO_ENABLED_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(BIO_LABEL_KEY).catch(() => {}),
    // Reset the "we already asked" flag so the next account on this device
    // gets prompted afresh.
    SecureStore.deleteItemAsync(BIO_PROMPT_SHOWN_KEY).catch(() => {}),
  ]);
}

export async function isBiometricLoginEnabled(): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(BIO_ENABLED_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

export async function getBiometricLabel(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(BIO_LABEL_KEY);
  } catch {
    return null;
  }
}

/** Prompts for biometrics and, on success, returns the stored token. The
 * SecureStore read itself is gated by the OS keychain, so the prompt runs
 * inside the read. */
export async function readBiometricToken(reason: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const token = await SecureStore.getItemAsync(BIO_TOKEN_KEY, {
      requireAuthentication: true,
      authenticationPrompt: reason,
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return token ?? null;
  } catch {
    return null;
  }
}
